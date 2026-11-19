import type { Component } from "svelte";
import type { LiveProps } from "@extended-mark/live";
import type { Doc, DocProps, Restored, Snapshot, Value, ir } from "@extended-mark/view";

declare const XtmdLiveDoc: Component<
  Omit<DocProps, "ir" | "src"> & LiveProps & { class?: string; id?: string },
  {
    document(): Doc;
    set(changes: Record<string, ir.Expr | Value>): void;
    getState(): Record<string, ir.Expr>;
    markdown(): string;
    expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void;
    snapshot(): Snapshot;
    restore(snap: Snapshot): Restored;
  }
>;
export default XtmdLiveDoc;
