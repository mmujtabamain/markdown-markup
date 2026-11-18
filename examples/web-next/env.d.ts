/// <reference types="@mkp/next/mkp-md" />
import type { Call, Page } from "@mkp/next";

declare global {
  interface Window {
    /** The running page, for the same-page test. */
    __mkp: { page: Page };
    /** Every extern fn call the app heard, for the same-page test. */
    __calls: Call[];
  }
}
