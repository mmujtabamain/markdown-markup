// The language server's loop, in a Node process or a web worker: each message from the client to
// the server built into xtmd.wasm (ide/lsp), and what it sends back to the client. Messages that
// come while it loads wait for it.

import type { LanguageServer, LspMessage } from "@extended-mark/wasm";
import type { Message, MessageReader, MessageWriter } from "vscode-jsonrpc";

export function serve(load: Promise<LanguageServer>, reader: MessageReader, writer: MessageWriter): void {
  let server: LanguageServer | undefined;
  let failed: string | undefined;
  const waiting: Message[] = [];
  const log = (type: number, message: string) => writer.write({ jsonrpc: "2.0", method: "window/logMessage", params: { type, message } } as Message);

  const handle = (m: Message) => {
    const id = (m as { id?: unknown }).id;
    if (!server) {
      if (id !== undefined) writer.write({ jsonrpc: "2.0", id, error: { code: -32002, message: failed ?? "the server isn't loaded" } } as Message);
      return;
    }
    try {
      for (const out of server.message(m as unknown as LspMessage)) writer.write(out as unknown as Message);
    } catch (e) {
      // a panic in the compiler: the server starts again, and the client is told
      log(1, e instanceof Error ? e.message : String(e));
      if (id !== undefined) writer.write({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } } as Message);
    }
  };

  reader.listen((m) => (server || failed ? handle(m) : waiting.push(m)));
  load.then(
    (s) => {
      server = s;
      log(3, "Extended Mark's language server is running (xtmd.wasm)");
      for (const m of waiting.splice(0)) handle(m);
    },
    (e) => {
      failed = `xtmd.wasm couldn't be loaded: ${e instanceof Error ? e.message : String(e)}`;
      log(1, failed);
      for (const m of waiting.splice(0)) handle(m);
    },
  );
}
