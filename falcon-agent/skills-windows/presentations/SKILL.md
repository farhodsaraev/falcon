---
name: presentations
description: Open a PowerPoint presentation and jump to a slide number in ONE command, or move the presentation that is already open to a given slide. Use for requests like "open my presentation and go to slide 5".
---

# Presentations (Windows, PowerPoint)

Do it in a single command. Do not search for the file first; the script finds it.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\slides.ps1" -Find "quarterly review" -Slide 5
```

- `-Find`: words from the presentation's name. The newest matching file wins.
- `-Path`: use instead of `-Find` when you already know the full path.
- Leave out both to act on the presentation that is already open ("next, go to slide 7").
- Leave out `-Slide` to only open the file.
- Success: `{"ok":true,"name":"Quarterly Review.pptx","path":"C:\\...","slide":5,"total":8}`
- Failure: `{"ok":false,"error":"The presentation has only 8 slides."}`. Tell the user the error in plain words.

If the user just says "my presentation" with no name, run it with `-Find ""` replaced by no `-Find` when a deck is already open; otherwise ask which one.

After acting, confirm in a few words: "Slide five is up, sir."

## Other kinds of slides

Google Slides, Canva and other web presentations live in the browser: use the browser tool, not this skill.
