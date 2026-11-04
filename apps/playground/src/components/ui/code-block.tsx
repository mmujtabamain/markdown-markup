// A block of code in shadcn's style: one bordered box, with its language in a strip along the top.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function CodeBlock({ language, code, className, ...props }: ComponentProps<'figure'> & { language: string; code: string }) {
  return (
    <figure data-slot="code-block" className={cn('my-3 overflow-hidden rounded-md border bg-muted/40', className)} {...props}>
      {language ? <figcaption className="border-b px-3 py-1 font-mono text-xs text-muted-foreground">{language}</figcaption> : null}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export { CodeBlock };
