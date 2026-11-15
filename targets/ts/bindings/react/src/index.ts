"use client";
// @mkp/react: an MKP page in a React app. <MkpPage> renders one empty element, and @mkp/dom draws
// the page into it once it is in the document, so it renders on a server too (as that empty
// element, or the pre-rendered HTML it is given) and mounts on the client.

import { createElement, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactElement, type Ref } from "react";
import { Embed, type Handle, type PageProps } from "@mkp/embed";

export interface MkpPageProps extends PageProps {
  /** The page's handle, once it is mounted: `set`, `expose`, `extern`, `state`, `markdown`. */
  ref?: Ref<Handle | null>;
  /** HTML shown until the page mounts: `pageHtml` from @mkp/next/server or @mkp/embed/html, for
   * search engines and readers without JavaScript. Read once; the page replaces it. */
  html?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/** An MKP page. Props other than `state` and `html` are followed: `page` calls page.setPage, a new
 * `ir` or `widgets` remounts it keeping `$state`, a changed channel in `externs` sets its values. */
export function MkpPage({ ref, html, id, className, style, ...props }: MkpPageProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const embed = useRef<Embed | null>(null);
  const [handle, setHandle] = useState<Handle | null>(null);
  // the HTML is the server's: kept as first given, so React never writes over the drawn page
  const [first] = useState(html);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const e = new Embed(root.current!, latest.current);
    embed.current = e;
    setHandle(e);
    return () => {
      e.destroy();
      embed.current = null;
      setHandle(null);
    };
  }, []);

  // after every render: the embed works out what changed
  useEffect(() => {
    embed.current?.update(props);
  });

  useImperativeHandle<Handle | null, Handle | null>(ref, () => handle, [handle]);

  return createElement("div", {
    ref: root,
    id,
    className,
    style,
    "data-mkp-page": "",
    ...(first ? { dangerouslySetInnerHTML: { __html: first } } : {}),
  });
}

/** The page's handle and a ref to give <MkpPage>: `const [shop, ref] = usePage();`. The handle is
 * null until the page is mounted, and the component re-renders when it is. */
export function usePage(): [Handle | null, (h: Handle | null) => void] {
  const [handle, setHandle] = useState<Handle | null>(null);
  return [handle, setHandle];
}

export type { Call, Given, Handle, Ir, Mounted, Outcome, Page, PageProps, PageValues, Value, Widget, ir } from "@mkp/embed";
