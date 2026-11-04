// The catalog an agent keeps in context (spec 12): one line per widget, and full signatures.

import type { IRDef } from './ir';
import { valSrc } from './print';
import { resolve, showType, TypeEnv } from './types';

/** roots@1(n: int 2..12 = 5, level: choice(intro|exam) = intro, labels: bool = true) — The n-th roots … */
export function indexLine(d: IRDef, env: TypeEnv): string {
  const args = d.inputs.map((i) => `${i.name}: ${showType(i.type)}${i.default ? ` = ${valSrc(i.default, resolve(i.type, env))}` : ''}`);
  const req = d.requires?.length ? ` [requires ${d.requires.join(', ')}]` : '';
  const kind = d.kind === 'widget' ? '' : `${d.kind} `;
  return `${kind}${d.name}@${d.version}(${args.join(', ')})${req} — ${d.about ?? ''}`.trimEnd();
}

/** The full signature of a definition, for `mkp show`. */
export function signatureText(d: IRDef, env: TypeEnv): string {
  const out = [`${d.kind === 'widget' ? 'widget' : d.kind} ${d.name}@${d.version} (pack ${d.pack})`, d.about ?? ''];
  if (d.requires?.length) out.push(`requires ${d.requires.join(', ')}`);
  if (d.fields?.length) out.push(`fields: ${d.fields.join(' ')}`);
  out.push('inputs:');
  for (const i of d.inputs) out.push(`  ${i.name}: ${showType(i.type)}${i.default ? ` = ${valSrc(i.default, resolve(i.type, env))}` : ' (required)'}${i.about ? `  — ${i.about}` : ''}`);
  if (d.outs?.length) out.push('events (out):', ...d.outs.map((o) => `  ${o.name}${o.payload ? ' ' + showType(o.payload) : ''}${o.about ? `  — ${o.about}` : ''}`));
  if (d.signals?.length) out.push('signals:', ...d.signals.map((s) => `  ${s.name} ${showType(s.payload)}${s.about ? `  — ${s.about}` : ''}`));
  const hosts = (d.values ?? []).filter((v) => v.k === 'host');
  if (hosts.length) out.push('host inputs:', ...hosts.map((h) => `  ${h.name}: ${showType((h as { type: import('./types').Type }).type)}`));
  if (d.commands?.length) out.push('commands:', ...d.commands.map((c) => `  ${c.name}${c.payload ? ' ' + showType(c.payload) : ''}${c.about ? `  — ${c.about}` : ''}`));
  if (d.project) out.push(`projections: ${Object.keys(d.project).join(', ')}`);
  return out.filter((l) => l !== '').join('\n');
}
