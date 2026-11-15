# The test target

`@mkp/runtime` with no screen, for the target checks (plan tab 16). `mkp target check test` starts
`adapter.mjs` and drives it over JSON-RPC on standard input and output, one observation per step.

- **Fixed sizes** (`sizes.mjs`): text is 8 wide per character and 20 high; a column stacks its
  children, a row lines them up, with their `gap` and `pad`; anything else is 80 by 20; a plane
  given no width is 640 wide. So a check can say exactly where a plane's spots land.
- **Defects** (`defects.mjs`): `MKP_TEST_DEFECT=<name>` switches one on. Each must be caught:
  `mkp target check test --defect <name> --expect-failures` passes only when some check fails.
- **Value fns:** `can_draw_tex` draws all TeX; `moment.local` reads in UTC.

```sh
cd targets/ts/runtime && npm install && npm run build
cd ../test && npm install
cd ../../.. && mkp target check test          # every check
cd targets/ts/test && npm test                # every check, each defect, the protocol
```
