// A list of diagnostics, each a button that puts the editor's cursor on its line.

import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DiagItem {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  path?: string[];
  /** compile: from the compiler; draw: an error a block drew in its place (a runtime limit) */
  stage: 'compile' | 'draw';
}

export function DiagList({ items, onJump, compact, docFile, empty = 'No problems.' }: { items: DiagItem[]; onJump: (d: DiagItem) => void; compact?: boolean; docFile?: string; empty?: string }): ReactNode {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground" data-pg-diags="0">
        <CircleCheck className="size-4 text-ok" aria-hidden /> {empty}
      </p>
    );
  }
  return (
    <ul className="divide-y" data-pg-diags={items.length}>
      {items.map((d, i) => {
        const Icon = d.severity === 'error' ? CircleAlert : TriangleAlert;
        const where = d.line ? `${d.file && d.file !== docFile ? `${d.file.replace(/^.*\//, '')}:` : ''}${d.line}:${d.col ?? 1}` : '';
        return (
          <li key={i}>
            <button
              type="button"
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
              data-pg-diag=""
              data-code={d.code}
              data-line={d.line ?? 0}
              data-file={d.file ?? ''}
              data-severity={d.severity}
              data-stage={d.stage}
              disabled={!d.line}
              onClick={() => onJump(d)}
              title={d.line ? 'Show this line in the source' : undefined}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', d.severity === 'error' ? 'text-destructive' : 'text-warn')} aria-label={d.severity} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <code className="font-mono text-xs font-medium">{d.code}</code>
                  {where ? <span className="font-mono text-xs text-muted-foreground">{where}</span> : null}
                  {d.stage === 'draw' ? <span className="rounded bg-muted px-1 text-[11px] text-muted-foreground">while drawing</span> : null}
                </span>
                <span className={cn('block break-words', compact ? 'line-clamp-2 text-xs' : 'text-sm')}>{d.message}</span>
                {!compact && d.path?.length ? <span className="block font-mono text-xs text-muted-foreground">{d.path.join(' › ')}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
