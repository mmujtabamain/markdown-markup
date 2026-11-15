import type { Mounted } from "@mkp/dom";
import type { Call } from "@mkp/runtime";

declare global {
  interface Window {
    /** The mounted page, for the same-page test. */
    __mkp: Mounted;
    /** Every extern fn call the app heard, for the same-page test. */
    __calls: Call[];
  }
}
