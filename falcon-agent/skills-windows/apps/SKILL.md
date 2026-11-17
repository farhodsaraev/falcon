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
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\apps.ps1" -Do type -Name "Telegram" -Text "The words to type"
```

- Working inside an app: look with the screen skill (view the picture), then `-Do click -X <x> -Y <y>` with pixels from that picture, `-Do type -Text "..."`, `-Do keys -Keys "ctrl+f"` or `-Do scroll -Direction down`. Take a new picture after every action that changes the screen.
- `type` puts the text where the cursor is in that app's window, in one go (any language, any length), and puts the user's clipboard back afterwards. It never presses Enter. Click into the right box first (with computer control), then type. Inside the text, write double quotes as “ ” and never as plain " marks.

- `open` starts the app (or brings it forward if it is already open) and waits for its window: `{"ok":true,"app":"Telegram","title":"...","started":true}`. Then continue inside it with computer control.
- If the name is not found, the error lists similar apps; `installed` lists what is there.
- `close` asks the app to close the normal way and never forces it. Ask the user first if it may hold unsaved work.
- Uninstallers and setup programs are never started.
