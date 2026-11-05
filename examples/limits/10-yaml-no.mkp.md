---
fails: "on: no for a bool: YAML 1.2 reads no as text, so it says write false"
expect: {code: mkp.input-type, line: 17}
---
# Limit: YAML's no

```mkp
setting "A labelled switch."
  in label text
  in on bool = false
  text label tone=(if(on, ink, muted))
  project md = label
```

```setting
label: Wi-Fi
on: no
summary: The Wi-Fi switch, off.
```
