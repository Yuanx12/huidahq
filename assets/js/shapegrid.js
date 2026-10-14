/* ==========================================================================
   路径: assets/js/shapegrid.js
   移植自 React Bits 的 <ShapeGrid /> —— Canvas 2D 网格背景，指针经过时点亮格子。

   原组件是 React 组件（useRef + useEffect），本项目零框架，所以 React 壳没要，
   渲染循环和几何算法照搬。改写成：自挂载 [data-shapegrid]，参数走 HTML 属性
   里的 JSON，改参数不用碰 JS。

   砍掉的部分（本项目没用到，需要时再补）：
     - tiltX / tiltY 的 3D 透视投影（viewFor / invert / project 那一整套矩阵），
       只用不倾斜的平面视图。要倾斜得把那套矩阵代码搬回来。
     - rainbow / twinkle / clickCascade
   保留：8 种形状（改 data-shapegrid 里的 shape 就能换）、漂移方向与速度、
   拖尾、柔光、边缘渐隐、入场展开。

   两个必须记住的点：
     1) 漂移时是持续 rAF。离屏由 IntersectionObserver 停掉。
        页面里 aurora.js 也在跑 rAF，别再往同一屏堆第三个动画。
     2) reduced-motion 下不漂移，且静止 3 秒后自动停 rAF（见 settled 判断）。
   ========================================================================== */
