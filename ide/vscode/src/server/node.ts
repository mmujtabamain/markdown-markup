// The built-in language server on the desktop: xtmd.wasm's server in a Node process the client
// starts, talking over IPC.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LanguageServer } from "@extended-mark/wasm";
import { IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";
import { serve } from "./serve.js";

serve(LanguageServer.load(readFileSync(join(__dirname, "..", "xtmd.wasm"))), new IPCMessageReader(process), new IPCMessageWriter(process));
