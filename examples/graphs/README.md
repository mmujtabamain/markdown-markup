# graphs

An example pack: graphs on core's `plane`, written in MKP alone, with no externs. A `graph`
places each node on a plane with a `spot`, reads where each node landed from the spot's `box`,
and draws each edge on the plane's background as a line from one node's outline to the other's.

```sh
mkp check --pack examples/graphs examples/graphs/release-flow.mkp.md
mkp md --pack examples/graphs examples/graphs/release-flow.mkp.md
```

It needs `core.live` for the boxes and `core.gfx` for its lines; on a target without them, the
graph shows its Markdown: the nodes, then the links.
