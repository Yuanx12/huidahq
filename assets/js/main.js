/* ==========================================================================
   路径: assets/js/main.js
   项目: ColinN · 个人作品集
   说明: 原生 JS，零依赖。负责：吸顶状态 / 移动端导航 / 滚动高亮（scroll spy）/
         滚动淡入 / 复制邮箱 / 版权年份
   ========================================================================== */
(function () {
  'use strict';

  var d = document;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------- 0. 首屏入场
     样式在 CSS 里（.hero-in 的 opacity/transform + 各自 --hd 延迟），
     JS 只负责加 .is-in。双 rAF 是为了确保初始态已经被浏览器采样过，
     否则一帧内加类不会触发 transition。 */
  var heroIns = [].slice.call(d.querySelectorAll('.hero-in'));
  if (heroIns.length) {
    var playHero = function () {
      heroIns.forEach(function (el) { el.classList.add('is-in'); });
    };
    if (reduceMotion) { playHero(); }
    else { window.requestAnimationFrame(function () { window.requestAnimationFrame(playHero); }); }
  }

  /* ------------------------------------------------------------ 1. 吸顶 */
  var header = d.getElementById('siteHeader');
  function syncHeader() {
    if (header) header.classList.toggle('is-stuck', window.scrollY > 8);
  }
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  /* -------------------------------------------------------- 2. 移动端导航 */
  var toggle = d.getElementById('navToggle');
  var nav = d.getElementById('primaryNav');

  function setNav(open) {
    if (!toggle || !nav) return;
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    d.body.classList.toggle('nav-open', open);
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setNav(false);
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNav(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 768) setNav(false);
    });
  }

  /* --------------------------------------------------- 3. 滚动高亮（spy）
     用「判定线」而不是 IntersectionObserver：区块高度差异大时 IO 的
     rootMargin 判定会来回跳，导致右上角导航高亮闪烁。这里统一按
     「区块顶部越过页眉下沿」来判定，结果稳定。 */
  var links = [].slice.call(d.querySelectorAll('.nav a[href^="#"]'));
  var sections = links
    .map(function (a) { return d.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  function setActive(id) {
    links.forEach(function (a) {
      var on = a.getAttribute('href') === '#' + id;
      a.classList.toggle('is-active', on);
      if (on) { a.setAttribute('aria-current', 'true'); }
      else { a.removeAttribute('aria-current'); }
    });
  }

  /* 点击导航后有一个平滑滚动过程，这期间再按滚动位置算高亮会出现
     「作品 → 能力 → 作品」的跳变，所以加一个短锁：滚动到位前锁住目标项，
     用户一旦自己滚轮/触摸/按键就立即解锁。 */
  var lockId = null;
  var lockUntil = 0;

  function spy() {
    if (!sections.length) return;
    if (lockId && Date.now() < lockUntil) { setActive(lockId); return; }
    var headerH = header ? header.offsetHeight : 0;
    /* 判定线放在视口上方 1/3 处。若贴着头顶判定，首屏很高时会「已经翻到
       能力栈、导航还亮着首页」；用 1/3 线，区块真正占据视野才切换。 */
    var line = headerH + (window.innerHeight - headerH) / 3;
    var current = sections[0].id;
    sections.forEach(function (s) {
      if (s.getBoundingClientRect().top - line <= 0) current = s.id;
    });
    // 滚到页面底部时，强制高亮最后一个区块（否则最后一个永远点不亮）
    var doc = d.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      current = sections[sections.length - 1].id;
    }
    setActive(current);
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { spy(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', spy);
  window.addEventListener('hashchange', spy);
  // 点击导航立即点亮，并在滚动动画期间锁住这一项
  links.forEach(function (a) {
    a.addEventListener('click', function () {
      lockId = a.getAttribute('href').slice(1);
      lockUntil = Date.now() + 900;
      setActive(lockId);
    });
  });
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { lockId = null; lockUntil = 0; }, { passive: true });
  });
  spy();

  /* --------------------------------------------------------- 4. 滚动淡入 */
  var revealEls = [].slice.call(d.querySelectorAll('.reveal'));
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i % 4, 3) * 60) + 'ms';
      io.observe(el);
    });
  }

  /* --------------------------------------------------------- 5. 复制邮箱 */
  var copyBtn = d.getElementById('copyEmail');
  if (copyBtn && navigator.clipboard) {
    copyBtn.addEventListener('click', function () {
      var mail = copyBtn.getAttribute('data-email') || '';
      navigator.clipboard.writeText(mail).then(function () {
        var old = copyBtn.textContent;
        copyBtn.textContent = '已复制';
        window.setTimeout(function () { copyBtn.textContent = old; }, 1600);
      });
    });
  }

  /* ----------------------------------------------------------- 6. 年份 */
  var yearEl = d.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------- 7. 项目详情弹层
     内容写在每张卡片里的 .work-detail（隐藏但保留在 DOM 里，方便直接改 HTML），
     打开时搬进唯一的 <dialog>。原生 dialog 自带焦点陷阱、Esc 关闭、层级管理。
     同时用 hash（#p01）做深链，可分享、可前进后退。 */
  var dlg = d.getElementById('projectDialog');
  var pdBody = d.getElementById('pdBody');
  var pdTitle = d.getElementById('pdTitle');
  var pdStatus = d.getElementById('pdStatus');
  var pdClose = d.getElementById('pdClose');
  var lastFocus = null;

  /* 改地址栏的 hash 必须用 history.pushState / replaceState，不能用
     `location.hash = 'works'`：后者是一次「片段导航」，浏览器会滚到对应
     锚点——关闭详情时就把页面拽回作品区顶部（实测从 2600 跳到 1388），
     这就是「退出详情页后页面往上滑」的原因。pushState 只改地址栏，
     不触发滚动，也不产生 history 条目以外的副作用。 */
  function setHash(id, replace) {
    // id 传 null = 清掉 hash（回到干净的 URL，不留任何可滚动的锚点）
    var base = location.href.split('#')[0];
    var target = id ? '#' + id : base;
    var current = id ? location.hash : location.href;
    if (current === target) return;
    try {
      history[replace ? 'replaceState' : 'pushState'](null, '', target);
    } catch (e) { /* 少数环境（含 file://）会拒绝，忽略：只是地址栏不同步 */ }
  }

  function openProject(id) {
    var card = d.querySelector('.work-card[data-project="' + id + '"]');
    var detail = d.getElementById('detail-' + id);
    if (!card || !detail || !dlg || dlg.open) return;

    var h3 = card.querySelector('h3');
    var st = card.querySelector('.work-status');
    pdTitle.textContent = h3 ? h3.textContent : '项目详情';
    pdStatus.textContent = st ? st.textContent : '';
    pdBody.innerHTML = detail.innerHTML;

    lastFocus = d.activeElement;
    // 锁背景滚动；补上滚动条宽度，避免页面横向抖一下
    var sw = window.innerWidth - d.documentElement.clientWidth;
    if (sw > 0) d.body.style.paddingRight = sw + 'px';
    d.body.classList.add('pd-open');

    if (typeof dlg.showModal === 'function') { dlg.showModal(); }
    else { dlg.setAttribute('open', ''); }
    pdBody.scrollTop = 0;
    setHash(id, false);
  }

  function closeProject() {
    if (!dlg || !dlg.open) return;
    if (typeof dlg.close === 'function') { dlg.close(); }
    else { dlg.removeAttribute('open'); }
  }

  if (dlg) {
    [].slice.call(d.querySelectorAll('.work-card[data-project]')).forEach(function (card) {
      card.addEventListener('click', function () { openProject(card.getAttribute('data-project')); });
    });
    if (pdClose) pdClose.addEventListener('click', closeProject);
    // 点击遮罩关闭：此时事件的 target 就是 dialog 本身
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeProject(); });
    dlg.addEventListener('close', function () {
      d.body.classList.remove('pd-open');
      d.body.style.paddingRight = '';
      if (/^#p\d+$/.test(location.hash)) setHash(null, true);
      // 焦点回到原卡片；preventScroll 避免浏览器再滚一次（focus 默认会把
      // 元素滚进视野，卡片不在视野里时就会再次位移）
      if (lastFocus && lastFocus.focus) {
        try { lastFocus.focus({ preventScroll: true }); }
        catch (e) { lastFocus.focus(); }
      }
    });
    // 按钮本身不需要额外绑定：click 会冒泡到卡片
    // pushState 不会触发 hashchange，所以前进/后退要监听 popstate；
    // hashchange 保留给「手动改地址栏」这种片段导航。
    function syncFromHash() {
      var m = /^#(p\d+)$/.exec(location.hash);
      if (m) { openProject(m[1]); } else { closeProject(); }
    }
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
    var m0 = /^#(p\d+)$/.exec(location.hash);
    if (m0) openProject(m0[1]);
  }

  /* ------------------------------------------------------- 8. 边缘发光
     移植自 React Bits 的 <BorderGlow /> 的 JS 部分：pointermove 时算出
     「离边缘多近」和「光标在哪个角度」，写成两个 CSS 变量，剩下的全交给 CSS。
     原组件是 React 的 onPointerMove + useRef，这里换成每个卡片自己监听
     pointermove —— 只在指针真的在卡片上时才触发，比在 document 上委托再
     closest() 更省，也不用每帧 getBoundingClientRect 找目标。
     两个提前 return：触摸设备没有 hover（CSS 已改成描边常亮），
     reduced-motion 下三层都被 CSS 关掉，两种情况都不需要绑事件。 */
  var glows = [].slice.call(d.querySelectorAll('.edge-glow'));
  if (glows.length && window.matchMedia('(hover: hover)').matches && !reduceMotion) {
    glows.forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        var r = card.getBoundingClientRect();
        var dx = e.clientX - r.left - r.width / 2;
        var dy = e.clientY - r.top - r.height / 2;
        // kx / ky = 到边缘还剩几个半宽/半高；取小的那个决定「有多靠边」
        var kx = dx !== 0 ? (r.width / 2) / Math.abs(dx) : Infinity;
        var ky = dy !== 0 ? (r.height / 2) / Math.abs(dy) : Infinity;
        // 中心 = 0，边缘 = 1
        var edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
        var deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if (deg < 0) deg += 360;
        card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
        card.style.setProperty('--cursor-angle', deg.toFixed(3) + 'deg');
      }, { passive: true });
    });
  }
})();
