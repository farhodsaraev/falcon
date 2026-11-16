---
name: files
description: Find a file on this Mac by words in its name, quickly. Use this first for any "find", "open" or "where is" request about a document, invoice, spreadsheet, picture or other file, instead of listing folders.
---

# Files (macOS)

One command, one result. Do not walk folders with `ls` or `find`; that is slow.

```sh
"{{NODE}}" "{{SKILL_DIR}}/find-files.mjs" --query "invoice" --ext pdf
```

- `--query`: words from the file name. All words must match.
- `--ext`: optional file type, or several separated by commas: `pdf`, `docx,doc`, `xlsx,csv`, `key,pptx`.
- It searches Desktop, Documents and Downloads, newest first, and prints JSON:
  `{"ok":true,"source":"index","files":[{"path":"/Users/.../Invoice October 2026.pdf","modified":"2026-11-16 12:40","sizeKb":1}]}`
- "Last month's invoice": take the newest match whose name or modified date fits last month. Name the file you chose.
- Empty list: say so and ask for another word from the name. Do not scan the whole disk unless asked.

To open a file in its usual app: `open "<full path>"`
