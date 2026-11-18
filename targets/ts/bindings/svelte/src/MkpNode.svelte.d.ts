import type { Component } from "svelte";
import type { Child } from "@mkp/view";

declare const MkpNode: Component<{ v: Child }>;
export default MkpNode;
