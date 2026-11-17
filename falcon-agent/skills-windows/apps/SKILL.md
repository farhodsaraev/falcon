---
name: apps
description: Open any installed app on this Windows PC by name (Telegram, WhatsApp, Word, Excel, Outlook, Calculator, Spotify and so on), bring an open app to the front, see which apps are open, or close one politely. Use before working inside a desktop app with computer control.
---

# Windows apps

Each command prints one line of JSON. Type it exactly like this, with the full path.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do open -Name "Telegram"
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do focus -Name "Telegram"
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do running
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do installed -Name "part of a name"
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do close -Name "Notepad"
```

- `open` starts the app (or brings it forward if it is already open) and waits for its window: `{"ok":true,"app":"Telegram","title":"...","started":true}`. Then continue inside it with computer control.
- If the name is not found, the error lists similar apps; `installed` lists what is there.
- `close` asks the app to close the normal way and never forces it. Ask the user first if it may hold unsaved work.
- Uninstallers and setup programs are never started.
