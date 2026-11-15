// `use:mkp={props}`: an MKP page drawn into the element the action is on, following its props.

import type { Action } from "svelte/action";
import { Embed, type PageProps } from "@mkp/embed";

export const mkp: Action<HTMLElement, PageProps> = (node, props) => {
  const embed = new Embed(node, props);
  return {
    update(next: PageProps) {
      embed.update(next);
    },
    destroy() {
      embed.destroy();
    },
  };
};
