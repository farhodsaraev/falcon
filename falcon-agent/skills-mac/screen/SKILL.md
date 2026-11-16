---
name: screen
description: Look at what is on the user's screen right now (macOS). Use for "what's on my screen", "what am I looking at", "read this for me", or when the user refers to something visible without naming it.
---

# Screen (macOS)

Two steps, no commentary in between.

1. Capture the screen:

```sh
"{{NODE}}" "{{SKILL_DIR}}/screenshot.mjs"
```

It prints `{"ok":true,"path":".../screen.jpg","width":1600,"height":1000}`.

2. Look at the image at that `path` with your image-viewing tool, then answer.

How to answer:

- Two or three spoken sentences: which app or page is in front, and what matters on it.
- Do not read out passwords, card numbers, codes or other people's private messages unless the user asks for that exact thing.
- If the capture fails or the picture shows only the desktop wallpaper, macOS has not yet allowed screen recording: ask the user to allow it in System Settings, Privacy and Security, Screen Recording, and try again.
