// The built-in language server in a browser (vscode.dev, github.dev): xtmd.wasm's server in a web
// worker, xtmd.wasm fetched from beside this script.

import { LanguageServer } from "@extended-mark/wasm";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-jsonrpc/browser";
import { serve } from "./serve.js";

declare const self: DedicatedWorkerGlobalScope;

const wasm = fetch(new URL("../xtmd.wasm", self.location.href));
serve(wasm.then((r) => LanguageServer.load(r)), new BrowserMessageReader(self), new BrowserMessageWriter(self));
