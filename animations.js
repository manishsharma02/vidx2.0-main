/* VidX — AOS + GSAP animation bootstrap */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.matchMedia('(max-width: 768px)').matches;
  // Motion effects are for the public landing page only. App pages (dashboard, admin, etc.)
  // load real data and re-render it, so hiding/animating cards there causes flicker.
  const IS_LANDING = /(^|\/)(index\.html)?$/.test(window.location.pathname);

  function initAOS() {
    if (typeof AOS === 'undefined') return;
    if (window._vidxAosInit) return;
    AOS.init({
      duration: 700,
      once: true,
      offset: 60,
      easing: 'ease-out-cubic',
      disable: (REDUCED || !IS_LANDING) ? true : MOBILE ? 'phone' : false
    });
    window._vidxAosInit = true;
  }

  function initGSAP() {
    if (REDUCED || typeof gsap === 'undefined') return;
    if (typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

    gsap.utils.toArray('.vidx-reveal-left').forEach((el) => {
      if (el.closest('.hero')) {
        gsap.fromTo(el, { opacity: 0, x: -32 }, {
          opacity: 1, x: 0, duration: 0.9, ease: 'power3.out', delay: 0.15
        });
        return;
      }
      gsap.fromTo(el, { opacity: 0, x: -48 }, {
        opacity: 1, x: 0, duration: 0.85, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' }
      });
    });

    gsap.utils.toArray('.vidx-reveal-right').forEach((el) => {
      if (el.closest('.hero')) {
        gsap.fromTo(el, { opacity: 0, x: 32 }, {
          opacity: 1, x: 0, duration: 0.9, ease: 'power3.out', delay: 0.15
        });
        return;
      }
      gsap.fromTo(el, { opacity: 0, x: 48 }, {
        opacity: 1, x: 0, duration: 0.85, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' }
      });
    });

    gsap.utils.toArray('.vidx-reveal-up').forEach((el) => {
      gsap.fromTo(el, { opacity: 0, y: 36 }, {
        opacity: 1, y: 0, duration: 0.75, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none none' }
      });
    });

    if (!IS_LANDING) return;
    gsap.utils.toArray('.card, .stat-card, .prob-card, .feature-card, .form-card, .rank-card, .tier-card, .topic-card, .resource-card, .post-card, .podium-item').forEach((el, i) => {
      if (el.closest('[data-aos]') || el.dataset.gsapDone) return;
      el.dataset.gsapDone = '1';
      gsap.fromTo(el, { opacity: 0, y: 28 }, {
        opacity: 1, y: 0, duration: 0.65, delay: Math.min(i * 0.04, 0.35), ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%', toggleActions: 'play none none none' }
      });
    });

    document.querySelectorAll('.vidx-hero-float').forEach((el) => {
      gsap.to(el, { y: -18, duration: 3.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    });
  }

  function initCardTilt() {
    if (REDUCED || MOBILE || !IS_LANDING) return;
    const selectors = '.card, .stat-card, .prob-card, .feature-card, .form-card, .result-card, .rank-card, .tier-card, .daily-banner';
    document.querySelectorAll(selectors).forEach((card) => {
      if (card.classList.contains('vidx-card-tilt')) return;
      card.classList.add('vidx-card-tilt');
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(800px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-2px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  function initButtonGlow() {
    document.querySelectorAll('.btn, .btn-primary, .btn-run, .btn-submit, button[type="submit"]').forEach((btn) => {
      btn.classList.add('vidx-btn-glow');
    });
  }

  function initFloatingOrbs() {
    if (REDUCED) return;
    const existing = document.querySelectorAll('.orb, .vidx-bg-float');
    existing.forEach((orb, i) => {
      orb.classList.add('vidx-bg-float');
      if (typeof gsap !== 'undefined') {
        gsap.to(orb, {
          x: i % 2 ? 40 : -30,
          y: i % 2 ? -25 : 35,
          duration: 6 + i,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut'
        });
      }
    });
    if (!document.querySelector('.vidx-bg-float') && !document.querySelector('.orb')) {
      const colors = ['#8b5cf6', '#3b82f6', '#06b6d4'];
      colors.forEach((color, i) => {
        const o = document.createElement('div');
        o.className = 'vidx-bg-float';
        o.style.cssText = `width:${220 + i * 60}px;height:${220 + i * 60}px;background:${color};top:${10 + i * 20}%;left:${5 + i * 25}%;`;
        document.body.prepend(o);
        if (typeof gsap !== 'undefined') {
          gsap.to(o, { x: i * 30, y: -20, duration: 7 + i, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        }
      });
    }
  }

  function initPageEnter() {
    // intentionally empty: the old fade-in restarted after first paint (flash) and the
    // leftover transform broke position:fixed sidebars/modals.
  }

  function initLeaderboardAnimations() {
    if (REDUCED || typeof gsap === 'undefined' || !IS_LANDING) return;
    const rows = document.querySelectorAll('.rank-card, .mini-rank, .podium-item, .lb-row');
    rows.forEach((row, i) => {
      if (row.dataset.lbAnim) return;
      row.dataset.lbAnim = '1';
      gsap.fromTo(row, { opacity: 0, x: i % 2 ? 24 : -24 }, {
        opacity: 1, x: 0, duration: 0.55, delay: Math.min(i * 0.07, 0.45), ease: 'power2.out',
        scrollTrigger: { trigger: row, start: 'top 94%', toggleActions: 'play none none none' }
      });
    });
  }

  function initCounterAnimations() {
    if (REDUCED) return;
    document.querySelectorAll('[data-count]').forEach((el) => {
      if (el.dataset.countDone) return;
      const run = () => {
        if (el.dataset.countDone) return;
        el.dataset.countDone = '1';
        const target = parseInt(el.dataset.count, 10) || 0;
        const suffix = el.dataset.suffix || '';
        const obj = { val: 0 };
        if (typeof gsap !== 'undefined') {
          gsap.to(obj, {
            val: target, duration: 2, ease: 'power2.out',
            onUpdate: () => { el.textContent = Math.floor(obj.val) + suffix; }
          });
        }
      };
      if (typeof IntersectionObserver !== 'undefined') {
        const obs = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) { run(); obs.disconnect(); }
        }, { threshold: 0.3 });
        obs.observe(el.closest('.stats-bar, .stat-grid, section') || el);
      } else {
        run();
      }
    });
  }

  function initSmoothLinks() {
    return; // removed: delayed navigation and left pages dimmed when coming back
    if (REDUCED) return;
    document.querySelectorAll('a[href$=".html"]').forEach((link) => {
      if (link.target === '_blank' || link.hostname !== location.hostname) return;
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        e.preventDefault();
        document.body.style.transition = 'opacity 0.25s ease';
        document.body.style.opacity = '0.4';
        setTimeout(() => { window.location.href = href; }, 220);
      });
    });
  }

  function ensureAboveFoldVisible() {
    document.querySelectorAll('.hero-content, .stats-bar, .navbar').forEach((el) => {
      el.style.opacity = '1';
    });
    document.querySelectorAll('.vidx-reveal-left, .vidx-reveal-right, .vidx-reveal-up').forEach((el) => {
      if (el.closest('.hero')) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
    });
  }

  function boot() {
    ensureAboveFoldVisible();
    initAOS();
    initPageEnter();
    initButtonGlow();
    if (!IS_LANDING) return;
    initFloatingOrbs();
    initCardTilt();
    if (typeof gsap !== 'undefined') {
      initGSAP();
    } else {
      document.querySelectorAll('.vidx-reveal-left, .vidx-reveal-right, .vidx-reveal-up').forEach((el) => {
        el.style.opacity = '1';
      });
    }
    initSmoothLinks();
    if (IS_LANDING) initLeaderboardAnimations();
    initCounterAnimations();
  }

  window.VidXAnimations = {
    init: boot,
    refresh() {
      if (!IS_LANDING) return;
      if (window.AOS) AOS.refresh();
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
      if (IS_LANDING) { initCardTilt(); initLeaderboardAnimations(); }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
