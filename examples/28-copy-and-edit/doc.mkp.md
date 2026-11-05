---
teaches: "changing a library widget by copying its source: mkp show --source --as prints it renamed, with the private fn it uses, and the copy is edited"
gaps: [168]
---
# A test result

The pack in `pack/` has `tally`, which draws a score as a bar and a fraction. This document needs a
pass mark too, so it copies `tally`:

```sh
mkp show tally --pack examples/28-copy-and-edit/pack --source --as score
```

and pastes the output below, adding the two `pass` lines and the bar's tone. Nothing links the copy
to `tally`: a later change there never reaches it.

```mkp
# from scores:tally@1 sha256:d27e9652dbdb1041f37a6de399dfe5acc0febdf757bc246c2e20bc5f57e74b9b

score "Marks out of a total, as a bar and a fraction, with a pass mark."
  in got int "marks earned"
  in of int = 10 "marks available"
  in pass int = 5 "the least that passes"
  row gap=s align=center
    meter (got) (of) grow basis=m tone=(if(got >= pass, ok, warn))
    text "\val{got}/\val{of}" font=mono
  project md = said(got, of) + if(got >= pass, " (a pass)", " (not yet a pass)")

fn said(got: int, of: int): text = format(got, 0) + " out of " + format(of, 0)
```

```score
got: 7
pass: 6
summary: Seven marks out of ten, with six needed to pass.
```
