'use strict';
/* Landing motion layer — vanilla, no dependencies.
   Everything here is progressive: with JS off or reduced-motion on, the page
   still reads and every control still works. */
(function () {
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* ---------- hero entrance ---------- */
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));

  /* ---------- scroll progress ---------- */
  const bar = document.createElement('div');
  bar.className = 'progress';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<i></i>';
  document.body.prepend(bar);
  const barFill = bar.firstElementChild;

  /* ---------- one rAF loop for header state, progress and parallax ---------- */
  const hdr = $('hdr');
  const pImg = document.querySelector('[data-parallax]');
  let ticking = false;

  function frame() {
    const y = window.scrollY || 0;
    if (hdr) hdr.classList.toggle('is-stuck', y > 10);
    if (barFill) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      barFill.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
    }
    if (pImg && !reduce) {
      const box = pImg.parentElement.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) {
        const p = (box.top + box.height / 2 - window.innerHeight / 2) / window.innerHeight;
        pImg.style.setProperty('--py', (p * -44).toFixed(1) + 'px');
      }
    }
    ticking = false;
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- reveals ---------- */
  const revealables = document.querySelectorAll('.reveal, .steps');
  if (reduce || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    revealables.forEach((el) => io.observe(el));
  }

  /* ---------- figure count-up ---------- */
  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    const dec = Number(el.dataset.dec || 0);
    if (!isFinite(target)) return;
    if (reduce) { el.textContent = target.toFixed(dec); return; }
    const dur = 1450;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toFixed(dec);
    };
    requestAnimationFrame(tick);
  }
  const counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        countUp(e.target);
        cio.unobserve(e.target);
      }
    }, { threshold: 0.55 });
    counters.forEach((el) => cio.observe(el));
  } else {
    counters.forEach(countUp);
  }

  /* ---------- data-treatment switch ---------- */
  const toggle = $('dataToggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.pane));
    }));
  }

  /* ---------- faq accordion ---------- */
  document.querySelectorAll('#faq .fq').forEach((fq) => {
    const btn = fq.querySelector('button');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const open = fq.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  /* ---------- price tape: clone the set so the loop is seamless ---------- */
  const tapeRows = $('tapeRows');
  const tapeTrack = $('tapeTrack');
  if (tapeRows && tapeTrack) {
    const sync = () => {
      if (!tapeRows.children.length) return;
      tapeTrack.querySelectorAll('.tape-set.clone').forEach((n) => n.remove());
      const set = document.createElement('div');
      set.className = 'tape-set clone';
      set.setAttribute('aria-hidden', 'true');
      set.innerHTML = tapeRows.innerHTML;
      tapeTrack.appendChild(set);
    };
    new MutationObserver(sync).observe(tapeRows, { childList: true });
    sync();
  }

  /* ---------- price list filter ---------- */
  const pf = $('priceFilter');
  if (pf) {
    pf.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      pf.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (typeof window.applyPriceFilter === 'function') window.applyPriceFilter(b.dataset.f);
    }));
  }

  /* ---------- magnetic buttons (pointer only, transform-only) ---------- */
  if (canHover && !reduce) {
    document.querySelectorAll('[data-magnet]').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        btn.style.setProperty('--mx', (dx * 5).toFixed(2) + 'px');
        btn.style.setProperty('--my', (dy * 4).toFixed(2) + 'px');
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.setProperty('--mx', '0px');
        btn.style.setProperty('--my', '0px');
      });
    });
  }

  /* ---------- nav links when a flow screen is open ---------- */
  document.querySelectorAll('.nvl a').forEach((a) => {
    a.addEventListener('click', (e) => {
      const home = $('scr-home');
      if (!home || !home.classList.contains('hidden')) return;
      e.preventDefault();
      if (typeof window.go === 'function') window.go('home');
      const target = document.querySelector(a.getAttribute('href'));
      if (target) setTimeout(() => target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }), 90);
    });
  });
})();
