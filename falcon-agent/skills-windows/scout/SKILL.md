---
name: scout
description: Scout a person or a company - gather everything public about them from free sources and the web, and present it as a dossier page with sources. Use for "scout", "find everything about", "who is", "background check", "do research on" a person, company or organisation.
---

# Scout (Windows)

Follow the scout steps in your rules ("Scouting a person or a company"). The two commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\scout.ps1" -Do sweep -Name "Uzum" -Type company -Hint "Uzbekistan" -Aliases "Узум"
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\scout.ps1" -Do report
```

Write the findings to `<folder of this SKILL.md>\dossier.json` before running the report.
