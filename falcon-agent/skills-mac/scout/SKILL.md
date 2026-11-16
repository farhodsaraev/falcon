---
name: scout
description: Scout a person or a company - gather everything public about them from free sources and the web, and present it as a dossier page with sources. Use for "scout", "find everything about", "who is", "background check", "do research on" a person, company or organisation.
---

# Scout (macOS)

Follow the scout steps in your rules ("Scouting a person or a company"). The two commands:

```sh
"{{NODE}}" "<folder of this SKILL.md>/scout-sources.mjs" --name "Uzum" --type company --hint "Uzbekistan" --aliases "Узум"
"{{NODE}}" "<folder of this SKILL.md>/scout-report.mjs" --data "<folder of this SKILL.md>/dossier.json"
```

Write the findings to `<folder of this SKILL.md>/dossier.json` before running the report.
