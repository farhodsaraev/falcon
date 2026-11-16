---
name: files
description: Find a file on this Windows PC by words in its name, instantly, using the Windows search index. Use this first for any "find", "open" or "where is" request about a document, invoice, spreadsheet, picture or other file, instead of listing folders. Also use it to read what is written inside a PDF, Word or text file.
---

# Files (Windows)

One command, one result. Do not walk folders with `dir`, `ls` or `Get-ChildItem`; that is slow.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\find-files.ps1" -Query "invoice" -Ext "pdf"
```

- `-Query`: words from the file name. All words must match.
- `-Ext`: optional file type, or several separated by commas: `"pdf"`, `"docx,doc"`, `"xlsx,csv"`.
- It searches Desktop, Documents and Downloads, newest first, and prints JSON:
  `{"ok":true,"files":[{"path":"C:\\...\\Invoice October 2026.pdf","modified":"2026-11-16 12:40","sizeKb":1}]}`
- "Last month's invoice": take the newest match whose name or modified date fits last month. Name the file you chose.
- Empty list: say so and ask for another word from the name. Do not fall back to scanning the whole disk unless asked.

To open a file in its usual app:

```powershell
Start-Process "<full path>"
```

## Reading what is inside a file

To answer a question about a file's contents (a CV, an invoice, a contract, a report), read it with this command. Never try other tools or commands for PDF or Word files.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder of this SKILL.md>\read-file.ps1" -Path "<full path>"
```

- Works for PDF, Word (`.docx`) and plain text files. Read-only.
- Prints JSON: `{"ok":true,"kind":"pdf","pages":2,"text":"...","truncated":false}`
- `"truncated":true`: only the beginning was read. Add `-Pages 60` or `-Max 60000` if the user needs the rest.
- A `note` saying the PDF has no text means it is a scan: say so, and offer to look at it on screen instead.
