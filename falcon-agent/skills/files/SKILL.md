---
name: files
description: Find a file on this Windows PC by words in its name, instantly, using the Windows search index. Use this first for any "find", "open" or "where is" request about a document, invoice, spreadsheet, picture or other file, instead of listing folders.
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
