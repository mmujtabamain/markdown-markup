// One answer among others, in shadcn's style: shadcn has radio groups and checkboxes, but no row that
// is itself the control.
import { Check, X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export interface OptionRowProps extends Omit<ComponentProps<'button'>, 'onClick'> {
  kind: 'radio' | 'check';
  selected: boolean;
  verdict?: 'right' | 'wrong';
  onClick(): void;
}

function OptionRow({ kind, selected, verdict, className, children, ...props }: OptionRowProps) {
  return (
    <button
      type="button"
      data-slot="option-row"
      data-state={verdict ?? (selected ? 'chosen' : undefined)}
      role={kind === 'check' ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-left text-sm shadow-xs outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
        'data-[state=chosen]:border-primary data-[state=right]:border-ok data-[state=wrong]:border-destructive',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-4 shrink-0 place-items-center border border-input text-primary-foreground shadow-xs',
          kind === 'check' ? 'rounded-[4px]' : 'rounded-full',
          selected && 'border-primary bg-primary',
          selected && verdict === 'right' && 'border-ok bg-ok',
          selected && verdict === 'wrong' && 'border-destructive bg-destructive',
        )}
      >
        {selected && verdict === 'wrong' ? <X className="size-3" /> : selected && (kind === 'check' || verdict) ? <Check className="size-3" /> : selected ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export { OptionRow };
