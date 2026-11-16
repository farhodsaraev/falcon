---
name: presentations
description: Open a Keynote or PowerPoint presentation and jump to a slide number in ONE command, or move the presentation that is already open to a given slide. Use for requests like "open my presentation and go to slide 5".
---

# Presentations (macOS: Keynote and PowerPoint)

Do it in a single command. Do not search for the file first; the script finds it.

```sh
"{{NODE}}" "{{SKILL_DIR}}/slides.mjs" --find "quarterly review" --slide 5
```

- `--find`: words from the presentation's name. The newest matching `.key`, `.pptx` or `.ppt` wins.
- `--path`: use instead of `--find` when you already know the full path.
- Leave out both to act on the presentation that is already open ("next, go to slide 7").
- Leave out `--slide` to only open the file.
- Success: `{"ok":true,"app":"Keynote","name":"Quarterly Review","slide":5,"total":8}`
- Failure: `{"ok":false,"error":"The presentation has only 8 slides."}`. Tell the user the error in plain words.

The first time, macOS asks the user to let Falcon control Keynote or PowerPoint. If the error mentions Automation, ask him to click OK on that prompt, or to allow it in System Settings, Privacy and Security, Automation.

After acting, confirm in a few words: "Slide five is up, sir."

## Other kinds of slides

Google Slides, Canva and other web presentations live in the browser: use the browser tool, not this skill.
