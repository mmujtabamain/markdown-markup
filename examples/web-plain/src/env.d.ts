import type { Mounted } from "@extended-mark/dom";
import type { Call } from "@extended-mark/runtime";

declare global {
  interface Window {
    /** The mounted page, for the same-page test. */
    __xtmd: Mounted;
    /** Every extern fn call the app heard, for the same-page test. */
    __calls: Call[];
  }
}
