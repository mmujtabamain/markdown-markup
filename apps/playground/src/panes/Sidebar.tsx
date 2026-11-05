// The sidebar: the examples in their groups and reading order, each with what it teaches; the
// limits, each with the error it must give; the conformance cases; and what was opened from disk.

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { groupNames, type Entry } from '../catalog';

export interface SidebarProps {
  entries: Entry[];
  selected: string;
  hrefFor: (id: string) => string;
  onSelect: (id: string) => void;
  /** ids with unsaved edits */
  edited: Set<string>;
}

export function Sidebar({ entries, selected, hrefFor, onSelect, edited }: SidebarProps): ReactNode {
  const [q, setQ] = useState('');
  const [casesOpen, setCasesOpen] = useState(() => selected.startsWith('case:'));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter((e) => `${e.num} ${e.title} ${e.teaches ?? ''} ${e.expect?.code ?? ''} ${e.id}`.toLowerCase().includes(s));
  }, [entries, q]);
  const groups = groupNames(shown);
  return (
    <nav className="flex min-h-0 flex-1 flex-col" aria-label="Examples">
      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute top-2.5 left-5 size-4 text-muted-foreground" aria-hidden />
        <Input className="h-8 pl-8 text-sm" type="search" placeholder="Find an example" aria-label="Find an example" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div className="pg-side-list min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {groups.map((g) => {
          const items = shown.filter((e) => e.group === g);
          const isCases = g === 'Cases';
          const open = !isCases || casesOpen || !!q.trim();
          return (
            <section key={g} className="mt-3" data-pg-group={g}>
              {isCases ? (
                <button type="button" className="flex w-full items-center gap-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground" aria-expanded={open} onClick={() => setCasesOpen(!casesOpen)}>
                  <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
                  Cases <span className="font-normal normal-case">({items.length})</span>
                </button>
              ) : (
                <h2 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g}</h2>
              )}
              {open ? (
                <ul className="mt-1 space-y-px">
                  {items.map((e) => (
                    <li key={e.id}>
                      <a
                        href={hrefFor(e.id)}
                        data-pg-entry={e.id}
                        aria-current={e.id === selected ? 'page' : undefined}
                        className="group block rounded-md px-2 py-1.5 text-sm hover:bg-accent aria-[current=page]:bg-accent"
                        onClick={(ev) => {
                          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
                          ev.preventDefault();
                          onSelect(e.id);
                        }}
                      >
                        <span className="flex items-baseline gap-2">
                          {e.num ? <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{e.num}</span> : null}
                          <span className={cn('min-w-0 flex-1 truncate group-aria-[current=page]:font-medium', e.kind === 'case' && 'font-mono text-xs')}>{e.title}</span>
                          {edited.has(e.id) ? <span className="size-1.5 shrink-0 self-center rounded-full bg-info" title="edited" aria-label="edited" /> : null}
                        </span>
                        {e.teaches ? <span className={cn('mt-0.5 block text-xs leading-snug text-muted-foreground', e.num && 'pl-9')}>{e.teaches}</span> : null}
                        {e.expect ? (
                          <span className={cn('mt-1 flex flex-wrap items-center gap-1 text-xs', e.num && 'pl-9')}>
                            <code className="rounded bg-destructive/10 px-1 py-px font-mono text-[11px] text-destructive">{e.expect.code}</code>
                            <span className="text-muted-foreground">{e.expect.line ? `line ${e.expect.line}` : 'while drawing'}</span>
                          </span>
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
        {!groups.length ? <p className="px-2 pt-4 text-sm text-muted-foreground">Nothing matches “{q}”.</p> : null}
      </div>
    </nav>
  );
}
