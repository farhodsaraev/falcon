---
name: screen
description: Look at what is on the user's screen right now (Windows). Use for "what's on my screen", "what am I looking at", "read this for me", or when the user refers to something visible without naming it.
---

# Screen (Windows)

Two steps, no commentary in between.

1. Capture the screen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\screenshot.ps1"
```

It prints `{"ok":true,"path":"...\\screen.jpg","width":1600,"height":900}`.

2. Look at the image at that `path` with your image-viewing tool, then answer.

How to answer:

- Two or three spoken sentences: which app or page is in front, and what matters on it.
- Do not read out passwords, card numbers, codes or other people's private messages unless the user asks for that exact thing.
- When he asks to see the picture ("show me", "show it here", "send me a screenshot", «покажи»), end your answer with one more line, on its own: `MEDIA: <the path the capture printed>`. His window and his Telegram then show the picture itself. Never read that line or the path aloud, and never say where the file is unless he asks.
- If the capture fails, say so in one sentence.
