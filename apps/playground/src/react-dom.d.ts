// react-dom's client entry, as the Targets page uses it: its types (@types/react-dom) aren't needed
// for one function.
declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export function createRoot(container: Element): { render(node: ReactNode): void; unmount(): void };
}
