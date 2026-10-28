import { useEffect, useState } from 'react';
import { IconSun, IconMoon } from './Icons';

export type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('cf_sync_theme') as Theme | null;
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cf_sync_theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, setTheme, toggle };
}

export function ThemeToggle({ size = 15 }: { size?: number }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      className="btn-icon"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <IconSun size={size} /> : <IconMoon size={size} />}
    </button>
  );
}
