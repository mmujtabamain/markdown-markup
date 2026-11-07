// Markdown's blocks as components, with the classes of shadcn's typography page.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Paragraph({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('leading-7 not-first:mt-4', className)} {...props} />;
}

const HEADINGS = [
  'scroll-m-20 text-3xl font-bold tracking-tight',
  'scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight',
  'scroll-m-20 text-xl font-semibold tracking-tight',
  'scroll-m-20 text-lg font-semibold tracking-tight',
  'scroll-m-20 text-base font-semibold tracking-tight',
  'scroll-m-20 text-sm font-semibold tracking-tight',
];

function Heading({ level, className, ...props }: ComponentProps<'h2'> & { level: number }) {
  const H = `h${level}` as 'h2';
  return <H className={cn(HEADINGS[level - 1], 'mt-6 mb-2 first:mt-0', className)} {...props} />;
}

function List({ ordered, className, ...props }: ComponentProps<'ol'> & { ordered?: boolean }) {
  const L = ordered ? 'ol' : 'ul';
  return <L className={cn('my-3 ml-6 leading-7 [&>li]:mt-1 [&_li_p]:mt-0', ordered ? 'list-decimal' : 'list-disc', className)} {...props} />;
}

function Quote({ className, ...props }: ComponentProps<'blockquote'>) {
  return <blockquote className={cn('my-3 border-l-2 pl-4 text-muted-foreground italic', className)} {...props} />;
}

function Footnote({ label, children, className, ...props }: ComponentProps<'div'> & { label: string }) {
  return (
    <div className={cn('mt-2 flex items-baseline gap-1 text-sm text-muted-foreground', className)} {...props}>
      <sup className="tabular-nums">{label}</sup>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export { Footnote, Heading, List, Paragraph, Quote };
