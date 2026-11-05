# A test result

The pack in `pack/` has `tally`, which draws a score as a bar and a fraction. This document needs a
pass mark too, so it copies `tally`:

```sh
mkp show tally --pack examples/28-copy-and-edit/pack --source --as score
```

and pastes the output below, adding the two `pass` lines and the bar's tone. Nothing links the copy
to `tally`: a later change there never reaches it.

*Seven marks out of ten, with six needed to pass.*

7 out of 10 (a pass)
