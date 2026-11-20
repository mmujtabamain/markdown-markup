# brand

Extended Mark's mark, logo and icons. The mark is `@M↓`: Markdown's own mark, the M and the arrow in a
frame, with Extended Mark's call sign, `@`, before it. Every widget in a document is called with an
`@`, so the mark reads as what Extended Mark is: Markdown, with calls in it.

Markdown's mark is by Dustin Curtis and is in the public domain (CC0), so it can be built on freely.

## The files

| File | What it is | Where it goes |
|---|---|---|
| `mark.svg`, `mark-dark.svg` | The mark: ink and coral on a light background; paper and light coral on a dark one | Anywhere the name is already written beside it |
| `mark-black.svg`, `mark-white.svg` | The mark in one colour | Print, embossing, a background the colours fight |
| `logo.svg`, `logo-dark.svg` | The mark and "Extended Mark" | The README's header, a site's header, slides |
| `icon.svg` | The mark in white on a coral tile | The app icon: the VS Code extension, an app |
| `favicon-16.svg` | The call sign alone on the tile, as the whole mark is too small to read at 16 px | A site's icon, and the 16 px image in `favicon.ico` |
| `github/avatar.svg` | The tile without its corners, which GitHub rounds itself | The GitHub organisation's picture |
| `github/social-preview.svg` | 1280 × 640: the logo, what Extended Mark is, a document and the page it draws | The repository's social preview, which a shared link shows |
| `favicon.ico`, `apple-touch-icon.png` | The icon at 16, 32 and 48 px; at 180 px for iOS | A site's `<head>` |
| `png/` | The icon at 128 to 1024 px, and the logo at twice its size | Where an SVG isn't taken |

The VS Code extension's own copies are in `ide/vscode/media`: `icon.png` (256 px), and the file
icons, each for a light and a dark theme. A document (`.xtmd`) is a page with the call sign on it,
`xtmd-light.svg` and `xtmd-dark.svg`; a pack (`.xtmdpack`) is a box with the call sign on it,
`xtmdpack-light.svg` and `xtmdpack-dark.svg`.

GitHub takes the avatar and the social preview by hand: the organisation's Settings → Profile →
Profile picture (`github/avatar.png`), and the repository's Settings → General → Social preview
(`github/social-preview.png`).

## Colours

| Name | Hex | For |
|---|---|---|
| Coral | `#F2542D` | The call sign on light; the icon's tile |
| Light coral | `#FF7A59` | The call sign on dark |
| Ink | `#151B26` | The frame, the M↓ and the words, on light |
| Paper | `#EEF2F7` | The frame and the M↓ on dark |
| Tile | `#F5643F` to `#E5461F`, top to bottom | The icon's tile |

## Using it

- Leave space around the mark of at least the height of its `@`.
- Don't recolour its parts apart from the versions here, stretch it, turn it, or put it on a busy
  picture.
- Below 24 px tall, use the icon, or the call sign on its tile (`favicon-16.svg`).

## Changing it

The SVGs are the source. The words and the call sign in them are outlines of Space Grotesk Bold and
Medium and of JetBrains Mono Bold (both under the SIL Open Font License), so nothing needs a font to
draw them. After changing an SVG, draw the PNGs and `favicon.ico` again:

```sh
(cd ide/vscode && npm ci)   # for playwright-core
XTMD_CHROMIUM=$(command -v chromium) node brand/render.mjs
```
