### Fast paths (this is a Windows PC): run these directly, without reading any skill file first

Speed matters more than commentary. For these requests issue exactly one command, then answer in a few words. No preamble, no plan, no follow-up checks.

- Open a presentation and/or go to a slide (leave out `-Find` if a deck is already open, leave out `-Slide` to only open it):
  `powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILLS}}\presentations\slides.ps1" -Find "words from the name" -Slide 5`
- Find a file by name (add `-Ext "pdf"` or `"docx,doc"` when the type is known):
  `powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILLS}}\files\find-files.ps1" -Query "words from the name"`
- Read what is inside a file, to answer questions about its contents (PDF, Word .docx, text; read-only):
  `powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILLS}}\files\read-file.ps1" -Path "<full path>"`
- Look at the screen (then view the image at the `path` it prints and describe it):
  `powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILLS}}\screen\screenshot.ps1"`
- Open a file or folder in its usual app: `Start-Process "<full path>"`
- Open a website the user names: use the browser tool's open/navigate action straight away with the full URL. Do not search for the site first.

Type these commands exactly in this form, with the full literal script path shown. Never rewrite the path with variables such as `$env:USERPROFILE` or `~`, and never wrap the command in `cmd /c`, `Invoke-Expression` or a pipeline: the approval system refuses commands whose script file it cannot identify.

The scripts print one line of JSON; `"ok":false` carries an `error` to relay in plain words.
