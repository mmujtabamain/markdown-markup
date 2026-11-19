import { createElement as h, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { XtmdDoc } from "@extended-mark/react";
import { XtmdLiveDoc } from "@extended-mark/react-live";
import { S, compiled, failed, onEdit, showState } from "./common.mjs";

const id = "react";

function Run() {
  const [state, setState] = useState(undefined);
  const ref = useRef(null);
  useEffect(() => setState(ref.current.state()), []);
  useEffect(() => showState(id, state), [state]);
  return h(XtmdDoc, { ref, ir: S.ir, state, onStateChange: setState });
}

function Live() {
  const [source, setSource] = useState(S.source);
  const ref = useRef(null);
  useEffect(() => {
    onEdit(id, setSource);
    return compiled(id, ref.current.doc);
  }, []);
  return h(XtmdLiveDoc, { ref, source, wasm: S.wasm, onError: failed(id) });
}

createRoot(document.getElementById(`${id}-run`)).render(h(Run));
createRoot(document.getElementById(`${id}-live`)).render(h(Live));
