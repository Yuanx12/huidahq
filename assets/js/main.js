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
    if (location.hash !== '#' + id) location.hash = id;
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
      if (/^#p\d+$/.test(location.hash)) location.hash = 'works';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
    // 按钮本身不需要额外绑定：click 会冒泡到卡片
    window.addEventListener('hashchange', function () {
      var m = /^#(p\d+)$/.exec(location.hash);
      if (m) openProject(m[1]);
    });
    var m0 = /^#(p\d+)$/.exec(location.hash);
    if (m0) openProject(m0[1]);
  }
})();
