---
teaches: "Enter to submit, a guarded event line, a field's tone, a signal to the host, and an answer kept out of the Markdown"
gaps: [80, 81, 86, 166]
---
# Check an answer

```mkp
ask "A question answered in a word, checked on Enter or Check."
  in prompt text "what to ask"
  in accept list(text) answer "the words that count as right, in any case"
  signal answered {correct: bool, value: text} "sent on every check"
  out solved "when the reader gets it right"
  var entry text = ""
  var result choice(open|right|wrong) = open
  matched = len(filter(accept, a => lower(trim(a)) == lower(trim(entry)))) > 0
  column gap=s
    text prompt
    row gap=s
      field value=entry label="your answer" grow basis=m tone=(if(result == right, ok,
          if(result == wrong, bad, none)))
        @change set entry=(change.value) result=open
        @submit set result=(if(matched, right, wrong)) send answered correct=matched value=entry
        @submit emit solved if=(matched)
      press
        text "Check"
        @click set result=(if(matched, right, wrong)) send answered correct=matched value=entry
        @click emit solved if=(matched)
    text "Right." tone=ok if=(result == right)
    text "Not quite. Try again." tone=bad if=(result == wrong)
  project md = prompt + if(answers, "\n\n:::details \"Answer\"\n" + join(accept, " or ") + "\n:::", "")
```

```ask
prompt: What is the capital of Norway?
accept: [Oslo]
summary: A one-word question about Norway.
```
