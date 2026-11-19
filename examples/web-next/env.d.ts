/// <reference types="@extended-mark/next/xtmd-md" />
import type { Call, Page } from "@extended-mark/next";

declare global {
  interface Window {
    /** The running page, for the same-page test. */
    __xtmd: { page: Page };
    /** Every extern fn call the app heard, for the same-page test. */
    __calls: Call[];
  }
}
