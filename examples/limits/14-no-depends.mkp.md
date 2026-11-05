---
fails: "a pack that uses another pack's widget without saying it depends on it"
expect: {code: mkp.unknown-widget, line: 2}
---
# Limit: a pack without its depends

The packs are in the folder beside this file: `badges` uses `chip` from `chips` but its manifest
doesn't say `depends chips@1`, so `chip` isn't visible to it.
