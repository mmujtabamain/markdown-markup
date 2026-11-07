// 0.2.3 -> 0.2.4: the icons gained two names, more and less (the chevrons down and up). A bundle
// holds the icons' type wherever a type uses it, as the list of names, so the list gains them there;
// nothing draws differently. (Arrows gained lanes=, which nothing written before uses.)

import type { Step } from '../index';
import { walk } from '../walk';

/** The icons' type as 0.2.3 wrote it into a bundle: a choice of the icon names, without more and less. */
const isOldIcons = (o: { t?: unknown; opts?: unknown }): o is { t: 'choice'; opts: string[] } =>
  o.t === 'choice' && Array.isArray(o.opts) && ['prev', 'next', 'lightbulb', 'database'].every((n) => (o.opts as string[]).includes(n)) && !(o.opts as string[]).includes('more');

export const step_0_2_4: Step = {
  from: '0.2.3',
  to: '0.2.4',
  summary: 'nothing to change: the icons gained more and less, and arrows lanes=; a stored bundle’s list of icon names gains the two.',
  renames: [],
  removes: [],
  changes: [],
  ir(roots) {
    walk(roots, (o) => {
      if (!isOldIcons(o)) return;
      o.opts.splice(o.opts.indexOf('next') + 1, 0, 'more', 'less');
    });
  },
};
