// The base set (core@1, spec 8) and gfx@1 (8.1), declared in MKP itself as externs, plus core@1's
// default tokens (spec 7). Every provider implements these; the compiler checks uses against them.

export const CORE_MKP = String.raw`pack core@1 "The base set every provider implements, and the default tokens."
  provides stack flex grid text image press range meter field overlay canvas paragraph heading list quote code math divider table footnote rgb

type rgb = {r: num, g: num, b: num}

extern stack@1 "Children one below another."
  in pad space = none "inner padding"
  in gap space = none "space between children"
  in align choice(start|center|end|stretch|baseline) = stretch "cross-axis alignment"
  in fill color = none "background"
  in stroke color = none "border"
  in radius radius = none "corner radius"
  in shadow shadow = none
  in body slot

extern flex@1 "Children in a row that wraps or scrolls."
  in pad space = none
  in gap space = none
  in align choice(start|center|end|stretch|baseline) = start
  in justify choice(start|center|end|between|around) = start
  in wrap bool = true
  in fill color = none
  in stroke color = none
  in radius radius = none
  in shadow shadow = none
  in body slot

extern grid@1 "Children in equal columns."
  in cols int 1..12 = 2
  in pad space = none
  in gap space = none
  in align choice(start|center|end|stretch|baseline) = stretch
  in fill color = none
  in stroke color = none
  in radius radius = none
  in shadow shadow = none
  in body slot

extern text@1 "A styled run of inline Markdown with inline maths."
  fields value
  in value text = ""
  in font font = body
  in tone color = ink
  in weight choice(regular|medium|bold) = regular
  in size choice(small|normal|large) = normal
  in align choice(start|center|end) = start
  in wrap bool = true

extern image@1 "An asset from the pack or the document's folder."
  fields src alt
  in src text
  in alt text
  in size size = none

extern press@1 "Anything clickable and focusable: a button, a tab, an option among others, an on/off toggle or switch, or an answer row with a tick (check) or a dot (radio)."
  in kind choice(button|tab|option|toggle|switch|check|radio) = button
  in selected bool = false
  in disabled bool = false
  in label text = "" "accessible name when the content has no text"
  in tone color = none
  in body slot
  out click

extern range@1 "A value on a track: drag, or use the arrow keys."
  fields value min max
  in value ref num
  in min num = 0
  in max num = 1
  in step num = 0
  in label text = ""
  out change {value: num}

extern meter@1 "How far along something is: a bar filled to value out of max."
  fields value max
  in value num
  in max num = 1
  in label text = ""
  in tone color = accent
  in size size = fill

extern field@1 "Text or number entry."
  fields value
  in value ref text
  in kind choice(text|number) = text
  in label text = ""
  in placeholder text = ""
  in width size = none
  out change {value: text}
  out submit {value: text}

extern overlay@1 "A popover, tooltip, dialog or menu anchored to its first slot. A menu's body holds press kind=option, and its anchor shows the current one."
  in mode choice(popover|tooltip|dialog|menu) = popover
  in label text = ""
  in anchor slot
  in body slot
  out open
  out close

extern canvas@1 "A 2D coordinate space with layers drawn in the order written."
  fields x y
  in x range = -1..1
  in y range = -1..1
  in z range = -1..1 "3D only"
  in aspect num = 0 "width over height; 0 means from the ranges"
  in size size = m
  in dims int 2..3 = 2 "3 needs gfx@1"
  in view point = (35, 25) "3D camera: azimuth and elevation in degrees"
  in label text = ""
  in layers list(record layer {opacity: num = 1,
      rects: list(record rect {a: point, b: point, fill: color = none, stroke: color = ink, radius: radius = none}),
      lines: list(record line {a: point, b: point, stroke: color = ink, width: num = 1, dash: bool = false, arrow: bool = false}),
      circles: list(record circle {c: point, r: num, fill: color = none, stroke: color = none, width: num = 1}),
      paths: list(record path {pts: list(point), closed: bool = false, fill: color = none, stroke: color = ink, width: num = 1, dash: bool = false}),
      curves: list(record curve {f: expr(t): point, t: range = 0..1, n: int 2..2000 = 200, stroke: color = accent, width: num = 1.5, dash: bool = false}),
      labels: list(record label {at: point, text: text, tone: color = ink, anchor: choice(center|n|s|e|w|ne|nw|se|sw) = center}),
      images: list(record image {src: text, at: point, w: num, h: num = 0, alt: text = ""}),
      places: list(record place {at: point} slot),
      handles: list(record handle {p: ref point, tone: color = accent}),
      pixels: list(record pixels {f: expr(x, y): rgb, res: int 16..1024 = 256}),
      meshes: list(record mesh {f: expr(x, y), n: int 4..200 = 40, fill: color = accent})})

extern paragraph@1 "A paragraph of inline Markdown."
  fields text
  in text text

extern heading@1 "A heading."
  fields level text
  in level int 1..6 = 2
  in text text

extern list@1 "A bulleted, numbered or task list."
  in ordered bool = false
  in start int = 1
  in items list(record item {checked: choice(none|yes|no) = none} slot)

extern quote@1 "A block quote; alert makes it a note, tip, warning … callout."
  in alert choice(none|note|tip|important|warning|caution) = none
  in body slot

extern code@1 "A code block."
  fields src lang
  in src text
  in lang text = ""

extern math@1 "A display formula."
  fields tex
  in tex latex

extern divider@1 "A thematic break (Markdown's ---)."

extern table@1 "A table of inline Markdown cells."
  fields head rows
  in head list(text)
  in rows list(list(text))
  in align list(choice(none|left|center|right)) = []

extern footnote@1 "A footnote's text."
  fields label
  in label text
  in body slot

tokens core@1 "Default tokens: every required name (spec 7)."
  color surface "#ffffff" dark="#15171a"
  color ink "#1a1c1f" dark="#eceef1"
  color muted "#6b7280" dark="#9aa3ae"
  color accent "#2563eb" dark="#7aa7ff"
  color info "#0284c7" dark="#38bdf8"
  color ok "#15803d" dark="#4ade80"
  color warn "#b45309" dark="#fbbf24"
  color bad "#dc2626" dark="#f87171"
  font body "system-ui, sans-serif" size=16 weight=400 line=1.5
  font heading "system-ui, sans-serif" size=22 weight=650 line=1.25
  font mono "ui-monospace, monospace" size=14 weight=400 line=1.45
  space xs=2 s=4 m=8 l=16 xl=32
  size s=160 m=320 l=480
  radius card=8 pill=999
  shadow raised y=1 blur=3 color="#0000001f"
`;

/** Required token names per kind (spec 7). */
export const REQUIRED_TOKENS: Record<string, string[]> = {
  color: ['surface', 'ink', 'muted', 'accent', 'info', 'ok', 'warn', 'bad'],
  font: ['body', 'heading', 'mono'],
  space: ['xs', 's', 'm', 'l', 'xl'],
  size: ['s', 'm', 'l'],
  radius: ['card'],
  shadow: ['raised'],
};

/** Base widgets whose use needs gfx@1, and the shapes that do. */
export const GFX_SHAPES = new Set(['pixels', 'mesh']);
