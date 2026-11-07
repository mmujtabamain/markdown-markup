// What the site's pages share: the theme (kept in storage, shared with the examples), the logo, and
// the header with the site's sections.
import { useEffect, useState, type ReactNode } from 'react';
import { Github, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const REPO = 'https://github.com/mmujtabamain/markdown-markup';

export type Theme = 'light' | 'dark';
const initialTheme = (): Theme => {
  try {
    const t = localStorage.getItem('site/theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // storage may be off
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('site/theme', theme);
      localStorage.setItem('pg/theme', theme);
    } catch {
      // storage may be off
    }
  }, [theme]);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}

/** The site's sections. `up` is the way from this page to the site's root ('' or '../'). */
export type Section = 'home' | 'docs' | 'examples';

export function Logo({ up = '' }: { up?: string }): ReactNode {
  return (
    <a href={up || './'} className="flex items-center gap-2 font-semibold" aria-label="MKP home" data-site-home="">
      <span className="grid size-7 place-items-center rounded-md bg-brand font-mono text-[11px] font-bold text-primary-foreground shadow-sm" aria-hidden>
        M↓
      </span>
      <span className="tracking-tight">MKP</span>
      <span className="hidden text-sm font-normal text-muted-foreground sm:inline">Markdown Markup</span>
    </a>
  );
}

/** Docs and Examples: the site's two sections, the current one marked. */
export function SectionLinks({ at, up = '' }: { at: Section; up?: string }): ReactNode {
  return (
    <>
      {(['docs', 'examples'] as const).map((s) => (
        <Button key={s} variant="ghost" size="sm" asChild className={cn(at === s && 'bg-accent text-accent-foreground')}>
          <a href={`${up}${s}/`} aria-current={at === s ? 'page' : undefined} data-site-section={s}>
            {s === 'docs' ? 'Docs' : 'Examples'}
          </a>
        </Button>
      ))}
    </>
  );
}

export function SiteHeader({ theme, toggle, at, up = '', wide, before }: { theme: Theme; toggle: () => void; at: Section; up?: string; wide?: boolean; before?: ReactNode }): ReactNode {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className={cn('mx-auto flex h-14 items-center gap-2 px-4', wide ? 'max-w-none' : 'max-w-6xl')}>
        {before}
        <Logo up={up} />
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Site">
          <SectionLinks at={at} up={up} />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <a href={`${REPO}/releases`}>Releases</a>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={REPO} aria-label="MKP on GitHub">
              <Github />
            </a>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </nav>
      </div>
    </header>
  );
}
