import { icon } from './icons.ts';

/** Settings shared by the landing and the app (theme) and used by the app (the rest). */
export const SETTINGS_KEY = 'anonimiza-settings';

export interface Settings {
  theme?: 'light' | 'dark' | 'auto';
  sensitivity?: 'high' | 'medium' | 'low';
  backend?: 'auto' | 'wasm';
}

export function readSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Settings;
  } catch {
    return {};
  }
}

export function saveSettings(patch: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...patch }));
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

const isDark = (theme: string) => theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

/** Wire the theme button: it flips between light and dark and remembers the choice. */
export function wireTheme(): void {
  let theme: string = readSettings().theme ?? 'auto';
  const btn = document.getElementById('btn-theme');
  const apply = () => {
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    btn?.replaceChildren(icon(isDark(theme) ? 'sun' : 'moon', 18));
  };
  apply();
  btn?.addEventListener('click', () => {
    theme = isDark(theme) ? 'light' : 'dark';
    saveSettings({ theme: theme as Settings['theme'] });
    document.documentElement.classList.add('theme-anim');
    apply();
    setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
