// A block of code in shadcn's style: one bordered box, with its language in a strip along the top.
// With a `line`, it fills its pane as a numbered listing with that line marked.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function CodeBlock({ language, code, line = 0, className, ...props }: ComponentProps<'figure'> & { language: string; code: string; line?: number }) {
  return (
    <figure data-slot="code-block" className={cn('overflow-hidden bg-muted/40', line ? 'm-0' : 'my-3 rounded-md border', className)} {...props}>
      {language ? <figcaption className="border-b px-3 py-1 font-mono text-xs text-muted-foreground">{language}</figcaption> : null}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-sm leading-relaxed">
        {line ? (
          <code className="block">
            {code.split('\n').map((text, i) => (
              <span key={i} aria-current={i + 1 === line ? 'step' : undefined} className={cn('-mx-3 flex gap-3 px-3', i + 1 === line && 'bg-accent font-medium')}>
                <span className="w-4 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
                <span className="whitespace-pre">{text}</span>
              </span>
            ))}
          </code>
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </figure>
  );
}

export { CodeBlock };
