// The shop page from plain TypeScript: no framework, just @extended-mark/dom's run.
import { run } from "@extended-mark/dom";
import type { Call } from "@extended-mark/runtime";
import shop from "../../pages/shop.xtmd";

const orders = document.getElementById("orders")!;
window.__calls = [];

/** The app's side of `extern shop`: each checkout the page asks for, listed under it. */
function heard(calls: Call[]): void {
  for (const c of calls) {
    window.__calls.push(c);
    if (c.call.name !== "doc/shop.checkout") continue;
    const [total, count] = c.call.args as { num: string }[];
    const li = document.createElement("li");
    li.textContent = `Order ${orders.children.length + 1}: ${total.num} € for ${count.num} items`;
    orders.append(li);
  }
}

const mounted = run(shop, document.getElementById("shop")!);
mounted.page.onChange(() => heard(mounted.page.takeCalls()));
window.__xtmd = mounted;
