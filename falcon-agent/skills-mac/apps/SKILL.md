---
name: apps
description: Control this Mac's own apps directly, without clicking on the screen. Use to write an email or draft a mail in Mail (never sends), make a note or find a note in Notes, add something to the calendar, remind me of something, play, pause or skip music, what song is playing, set the volume, mute or unmute, open or quit an app, show a file in Finder, and what app or window is open right now.
---

# The Mac's own apps (Mail, Notes, Calendar, Reminders, Music, Finder)

Each command prints one line of JSON: `{"ok":true,...}` or `{"ok":false,"error":"..."}`. Pass the user's words exactly as he said them; the skill keeps them safe. Times are local, written like `2026-11-20T15:00`.

```sh
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do mail-draft --to "ann@example.com, bob@example.com" --subject "Contract" --body "Hello Ann, ..." [--cc "..."] [--attach "/Users/.../file.pdf"]
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do notes-add --title "Gift ideas" --body "A scarf for Ann" [--folder "Notes"]
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do notes-find --query "wifi password"
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do calendar-add --title "Lunch with Ann" --start "2026-11-20T13:00" [--minutes 60 | --end "2026-11-20T14:30"] [--calendar "Work"] [--location "Cafe"] [--notes "..."]
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do reminder-add --title "Call the bank" [--due "2026-11-20T09:00"] [--list "Reminders"]
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do music --cmd play|pause|next|previous|now
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do volume --level 40
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do volume --mute
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do volume --unmute
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do open-app --name "Safari"
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do quit-app --name "Safari"
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do reveal --path "/Users/.../Report.pdf"
"{{NODE}}" "{{SKILL_DIR}}/apps.mjs" --do frontmost
```

Work out dates yourself from today's date ("Friday at three" becomes the real date and `T15:00`). An event lasts an hour unless he says otherwise. Without `--calendar` the first calendar that can be written to is used; without `--list` his default Reminders list.

## Rules

- Mail: drafting is free, but you never send. The draft opens on screen; tell him it is ready and that he only has to press Send. If he asks you to send it, say he can press Send himself, and get a clear yes before anything that would send.
- Calendar, reminders and notes: if he clearly asked for exactly that ("remind me tomorrow at nine to call the bank"), just add it and confirm in one sentence. If you had to guess the day, time, title or calendar, say back in one sentence what you will add and wait for his yes.
- Quitting an app: the app is asked to quit the normal way, never forced. If it may have unsaved work (a document, an email being written), ask first. If it did not quit, tell him it is probably asking about saving.
- Finding notes only reads; say the titles and the part he needs, not the whole note.
- `frontmost` gives the app's name always; the window title needs Accessibility.
- Permission errors: the first time, macOS asks to let Falcon control each app. If the error mentions Automation or "not allowed", tell him in one sentence to click OK on the prompt or allow Falcon in System Settings, Privacy and Security, Automation. If it mentions Accessibility, the same place, under Accessibility.
- If he keeps his mail or calendar on the web (Gmail, Outlook) rather than in Apple's apps, offer to do it in the browser instead.

Speak the result, no lists: "Done, sir: lunch with Ann is on your calendar for Friday at one." or "The email to Ann is open in Mail and ready; just press Send when you are happy with it."
