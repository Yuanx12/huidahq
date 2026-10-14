/* =============================================================================
   Aurora — WebGL2 极光背景（原生 JS 移植版）
   项目: ColinN · 个人作品集
   来源: React Bits <Aurora /> — 着色器与插值算法照搬，React 薄壳改写为原生实现
   约束: 纯静态 / 零框架 / 零构建 / 本地引入，不触任何技术红线
   降级: 取不到 WebGL2 上下文时静默返回，首屏保持原有深色底 + 网格 + 径向光
   动效: 尊重 prefers-reduced-motion（静态单帧，不跑 rAF）
   ============================================================================= */
(function (window, document) {
  'use strict';

  var MAX_STOPS = 5;
  var MAX_LAYERS = 3;
  var INTRO_SECONDS = 2.4;

  /* ---------------------------------------------------------------- 着色器 */

  var VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  var FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
uniform float uLightMode;
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${MAX_LAYERS}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);

    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);
    cover *= smootherstep(0.0, 0.25, cover);
    float alpha = cover * 0.7;
    outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));
    return;
  }
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`;

  /* ------------------------------------------------------------ 工具函数 */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function toOklch(rgb) {
    var c = rgb.map(function (v) {
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    var m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    var s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    var lab = [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
    return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
  }

  function unwrapHues(stops) {
    var known = -1;
    for (var i = 0; i < stops.length; i++) {
      if (stops[i][1] > 0.02) { known = i; break; }
    }
    var previous = known === -1 ? 0 : stops[known][2];
    return stops.map(function (stop) {
      var hue = stop[1] > 0.02 ? stop[2] : previous;
      while (hue - previous > Math.PI) hue -= Math.PI * 2;
      while (hue - previous < -Math.PI) hue += Math.PI * 2;
      previous = hue;
      return [stop[0], stop[1], hue];
    });
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  function link(gl) {
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    var program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  /* ---------------------------------------------------------- 主挂载函数 */

  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};

    var cfg = {
      colorStops: opts.colorStops || ['#1D4ED8', '#2563EB', '#22D3EE'],
      amplitude: num(opts.amplitude, 1),
      blend: clamp(num(opts.blend, 0.5), 0, 1),
      speed: num(opts.speed, 0.35),
      height: clamp(num(opts.height, 0.42), 0, 1),
      scale: Math.max(0.1, num(opts.scale, 1.1)),
      glow: Math.max(0, num(opts.glow, 0.7)),
      brightness: Math.max(0, num(opts.brightness, 0.55)),
      layers: clamp(Math.round(num(opts.layers, 2)), 1, MAX_LAYERS),
      flip: opts.direction === 'bottom' ? 1 : 0,
      mouseInteraction: opts.mouseInteraction !== false,
      intro: opts.intro !== false,
      opacity: clamp(num(opts.opacity, 0.55), 0, 1),
      lightMode: !!opts.lightMode,
      maxDpr: num(opts.maxDpr, 2)
    };

    var canvas = document.createElement('canvas');
    canvas.className = 'aurora-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    var gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    });
    /* 无 WebGL2：清掉 canvas，首屏保持原有深色底（.hero 的网格与径向光仍在） */
    if (!gl) {
      container.removeChild(canvas);
      return null;
    }

    var built = link(gl);
    if (!built) {
      container.removeChild(canvas);
      return null;
    }
    var u = built.uniforms;

    var buffer = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    /* 颜色解析：借 2D 画布把任意 CSS 颜色转成 rgb，比手写 hex 解析更稳 */
    var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var cache = {};
    var parse = function (value) {
      if (cache[value]) return cache[value];
      var rgb = [1, 1, 1];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#ffffff';
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        var data = probe.getImageData(0, 0, 1, 1).data;
        rgb = [data[0] / 255, data[1] / 255, data[2] / 255];
      }
      cache[value] = rgb;
      return rgb;
    };
    var palette = new Float32Array(MAX_STOPS * 3);
    var stops = (cfg.colorStops || []).slice(0, MAX_STOPS);
    if (stops.length < 2) stops = stops.length === 1 ? [stops[0], stops[0]] : ['#1D4ED8', '#22D3EE'];

    var view = { width: 1, height: 1 };
    var pointer = { x: 0, y: 0, inside: false };
    var state = { clock: 24, px: 0, py: 0.5, reach: 0, reveal: 1 };

    var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduce = reduceQuery ? reduceQuery.matches : false;
    if (cfg.intro && !reduce) state.reveal = 0;

    var raf = 0;
    var last = 0;
    var visible = true;

    var render = function () {
      var oklch = unwrapHues(stops.map(function (value) { return toOklch(parse(value)); }));
      for (var i = 0; i < oklch.length; i++) palette.set(oklch[i], i * 3);

      var reveal = state.reveal;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(built.program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, state.clock);
      gl.uniform3fv(u.uStops, palette);
      gl.uniform1i(u.uStopCount, stops.length);
      gl.uniform1f(u.uAmplitude, cfg.amplitude);
      gl.uniform1f(u.uBlend, cfg.blend);
      gl.uniform1f(u.uHeight, cfg.height);
      gl.uniform1f(u.uScale, cfg.scale);
      gl.uniform1f(u.uGlow, cfg.glow);
      gl.uniform1f(u.uBrightness, cfg.brightness);
      gl.uniform1i(u.uLayers, cfg.layers);
      gl.uniform1f(u.uFlip, cfg.flip);
      gl.uniform3f(u.uPointer, state.px, state.py, state.reach);
      gl.uniform1f(u.uReveal, 1 - Math.pow(1 - reveal, 3));
      gl.uniform1f(u.uOpacity, cfg.opacity);
      gl.uniform1f(u.uLightMode, cfg.lightMode ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    var frame = function (now) {
      raf = 0;
      if (!visible || document.hidden) return;
      var dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
      last = now;

      state.clock += dt * cfg.speed;

      var engaged = cfg.mouseInteraction && pointer.inside && !reduce;
      var follow = 1 - Math.exp(-dt / 0.6);
      if (engaged) {
        var tx = (pointer.x - view.width / 2) / Math.max(1, view.height);
        var ty = cfg.flip ? 1 - pointer.y / view.height : pointer.y / view.height;
        state.px += (tx - state.px) * follow;
        state.py += (ty - state.py) * follow;
      }
      state.reach += ((engaged ? 1 : 0) - state.reach) * (1 - Math.exp(-dt / (engaged ? 0.9 : 1.4)));

      if (!cfg.intro || reduce) state.reveal = 1;
      else if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);

      render();
      raf = window.requestAnimationFrame(frame);
    };

    var wake = function () {
      if (!raf && visible && !document.hidden && !reduce) raf = window.requestAnimationFrame(frame);
    };

    var resize = function () {
      var width = Math.max(1, container.clientWidth);
      var height = Math.max(1, container.clientHeight);
      /* 移动端降采样到 1.5，桌面封顶 2：极光是模糊光斑，不需要满分辨率 */
      var cap = window.innerWidth < 768 ? Math.min(cfg.maxDpr, 1.5) : cfg.maxDpr;
      var ratio = Math.min(window.devicePixelRatio || 1, cap);
      view.width = width;
      view.height = height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      render();
      wake();
    };

    var onPointerMove = function (event) {
      if (!cfg.mouseInteraction || reduce) return;
      var rect = container.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      var wasInside = pointer.inside;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
      if (pointer.inside && !wasInside) {
        state.px = (pointer.x - rect.width / 2) / Math.max(1, rect.height);
        state.py = cfg.flip ? 1 - pointer.y / rect.height : pointer.y / rect.height;
      }
      wake();
    };

    var onPointerUp = function (event) {
      if (event.pointerType !== 'mouse') pointer.inside = false;
    };

    var onPointerLeave = function () { pointer.inside = false; };

    var onVisibility = function () { last = 0; wake(); };

    var onReduceChange = function () {
      reduce = reduceQuery ? reduceQuery.matches : false;
      if (reduce) {
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
        state.reveal = 1;
        state.reach = 0;
        render();
      } else {
        wake();
      }
    };

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    var intersection = new IntersectionObserver(function (entries) {
      visible = entries.some(function (entry) { return entry.isIntersecting; });
      if (visible) { last = 0; wake(); }
      else if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    });
    intersection.observe(container);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    if (reduceQuery && reduceQuery.addEventListener) reduceQuery.addEventListener('change', onReduceChange);

    resize();

    return {
      destroy: function () {
        if (raf) window.cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        if (reduceQuery && reduceQuery.removeEventListener) reduceQuery.removeEventListener('change', onReduceChange);
        gl.deleteProgram(built.program);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    };
  }

  /* ------------------------------------------------------------ 自动挂载 */

  var boot = function () {
    var host = document.querySelector('[data-aurora]');
    if (!host) return;
    var opts = {};
    var raw = host.getAttribute('data-aurora');
    if (raw) {
      try { opts = JSON.parse(raw) || {}; } catch (e) { opts = {}; }
    }
    mount(host, opts);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.AuroraBG = { mount: mount };
})(window, document);