(function () {
  'use strict';

  var SQRT3 = Math.sqrt(3);
  /* 设备像素上限。原组件是 8e6，但那是指 600px 高的小容器；铺满整个作品区块
     时 canvas 有 1440x2043 ≈ 2.94M，还没到 8e6 就足以拖慢帧率（实测 41fps）。
     压到 1.5e6 后大区块会自动降采样（本例约 0.71x ≈ 1028x1459），回到 60fps，
     小容器则完全不受影响。 */
  var MAX_PIXELS = 1.5e6;

  var DIRECTIONS = {
    right: [1, 0],
    left: [-1, 0],
    up: [0, -1],
    down: [0, 1],
    diagonal: [Math.SQRT1_2, -Math.SQRT1_2],
    none: [0, 0]
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function smoothstep(e0, e1, v) {
    var t = clamp((v - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  /* ---- 边缘渐隐：预渲染成一张离屏 canvas，每帧一次 drawImage ----
     这块踩了三层坑，最终方案是第三层，别再改回去：

     ① CSS mask（原组件做法）：两个 linear-gradient 用 mask-composite:intersect 叠起来
        挂到容器上。小容器没事，铺满作品区块（1440x2043）时实测 120 → 37.7 fps：
        容器内容每帧变，那块 294 万像素的遮罩每帧都要重新光栅化，intersect 尤其贵。

     ② canvas 内 destination-out 画四条边缘渐变带：看着只跑一遍画布像素（约 1.5M），
        实测反而更慢，37.7 → 20.7 fps。原因是 destination-out 不是默认合成模式，
        Skia 软件渲染走的是慢路径（SwiftShader 下更明显）。别用非默认合成操作做这件事。

     ③ 最终：把渐隐画成「不透明背景色盖在边缘」，用 source-over 走快路径，
        而且整块预渲染进离屏 canvas，每帧只 drawImage 一次（1:1 尺寸，不缩放）。
        正确性：网格像素 alpha=g，盖上背景色 alpha=a 后再合成到同色背景上，
        结果 = 网格·g·(1-a) + 背景·(1-g·(1-a))，正好等于「把网格整体乘 (1-a)」。
        角落两条带叠加 = (1-a1)(1-a2)，和 CSS 的 intersect（fx·fy）逐点相同。

     前提：区块背景必须是纯色（#works 是 .section--bg = #F8FAFC）。
     若哪天区块改成渐变/图片底，这里要换成真·擦除方案。 */
  var FADE_EDGE = 0.26;   // 单侧渐隐带占总宽/高的比例，26% 对应原组件 amount*26

  /* fadeX / fadeY 分开控制。默认只淡上下（fadeX=0）：
     区块是全宽的，网格左右边缘本来就落在视口边上，横向渐隐没有意义，
     只会把卡片两侧留白区的纹理抹掉（1440px 下左右各 374px 被盖掉 97%）。
     上下是区块交界，那里才需要淡出。 */
  function buildFadeLayer(pw, ph, fx, fy, color) {
    if ((fx <= 0 && fy <= 0) || pw < 2 || ph < 2) return null;
    var off = document.createElement('canvas');
    off.width = pw; off.height = ph;
    var g2 = off.getContext('2d');
    if (!g2) return null;
    var ex = Math.min(pw * 0.5, pw * FADE_EDGE * fx);
    var ey = Math.min(ph * 0.5, ph * FADE_EDGE * fy);
    // a = 1 - smootherstep(t)：最外沿盖满(a=1)，到内侧完全不盖(a=0)
    function ramp(x0, y0, x1, y1) {
      var grad = g2.createLinearGradient(x0, y0, x1, y1);
      for (var k = 0; k <= 8; k++) {
        var t = k / 8;
        grad.addColorStop(t, 'rgba(' + color + ',' + (1 - smootherstep(t)).toFixed(4) + ')');
      }
      return grad;
    }
    var bands = [];
    if (fx > 0) {
      g2.fillStyle = ramp(0, 0, ex, 0);      g2.fillRect(0, 0, ex, ph);
      g2.fillStyle = ramp(pw, 0, pw - ex, 0); g2.fillRect(pw - ex, 0, ex, ph);
      bands.push({ x: 0, y: 0, w: ex, h: ph }, { x: pw - ex, y: 0, w: ex, h: ph });
    }
    if (fy > 0) {
      g2.fillStyle = ramp(0, 0, 0, ey);      g2.fillRect(0, 0, pw, ey);
      g2.fillStyle = ramp(0, ph, 0, ph - ey); g2.fillRect(0, ph - ey, pw, ey);
      bands.push({ x: 0, y: 0, w: pw, h: ey }, { x: 0, y: ph - ey, w: pw, h: ey });
    }
    return { canvas: off, bands: bands };
  }

  /* 取区块背景色：往上找到第一个不透明的 background-color。
     找不到就退回白色（此时渐隐会盖错色，宁可在 data-shapegrid 里显式写 fadeColor）。 */
  function hostBackground(el) {
    var node = el && el.parentElement;
    while (node && node !== document.documentElement) {
      var bg = window.getComputedStyle(node).backgroundColor;
      var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(bg || '');
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) {
        return Math.round(m[1]) + ',' + Math.round(m[2]) + ',' + Math.round(m[3]);
      }
      node = node.parentElement;
    }
    return '255,255,255';
  }

  function layoutFor(shape, size) {
    if (shape === 'hexagon') {
      var radius = size / SQRT3;
      return { stepX: radius * 1.5, stepY: size, radius: radius };
    }
    if (shape === 'triangle') {
      var side = (size * 2) / SQRT3;
      return { stepX: side / 2, stepY: size, side: side };
    }
    return { stepX: size, stepY: size };
  }

  function centerOf(shape, layout, i, j) {
    var stepX = layout.stepX, stepY = layout.stepY;
    if (shape === 'hexagon') {
      return [i * stepX, j * stepY + (Math.abs(i) % 2 === 1 ? stepY / 2 : 0)];
    }
    if (shape === 'triangle') {
      var up = (((i + j) % 2) + 2) % 2 === 0;
      return [i * stepX, j * stepY + (up ? stepY * (2 / 3) : stepY / 3)];
    }
    if (shape === 'cross' || shape === 'dot') return [i * stepX, j * stepY];
    return [(i + 0.5) * stepX, (j + 0.5) * stepY];
  }

  function traceCell(ctx, shape, layout, size, i, j, x, y, inset) {
    var half, r, arm;
    if (shape === 'hexagon') {
      r = layout.radius - inset;
      for (var k = 0; k < 6; k++) {
        var angle = (Math.PI / 3) * k;
        var px = x + r * Math.cos(angle);
        var py = y + r * Math.sin(angle);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (shape === 'triangle') {
      var up = (((i + j) % 2) + 2) % 2 === 0;
      var halfBase = layout.side / 2 - inset * 1.7;
      var height = size - inset * 2.6;
      var top = up ? y - height * (2 / 3) : y + height * (2 / 3);
      var base = up ? y + height / 3 : y - height / 3;
      ctx.moveTo(x, top);
      ctx.lineTo(x + halfBase, base);
      ctx.lineTo(x - halfBase, base);
      ctx.closePath();
    } else if (shape === 'diamond') {
      r = size / 2 - inset;
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    } else if (shape === 'circle') {
      ctx.moveTo(x + size / 2 - inset, y);
      ctx.arc(x, y, Math.max(0.5, size / 2 - inset), 0, Math.PI * 2);
    } else if (shape === 'tile') {
      half = size / 2 - Math.max(inset, size * 0.06);
      r = Math.min(half, size * 0.22);
      // roundRect 在 Chrome 99+ / Safari 16+；只有 tile 形状会走到这里
      if (ctx.roundRect) ctx.roundRect(x - half, y - half, half * 2, half * 2, r);
      else ctx.rect(x - half, y - half, half * 2, half * 2);
    } else if (shape === 'cross') {
      arm = size * 0.16 + inset;
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
    } else if (shape === 'dot') {
      r = size * 0.05 + inset;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else {
      half = size / 2 - inset;
      ctx.rect(x - half, y - half, half * 2, half * 2);
    }
  }

  function mount(container) {
    var opt = {};
    try { opt = JSON.parse(container.getAttribute('data-shapegrid') || '{}') || {}; }
    catch (e) { opt = {}; }

    var s = {
      shape: opt.shape || 'square',
      cellSize: Math.max(8, opt.cellSize || 40),
      lineWidth: Math.max(0.25, opt.lineWidth || 1),
      direction: DIRECTIONS[opt.direction] ? opt.direction : 'diagonal',
      speed: opt.speed == null ? 0.5 : Math.max(0, opt.speed),
      lineColor: opt.lineColor || '#CBD5E1',
      hoverColor: opt.hoverColor || '#2563EB',
      hoverFillColor: opt.hoverFillColor || opt.hoverColor || '#2563EB',
      fillOpacity: clamp(opt.fillOpacity == null ? 0.1 : opt.fillOpacity, 0, 1),
      radius: opt.radius == null ? 1.5 : Math.max(0, opt.radius),
      trail: Math.max(0.05, opt.trail == null ? 0.6 : opt.trail),
      glow: clamp(opt.glow == null ? 0.3 : opt.glow, 0, 1),
      fade: clamp(opt.fade == null ? 1 : opt.fade, 0, 1),
      fadeX: clamp(opt.fadeX == null ? (opt.fade == null ? 0 : opt.fade) : opt.fadeX, 0, 1),
      fadeY: clamp(opt.fadeY == null ? (opt.fade == null ? 1 : opt.fade) : opt.fadeY, 0, 1),
      intro: opt.intro !== false,
      opacity: clamp(opt.opacity == null ? 1 : opt.opacity, 0, 1),
      dpr: opt.dpr || null,
      // 渐隐盖上去的颜色，默认自动取区块背景色（"R,G,B" 形式）
      fadeColor: opt.fadeColor || null
    };
    if (!s.fadeColor) s.fadeColor = hostBackground(container);

    container.style.opacity = s.opacity;

    var canvas = document.createElement('canvas');
    canvas.className = 'shape-grid-canvas';
    container.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) { container.removeChild(canvas); return; }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var state = {
      alive: true, raf: 0, last: 0, time: 0, visible: true,
      width: 1, height: 1, ratio: 1,
      offsetX: 0, offsetY: 0,
      fadeLayer: null, fadeKey: '',
      started: false, startedAt: 0, startedWall: 0,
      inside: false, pointerX: 0, pointerY: 0,
      spotX: 0, spotY: 0, spotVX: 0, spotVY: 0, spotPower: 0,
      lit: new Map()
    };

    function resize() {
      var width = Math.max(1, container.clientWidth);
      var height = Math.max(1, container.clientHeight);
      var ratio = s.dpr || Math.min(window.devicePixelRatio || 1, 2);
      // 面积保护：超过 800 万像素就降采样，否则大区块上填充率扛不住
      var pixels = width * height * ratio * ratio;
      if (pixels > MAX_PIXELS) ratio *= Math.sqrt(MAX_PIXELS / pixels);
      state.width = width;
      state.height = height;
      state.ratio = ratio;
      var pw = Math.max(1, Math.round(width * ratio));
      var ph = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      // 渐隐层只跟尺寸有关，尺寸没变就不重建（resize 每帧都会被调用一次）
      var key = pw + 'x' + ph + '@' + s.fadeX + ':' + s.fadeY + '#' + s.fadeColor;
      if (key !== state.fadeKey) {
        state.fadeKey = key;
        state.fadeLayer = buildFadeLayer(pw, ph, s.fadeX, s.fadeY, s.fadeColor);
      }
    }

    function nearestCell(layout, wx, wy) {
      var ci = Math.round(wx / layout.stepX);
      var cj = Math.round(wy / layout.stepY);
      var best = Infinity;
      var cell = [ci, cj];
      for (var i = ci - 2; i <= ci + 2; i++) {
        for (var j = cj - 2; j <= cj + 2; j++) {
          var c = centerOf(s.shape, layout, i, j);
          var d = (c[0] - wx) * (c[0] - wx) + (c[1] - wy) * (c[1] - wy);
          if (d < best) { best = d; cell = [i, j]; }
        }
      }
      return cell;
    }

    function illuminate(layout, dt) {
      var decay = Math.exp(-dt / s.trail);
      state.lit.forEach(function (value, key) {
        var next = value * decay;
        if (next < 0.004) state.lit.delete(key); else state.lit.set(key, next);
      });
      if (state.spotPower < 0.01) return;
      var wx = state.spotX + state.offsetX;
      var wy = state.spotY + state.offsetY;
      var reach = Math.max(s.radius, 0.5) * s.cellSize;
      var near = nearestCell(layout, wx, wy);
      var spanI = Math.ceil(reach / layout.stepX) + 2;
      var spanJ = Math.ceil(reach / layout.stepY) + 2;
      for (var i = near[0] - spanI; i <= near[0] + spanI; i++) {
        for (var j = near[1] - spanJ; j <= near[1] + spanJ; j++) {
          var c = centerOf(s.shape, layout, i, j);
          var distance = Math.hypot(c[0] - wx, c[1] - wy);
          var value = s.radius > 0 ? smoothstep(reach, reach * 0.15, distance) : 0;
          if (i === near[0] && j === near[1]) value = Math.max(value, 1);
          value *= state.spotPower;
          if (value <= 0.004) continue;
          var key = i + ',' + j;
          if (value > (state.lit.get(key) || 0)) state.lit.set(key, value);
        }
      }
    }

    function draw() {
      var ratio = state.ratio;
      var layout = layoutFor(s.shape, s.cellSize);
      var width = state.width, height = state.height;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      var size = s.cellSize;
      var i0 = Math.floor(state.offsetX / layout.stepX) - 2;
      var i1 = Math.ceil((width + state.offsetX) / layout.stepX) + 2;
      var j0 = Math.floor(state.offsetY / layout.stepY) - 2;
      var j1 = Math.ceil((height + state.offsetY) / layout.stepY) + 2;
      var markers = s.shape === 'cross' || s.shape === 'dot';
      var elapsed = state.time - state.startedAt;
      // intro 必须限时！原组件写成 elapsed 一直增长，导致每帧都做一次全画布
      // 径向渐变填充 —— 容器 600px 高时看不出来，铺满整个作品区块（1440x2043）
      // 时实测直接掉到 19fps。reach*1.8 的展开速度下 0.6s 就覆盖到角落，
      // 这里给 0.9s，之后 introRadius 归为 Infinity 跳过这段填充。
      var introRadius = s.intro && !reduce && state.started && elapsed < 0.9
        ? elapsed * (Math.hypot(width, height) / 2) * 1.8
        : Infinity;
      var centerX = width / 2 + state.offsetX;
      var centerY = height / 2 + state.offsetY;

      ctx.lineWidth = s.lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = s.lineColor;
      ctx.fillStyle = s.lineColor;
      ctx.beginPath();
      if (s.shape === 'square') {
        // square 走直线网格而不是逐格矩形：格子数上千，逐格画会拖垮帧率
        for (var i = i0; i <= i1; i++) {
          var x = i * layout.stepX - state.offsetX;
          ctx.moveTo(x, -size);
          ctx.lineTo(x, height + size);
        }
        for (var j = j0; j <= j1; j++) {
          var y = j * layout.stepY - state.offsetY;
          ctx.moveTo(-size, y);
          ctx.lineTo(width + size, y);
        }
      } else {
        for (var i2 = i0; i2 <= i1; i2++) {
          for (var j2 = j0; j2 <= j1; j2++) {
            var c0 = centerOf(s.shape, layout, i2, j2);
            traceCell(ctx, s.shape, layout, size, i2, j2, c0[0] - state.offsetX, c0[1] - state.offsetY, 0);
          }
        }
      }
      if (s.shape === 'dot') ctx.fill(); else ctx.stroke();

      // 入场：从中心用径向渐变擦除（destination-in 保留渐变内的部分）
      if (introRadius !== Infinity) {
        var g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(1, introRadius));
        g.addColorStop(0, 'rgba(0, 0, 0, 1)');
        g.addColorStop(0.82, 'rgba(0, 0, 0, 1)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      var glowing = s.glow > 0;
      state.lit.forEach(function (value, key) {
        var parts = key.split(',');
        var i = parseInt(parts[0], 10), j = parseInt(parts[1], 10);
        var c = centerOf(s.shape, layout, i, j);
        var v = value;
        if (introRadius !== Infinity) {
          var front = introRadius - Math.hypot(c[0] - centerX, c[1] - centerY);
          if (front < 0) return;
          var wave = Math.exp(-Math.pow(front / (size * 1.4), 2)) * 0.85;
          if (wave > v) v = wave;
        }
        if (v <= 0.01) return;
        var x = c[0] - state.offsetX;
        var y = c[1] - state.offsetY;
        ctx.beginPath();
        traceCell(ctx, s.shape, layout, size, i, j, x, y,
          markers ? v * size * 0.08 : s.lineWidth * 0.5);
        if (markers) {
          ctx.globalAlpha = Math.min(1, v);
          if (glowing) { ctx.shadowColor = s.hoverColor; ctx.shadowBlur = s.glow * 14 * v; }
          if (s.shape === 'dot') { ctx.fillStyle = s.hoverColor; ctx.fill(); }
          else { ctx.strokeStyle = s.hoverColor; ctx.lineWidth = s.lineWidth * (1 + v * 0.6); ctx.stroke(); }
          ctx.shadowBlur = 0;
          return;
        }
        if (s.fillOpacity > 0) {
          ctx.globalAlpha = Math.min(1, v) * s.fillOpacity;
          ctx.fillStyle = s.hoverFillColor;
          ctx.fill();
        }
        ctx.globalAlpha = Math.min(1, v) * 0.85;
        if (glowing) { ctx.shadowColor = s.hoverColor; ctx.shadowBlur = s.glow * 16 * v; }
        ctx.strokeStyle = s.hoverColor;
        ctx.lineWidth = s.lineWidth;
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // 边缘渐隐（必须在点亮格子之后：亮起来的格子同样要朝四边淡出）。
      // 切回单位变换，只把「有渐隐的那几条带」按原尺寸贴回去 —— 整张贴是
      // 1.5M 像素，只贴上下两条带是 0.78M，省一半。
      var layer = state.fadeLayer;
      if (layer) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (var f = 0; f < layer.bands.length; f++) {
          var bd = layer.bands[f];
          ctx.drawImage(layer.canvas, bd.x, bd.y, bd.w, bd.h, bd.x, bd.y, bd.w, bd.h);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      state.raf = 0;
      if (!state.alive) return;
      var dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      resize();
      if (!state.started) { state.started = true; state.startedAt = state.time; state.startedWall = now; }

      state.time += dt;
      if (!reduce) {
        var dir = DIRECTIONS[s.direction];
        state.offsetX -= dir[0] * s.speed * 60 * dt;
        state.offsetY -= dir[1] * s.speed * 60 * dt;
      }
      var want = state.inside ? 1 : 0;
      state.spotPower += (want - state.spotPower) * (1 - Math.exp(-(want ? 10 : 5) * dt));
      var stiffness = 220;
      var damping = 2 * Math.sqrt(stiffness) * 0.85;
      state.spotVX += (stiffness * (state.pointerX - state.spotX) - damping * state.spotVX) * dt;
      state.spotVY += (stiffness * (state.pointerY - state.spotY) - damping * state.spotVY) * dt;
      state.spotX += state.spotVX * dt;
      state.spotY += state.spotVY * dt;
      illuminate(layoutFor(s.shape, s.cellSize), dt);
      draw();

      // 漂移开着就一直跑；只有「不漂移」或 reduced-motion 时才允许停下来。
      // 计时必须用真实时间戳 now，不能用 state.time —— state.time 累加的是被
      // Math.min(0.05) 截断过的 dt，帧率一旦掉到 20fps 以下它就走得比真实时间慢，
      // 「3 秒后停」会被拉长成好几秒（SwiftShader 软件渲染下实测就是这样）。
      var still = s.speed === 0 || s.direction === 'none' || reduce;
      var settled = still &&
        state.lit.size === 0 &&
        state.spotPower < 0.005 &&
        now - state.startedWall > 3000;
      if (!settled && state.visible) state.raf = requestAnimationFrame(frame);
      else state.last = 0;
    }

    function wake() {
      if (!state.raf && state.alive && state.visible) {
        state.last = 0;
        state.raf = requestAnimationFrame(frame);
      }
    }

    function onMove(e) {
      if (e.pointerType === 'touch') return;
      var rect = container.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) { state.inside = false; return; }
      var px = x + state.offsetX;
      var py = y + state.offsetY;
      if (!state.inside && state.spotPower < 0.02) {
        state.spotX = px; state.spotY = py;
        state.spotVX = 0; state.spotVY = 0;
      }
      state.inside = true;
      state.pointerX = px;
      state.pointerY = py;
      wake();
    }

    function onLeave() { state.inside = false; }

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { resize(); draw(); wake(); });
      ro.observe(container);
    } else {
      window.addEventListener('resize', function () { resize(); draw(); wake(); });
    }

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        state.visible = entries.some(function (en) { return en.isIntersecting; });
        if (state.visible) wake();
      });
      io.observe(container);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    resize();
    wake();
  }

  [].slice.call(document.querySelectorAll('[data-shapegrid]')).forEach(mount);
})();
