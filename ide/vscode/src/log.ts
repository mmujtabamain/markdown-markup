// What the extension does and what goes wrong, in its output channel (Extended Mark: Show the
// Log). Nothing is sent anywhere: an editor's failures are its user's to read.

import * as vscode from "vscode";

export class Log {
  readonly channel = vscode.window.createOutputChannel("Extended Mark", { log: true });

  info(m: string): void {
    this.channel.info(m);
  }

  warn(m: string): void {
    this.channel.warn(m);
  }

  error(m: string): void {
    this.channel.error(m);
  }
}
