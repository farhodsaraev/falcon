import { execFile } from 'node:child_process';

// Read-only inspection: never opens/closes a user application or moves a slide.
export async function inspectSlide(file, app, platform = process.platform) {
  let command, argv, input;
  if (platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$wanted = [Console]::In.ReadToEnd() | ConvertFrom-Json',
      "$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')",
      '$win = $ppt.SlideShowWindows.Item(1)',
      'if ($win.Presentation.FullName -ne $wanted.path) { throw "Different presentation" }',
      '@{ path = $win.Presentation.FullName; slide = $win.View.Slide.SlideIndex; total = $win.Presentation.Slides.Count } | ConvertTo-Json -Compress',
    ].join('\n');
    command = 'powershell.exe'; argv = ['-NoProfile', '-NonInteractive', '-Command', script]; input = JSON.stringify({ path: file });
  } else if (platform === 'darwin' && app === 'Keynote') {
    const lines = ['on run argv', 'tell application "Keynote"', 'if (count of documents) is 0 then error "No presentation"', 'set d to front document', 'if (POSIX path of (file of d)) is not (item 1 of argv) then error "Different presentation"', 'return (slide number of current slide of d) & "|" & (count of slides of d)', 'end tell', 'end run'];
    command = 'osascript'; argv = [...lines.flatMap(l => ['-e', l]), file];
  } else return null;
  return new Promise(resolve => {
    const child = execFile(command, argv, { encoding: 'utf8', timeout: 5000, maxBuffer: 8192, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        if (platform === 'win32') return resolve(JSON.parse(stdout));
        const [slide, total] = stdout.trim().split('|').map(Number); resolve({ path: file, slide, total });
      } catch { resolve(null); }
    });
    child.stdin?.on('error', () => {}); child.stdin?.end(input || '');
  });
}
