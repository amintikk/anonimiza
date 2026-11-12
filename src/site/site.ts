import '@fontsource-variable/inter';
import '../styles/tokens.css';
import './site.css';
import { t } from '../i18n.ts';
import { hydrateIcons } from '../ui/icons.ts';
import { wireTheme } from '../ui/theme.ts';

// Tell boot.js the script loaded (it would otherwise unhide everything after a while).
(window as unknown as { anonimizaReady?: boolean }).anonimizaReady = true;

function wireNav(): void {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  const set = (open: boolean) => {
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => set(!document.body.classList.contains('nav-open')));
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) set(false);
  });
}

/** Hero card: the data turn into markers and back, while it is on screen. */
function wireDemo(): void {
  const demo = document.getElementById('demo');
  const tab = document.getElementById('demo-tab');
  const text = demo?.querySelector<HTMLElement>('.demo-text');
  if (!demo || !tab || !text) return;
  // The anonymised version is the same paragraph with every value replaced by its marker; both are
  // stacked in one grid cell and cross-fade.
  const body = document.createElement('div');
  body.className = 'demo-body';
  const alt = text.cloneNode(true) as HTMLElement;
  alt.classList.add('alt');
  alt.setAttribute('aria-hidden', 'true');
  for (const d of alt.querySelectorAll<HTMLElement>('.d')) d.textContent = d.dataset.m ?? '';
  text.replaceWith(body);
  body.append(text, alt);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = 0;
  const flip = () => {
    const masked = demo.classList.toggle('masked');
    tab.textContent = masked ? t('Anonimizado') : t('Original');
  };
  if (still) return;
  new IntersectionObserver(([e]) => {
    clearInterval(timer);
    if (e?.isIntersecting) timer = window.setInterval(flip, 2600);
  }).observe(demo);
  setTimeout(flip, 900);
}

/** Blocks fade up as they scroll into view, siblings a few tens of ms apart. */
function wireReveal(): void {
  const items = [
    ...document.querySelectorAll<HTMLElement>(
      '.landing-hero h1, .lead, .hero-actions, .demo, .block h2, .block .intro, .numbered li, .table-wrap, .figs > div, .limits li, .defs > div, .faq details, .closing, .doc h1, .doc .wrap > *, .foot-grid > div',
    ),
  ];
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window);
  if (still) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.style.setProperty('--rv-delay', `${Math.min(n++, 6) * 60}ms`);
        el.classList.add('in');
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -5% 0px', threshold: 0.06 },
  );
  for (const el of items) io.observe(el);
}

/** Figures count up from 0 the first time they come into view. Without JS or with reduced motion they just show. */
function wireCounters(): void {
  const els = [...document.querySelectorAll<HTMLElement>('[data-count]')];
  if (!els.length || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const show = (el: HTMLElement, v: number) => (el.textContent = `${v} %`);
  const run = (el: HTMLElement) => {
    const to = Number(el.dataset.count);
    const t0 = performance.now();
    const ms = 1400;
    const step = (now: number) => {
      const k = Math.min((now - t0) / ms, 1);
      show(el, Math.round(to * (1 - Math.pow(1 - k, 3)))); // ease-out
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        run(e.target as HTMLElement);
      }
    },
    { threshold: 0.6 },
  );
  for (const el of els) {
    el.style.fontVariantNumeric = 'tabular-nums';
    show(el, 0);
    io.observe(el);
  }
}

hydrateIcons();
wireTheme();
wireNav();
wireReveal();
wireCounters();
wireDemo();
