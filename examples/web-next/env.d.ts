/// <reference types="@mkp/next/mkp-md" />
import type { Call, Mounted } from "@mkp/next";

declare global {
  interface Window {
    /** The mounted page, for the same-page test. */
    __mkp: Mounted;
    /** Every extern fn call the app heard, for the same-page test. */
    __calls: Call[];
  }
}
