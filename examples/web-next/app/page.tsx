// A server component: the page's Markdown as HTML, with its starting values, so search engines and
// readers without JavaScript get the shop; <MkpPage> takes the element over in the browser.
import { pageHtml } from "@mkp/next/server";
import shop from "../../pages/shop.mkp.md";
import { Shop } from "./shop";

export default function Home() {
  return <Shop html={pageHtml(shop)} />;
}
