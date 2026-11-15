import type { Component } from "svelte";
import type { Handle, PageProps } from "@mkp/embed";

declare const MkpPage: Component<PageProps & { class?: string; id?: string }, { handle(): Handle }>;
export default MkpPage;
