---
name: documents
description: Make a new Word document (.docx), Excel spreadsheet (.xlsx) or PowerPoint presentation (.pptx) from content you write. Use for "make me a document / report / letter", "put this in a spreadsheet / table in Excel", "make a presentation / slides about". The files open in Word, Excel and PowerPoint.
---

# Documents (Word, Excel, PowerPoint)

Two steps:

1. Write the content as JSON to `{{SKILL_DIR}}\spec.json` with your write tool (UTF-8; Russian is fine).
2. Run one command. Add `-Open` when the user wants to see it straight away.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\make-document.ps1" -Open
```

Type it exactly like this, with the full path; leave out `-Open` to only save the file. (It reads `spec.json` next to it; `-Spec "<full path>"` reads another file.)

The file is saved in the "Falcon Documents" folder inside Documents (on OneDrive if Documents is kept there). It never replaces an existing file: a second "Budget" becomes "Budget (2)". So there is nothing to ask before making one.

- Success: `{"ok":true,"path":"C:\\Users\\...\\Documents\\Falcon Documents\\Budget 2026.xlsx","type":"xlsx","sheets":1,"rows":5}`
- Failure: `{"ok":false,"error":"..."}`. Fix the JSON and run again, or tell the user the error in plain words.

## The JSON

Word:

```json
{"type":"docx","title":"Meeting notes","fileName":"optional name","blocks":[
  {"heading":"Decisions","level":1},
  {"paragraph":"Plain text. **Bold words** in double stars."},
  {"bullets":["First point","Second point"]},
  {"numbered":["Step one","Step two"]},
  {"heading":"Costs","level":2},
  {"table":[["Item","Price"],["Rent","1200"]]}
]}
```

Excel (numbers stay numbers; text that starts with `=` is a formula, in English with commas; the first row is the bold header):

```json
{"type":"xlsx","title":"Budget 2026","sheets":[
  {"name":"Costs","rows":[["Item","Amount"],["Rent",1200],["Food",345.5],["Total","=SUM(B2:B3)"]]}
]}
```

PowerPoint (16:9; the first slide is made from `title` and `subtitle`; `notes` are optional speaker notes):

```json
{"type":"pptx","title":"Quarterly review","subtitle":"November 2026","slides":[
  {"title":"Where we are","bullets":["Sales up 12%","Two new clients"],"notes":"Mention the Tashkent office."},
  {"title":"Next steps","bullets":["Hire a designer","Open the online shop"]}
]}
```

Keep slides short: a few words per bullet and at most six bullets, so they stay readable. A slide can have `"text"` instead of bullets for a plain sentence.

## Answering

Say it as speech, and name the file: "Done, sir: Quarterly review, six slides, in Falcon Documents. It is open now." Do not read the path aloud.
