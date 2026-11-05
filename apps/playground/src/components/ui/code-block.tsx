// A block of code in shadcn's style: one bordered box, with its language in a strip along the top.
// With a `line` or marks, it is a numbered listing: the current line marked, toned lines and toned
// parts of lines, and a note at a line's end. With `onPick`, each line can be pressed.
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Mark = { line: number; tone?: string; note?: string; from?: number; to?: number };
const TONE: Record<string, string> = { ok: 'bg-emerald-500/10', bad: 'bg-red-500/10', warn: 'bg-amber-500/12', info: 'bg-sky-500/10', accent: 'bg-accent', muted: 'bg-muted' };
const toned = (m: Mark): string | undefined => (m.tone && m.tone !== 'none' && TONE[m.tone] ? m.tone : undefined);

/** A line's text with every toned part of it marked, in order and never overlapping. */
function parts(text: string, mine: Mark[]): ReactNode {
  const spans = mine.filter((m) => m.from && toned(m)).sort((p, q) => p.from! - q.from!);
  if (!spans.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of spans) {
    const a = Math.max(at, m.from! - 1);
    const b = Math.max(a, m.to || text.length);
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={a} className={cn('rounded-sm text-inherit', TONE[toned(m)!])}>{text.slice(a, b)}</mark>);
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function CodeBlock({ language, code, line = 0, marks = [], onPick, className, ...props }: ComponentProps<'figure'> & { language: string; code: string; line?: number; marks?: Mark[]; onPick?: (line: number) => void }) {
  const numbered = line > 0 || marks.length > 0 || !!onPick;
  return (
    // a listing fills its pane; a plain block is a bordered box in the flow
    <figure data-slot="code-block" className={cn('overflow-hidden bg-muted/40', numbered ? 'm-0' : 'my-3 rounded-md border', className)} {...props}>
      {language ? <figcaption className="border-b px-3 py-1 font-mono text-xs text-muted-foreground">{language}</figcaption> : null}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-sm leading-relaxed">
        {numbered ? (
          <code className="block">
            {code.split('\n').map((text, i) => {
              const mine = marks.filter((x) => x.line === i + 1);
              // a mark without columns tones the whole line; the last note is said at its end
              const whole = mine.find((m) => !m.from && toned(m));
              const tone = whole ? toned(whole) : mine.map(toned).find(Boolean);
              const note = [...mine].reverse().find((m) => m.note)?.note;
              // a line the reader can press: a button for the pointer and the keyboard
              const pick = onPick
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `line ${i + 1}`,
                    onClick: () => onPick(i + 1),
                    onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      onPick(i + 1);
                    },
                  }
                : {};
              return (
                <span key={i} {...pick} aria-current={i + 1 === line ? 'step' : undefined} data-tone={tone} className={cn('-mx-3 flex gap-3 px-3', i + 1 === line && 'bg-accent font-medium', whole && TONE[toned(whole)!], onPick && 'cursor-pointer hover:bg-muted')}>
                  <span className="w-4 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
                  <span className="whitespace-pre">{parts(text, mine)}</span>
                  {note ? <span className="ml-auto pl-4 font-sans text-xs text-muted-foreground">{note}</span> : null}
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
