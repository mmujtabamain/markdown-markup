// A GitHub alert as shadcn's Alert, with its icon and its kind as the title.
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const KINDS: Record<string, { title: string; icon: LucideIcon; tone: string }> = {
  note: { title: 'Note', icon: Info, tone: 'text-info' },
  tip: { title: 'Tip', icon: Lightbulb, tone: 'text-ok' },
  important: { title: 'Important', icon: CircleAlert, tone: 'text-foreground' },
  warning: { title: 'Warning', icon: TriangleAlert, tone: 'text-warn' },
  caution: { title: 'Caution', icon: OctagonAlert, tone: 'text-destructive' },
};

function Callout({ alert, children, ...props }: ComponentProps<'div'> & { alert: string }) {
  const kind = KINDS[alert] ?? KINDS.note;
  return (
    <Alert role="note" data-alert={alert} className="my-3" {...props}>
      <kind.icon className={kind.tone} />
      <AlertTitle className={kind.tone}>{kind.title}</AlertTitle>
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

export { Callout };
