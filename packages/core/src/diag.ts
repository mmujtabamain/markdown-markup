// Diagnostics: build errors carry a file, line:column, a code, a message with the fix and the
// element path (spec 6.19).

export interface Pos {
  file: string;
  line: number;
  col: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  pos?: Pos;
  path?: string[];
}

export class MkpError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(code: string, message: string, pos?: Pos, path?: string[]) {
    super(message);
    this.diagnostic = { severity: 'error', code, message, pos, path };
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.pos ? `${d.pos.file}:${d.pos.line}:${d.pos.col} ` : '';
  const head = `${where}${d.severity} ${d.code}: ${d.message}`;
  return d.path && d.path.length ? `${head}\n  ${d.path.join(' › ')}` : head;
}

export class Diagnostics {
  readonly items: Diagnostic[] = [];
  error(code: string, message: string, pos?: Pos, path?: string[]): void {
    this.items.push({ severity: 'error', code, message, pos, path });
  }
  warn(code: string, message: string, pos?: Pos, path?: string[]): void {
    this.items.push({ severity: 'warning', code, message, pos, path });
  }
  add(d: Diagnostic): void {
    this.items.push(d);
  }
  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'error');
  }
  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'warning');
  }
  get ok(): boolean {
    return this.errors.length === 0;
  }
}

/** The closest option by edit distance, for "did you mean" hints. */
export function closest(word: string, options: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = editDistance(word, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== undefined && bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export function didYouMean(word: string, options: Iterable<string>): string {
  const c = closest(word, options);
  return c ? ` (did you mean "${c}"?)` : '';
}
