// A block of code in shadcn's style: one bordered box, with its language in a strip along the top.
// With a `line`, it fills its pane as a numbered listing with that line marked.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type Mark = { line: number; tone?: string; note?: string; from?: number; to?: number };
const TONE: Record<string, string> = { ok: 'bg-emerald-500/10', bad: 'bg-red-500/10', warn: 'bg-amber-500/12', info: 'bg-sky-500/10', accent: 'bg-accent', muted: 'bg-muted' };

function CodeBlock({ language, code, line = 0, marks = [], className, ...props }: ComponentProps<'figure'> & { language: string; code: string; line?: number; marks?: Mark[] }) {
  const numbered = line > 0 || marks.length > 0;
  return (
    <figure data-slot="code-block" className={cn('overflow-hidden bg-muted/40', line ? 'm-0' : 'my-3 rounded-md border', className)} {...props}>
      {language ? <figcaption className="border-b px-3 py-1 font-mono text-xs text-muted-foreground">{language}</figcaption> : null}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-sm leading-relaxed">
        {numbered ? (
          <code className="block">
            {code.split('\n').map((text, i) => {
              const m = marks.find((x) => x.line === i + 1);
              const tone = m?.tone && m.tone !== 'none' ? m.tone : undefined;
              const part = tone && m?.from ? [m.from - 1, m.to || text.length] : null;
              return (
                <span key={i} aria-current={i + 1 === line ? 'step' : undefined} data-tone={tone} className={cn('-mx-3 flex gap-3 px-3', i + 1 === line && 'bg-accent font-medium', tone && !part && TONE[tone])}>
                  <span className="w-4 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
                  <span className="whitespace-pre">
                    {part ? (
                      <>
                        {text.slice(0, part[0])}
                        <mark className={cn('rounded-sm text-inherit', TONE[tone!])}>{text.slice(part[0], part[1])}</mark>
                        {text.slice(part[1])}
                      </>
                    ) : (
                      text
                    )}
                  </span>
                  {m?.note ? <span className="ml-auto pl-4 font-sans text-xs text-muted-foreground">{m.note}</span> : null}
                </span>
              );
            })}
          </code>
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </figure>
  );
}

export { CodeBlock };
