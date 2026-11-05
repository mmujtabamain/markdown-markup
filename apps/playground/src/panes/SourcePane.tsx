// The source pane: the document, its own file and its packs' files as tabs, an editor that
// compiles as you type, and the problems under it.

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SourceFile } from '../catalog';
import { Editor, type Jump, type Mark } from '../editor/Editor';
import { DiagList, type DiagItem } from './DiagList';

export interface SourcePaneProps {
  files: SourceFile[];
  active: string;
  onActive: (path: string) => void;
  onEdit: (path: string, text: string) => void;
  diags: DiagItem[];
  jump: Jump | null;
  onJump: (d: DiagItem) => void;
  /** paths with edits, and a way to put them back */
  edited: Set<string>;
  onReset: () => void;
  status: ReactNode;
  /** a conformance case: its JSON, read only */
  readOnly?: { path: string; text: string };
  expect?: { code: string; line: number };
}

function fileLabel(f: SourceFile): string {
  if (f.role === 'doc') return f.path.replace(/^.*\//, '');
  if (f.role === 'docFile') return f.path.replace(/^.*\//, '');
  return `${f.pack!.replace(/^.*\//, '')}/${f.inPack}`;
}

export function SourcePane(p: SourcePaneProps): ReactNode {
  const file = p.files.find((f) => f.path === p.active) ?? p.files[0];
  const marks: Mark[] = file ? p.diags.filter((d) => d.file === file.path && d.line).map((d) => ({ line: d.line!, col: d.col ?? 1, severity: d.severity, message: `${d.code}: ${d.message}` })) : [];
  const count = (path: string): number => p.diags.filter((d) => d.file === path && d.severity === 'error').length;
  return (
    <div className="flex h-full min-h-0 flex-col" data-pg-pane="source">
      {p.files.length > 1 ? (
        <div className="pg-filetabs flex shrink-0 gap-px overflow-x-auto border-b bg-muted/40 px-1" role="tablist" aria-label="Files">
          {p.files.map((f) => (
            <button
              key={f.path}
              type="button"
              role="tab"
              aria-selected={f.path === file?.path}
              data-pg-file={f.path}
              className={cn('flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground', f.path === file?.path && 'border-foreground text-foreground')}
              onClick={() => p.onActive(f.path)}
            >
              {fileLabel(f)}
              {p.edited.has(f.path) ? <span className="size-1.5 rounded-full bg-info" aria-label="edited" /> : null}
              {count(f.path) ? <span className="rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-white">{count(f.path)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono" title={file?.path ?? p.readOnly?.path}>
          {file?.path ?? p.readOnly?.path}
        </span>
        {p.status}
        {p.edited.size ? (
          <Button variant="ghost" size="xs" onClick={p.onReset} title="Put the example back as it was">
            <RotateCcw /> Reset
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {file ? (
          <Editor path={file.path} value={file.text} marks={marks} onChange={(t) => p.onEdit(file.path, t)} jump={p.jump} label={`Source: ${file.path}`} />
        ) : p.readOnly ? (
          <Editor path={p.readOnly.path} value={p.readOnly.text} marks={[]} readOnly label={`Case: ${p.readOnly.path}`} />
        ) : null}
      </div>
      {file ? (
        <section className="max-h-[35%] shrink-0 overflow-y-auto border-t" aria-label="Problems">
          {p.expect ? (
            <p className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              Fails on purpose: expects <code className="font-mono text-foreground">{p.expect.code}</code> {p.expect.line ? `at line ${p.expect.line}` : 'while drawing'}.
            </p>
          ) : null}
          <DiagList items={p.diags} onJump={p.onJump} compact docFile={p.files[0]?.path} />
        </section>
      ) : null}
    </div>
  );
}
