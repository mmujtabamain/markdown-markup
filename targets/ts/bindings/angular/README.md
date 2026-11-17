# @mkp/angular

MKP pages in Angular (20 and later): `<mkp-page>`, a standalone component whose own element
@mkp/dom draws the page into, after its view is ready and only in a browser, so it renders on a
server too. Built with ngc in partial mode, as Angular libraries are.

```sh
npm install @mkp/angular
```

```ts
import { Component, ViewChild } from "@angular/core";
import { MkpPage, type Call } from "@mkp/angular";
import shop from "./shop.ir.json"; // written by: mkp build shop.mkp.md --out shop.ir.json

@Component({
  selector: "app-shop",
  imports: [MkpPage],
  template: `
    <mkp-page #page [ir]="shop" (calls)="heard($event)" />
    <button (click)="page.handle?.set({ budget: { num: '80' } })">Raise the budget</button>
  `,
})
export class Shop {
  shop = shop;
  heard(calls: Call[]) { console.log(calls); }
}
```

## Inputs and outputs

Inputs `ir` (required), `state`, `page`, `externs`, `fns`, `widgets`, as in
[@mkp/embed](../embed/README.md#props). Outputs `(calls)`, `(stateChange)`, `(outcome)` and
`(mounted)` for its `onCalls`, `onState`, `onOutcome` and `onMount`. `handle` gives `page`,
`mounted`, `set`, `expose`, `extern`, `state` and `markdown`.
