// The shop page in React: <MkpPage> draws it, and the app hears each checkout through onCalls.
import { useState } from "react";
import { MkpPage, type Call } from "@mkp/react";
import shop from "../../pages/shop.mkp.md";

window.__calls = [];

export function Shop() {
  const [orders, setOrders] = useState<string[]>([]);

  /** The app's side of `extern shop`: each checkout the page asks for, listed under it. */
  function heard(calls: Call[]) {
    window.__calls.push(...calls);
    const placed = calls.filter((c) => c.call.name === "doc/shop.checkout").map((c) => c.call.args as { num: string }[]);
    setOrders((o) => [...o, ...placed.map(([total, count], k) => `Order ${o.length + k + 1}: ${total.num} € for ${count.num} items`)]);
  }

  return (
    <main>
      <p className="from">React</p>
      <MkpPage id="shop" ir={shop} onCalls={heard} onMount={(mounted) => (window.__mkp = mounted)} />
      <h2>Orders sent to the app</h2>
      <ul id="orders">
        {orders.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>
    </main>
  );
}
