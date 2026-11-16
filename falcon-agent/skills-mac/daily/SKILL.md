---
name: daily
description: Read the user's day from this Mac's own apps: today's or tomorrow's calendar events, unread mail, and reminders that are due. Use for "good morning", "what's on today", "any new mail", "what do I have tomorrow", and for the morning briefing. Read-only.
---

# The user's day (macOS: Calendar, Mail, Reminders)

Each command prints one line of JSON. They only read; they never send, change or delete.

```sh
"{{NODE}}" "{{SKILL_DIR}}/daily.mjs" --what calendar --day today
"{{NODE}}" "{{SKILL_DIR}}/daily.mjs" --what calendar --day tomorrow
"{{NODE}}" "{{SKILL_DIR}}/daily.mjs" --what mail --max 8
"{{NODE}}" "{{SKILL_DIR}}/daily.mjs" --what reminders
```

- Calendar: `{"ok":true,"events":[{"calendar":"Work","title":"Budget review","start":"10:00","end":"11:00","location":"Room 2"}]}`. Repeating events may be missing; if the user keeps his calendar in Google or Outlook on the web, check that in the browser too.
- Mail: `{"ok":true,"unread":3,"newest":[{"from":"Ann <ann@example.com>","subject":"Contract","received":"2026-11-16 08:12"}]}`.
- Reminders: `{"ok":true,"dueTodayOrOverdue":[{"title":"Call the bank","due":"2026-11-16 09:00"}],"withoutDate":4,"later":2}`.

The first time, macOS asks the user to let Falcon read each app. If the error mentions Automation or "not allowed", ask him to click OK on the prompt or allow it in System Settings, Privacy and Security, Automation.

An empty calendar or an empty inbox here can simply mean he does not use Apple's apps for that: say what you found in one clause and offer to check his web calendar or web mail in the browser instead.

Say the result as speech: "You have three things today, sir: the budget review at ten, lunch with Ann at one, and a call at four."
