# Falcon

A private assistant that lives on your Windows PC. Falcon answers like a calm British butler, in English or Russian, and he gets things done: opens presentations on the slide you ask for, finds files, describes what is on your screen, works in the browser and operates desktop apps. He asks before sending, deleting or running anything unfamiliar.

## Install

Open **PowerShell** (press Start, type "PowerShell", press Enter), paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/install.ps1 | iex
```

No administrator rights are needed. The installer puts a **Falcon** icon on your Desktop and opens his window. Paste your AI key there (OpenAI, OpenRouter or Anthropic), tick the box, press **Start**. The key stays on your computer.

## Things to try

- "Good morning, Falcon."
- "Open my quarterly review presentation and go to slide 5." then "Now slide 7."
- "Find last month's invoice."
- "What's on my screen right now?"
- "Open bbc.com/news and tell me the top headline."
- «Фалкон, что у меня сейчас на экране?»

## Approvals

When Falcon wants to run a command he has not been allowed before, a card appears in his window showing the exact command. Choose **Allow once** or **Don't allow**. If nobody answers, the command is refused.

## Sites you are signed in to

Falcon has a browser of his own with no logins. For your mail, calendar or documents you can sign in once inside Falcon's browser (you type the password; Falcon never does), or let him use your own Chrome: open `chrome://inspect/#remote-debugging`, switch on remote debugging, and click **Allow** when Chrome asks.

## Status

Early version. Windows 10 and 11. Voice and macOS are in progress.

## Credits

Falcon runs on the open-source [OpenClaw](https://github.com/openclaw/openclaw) agent runtime (MIT licence), which the installer sets up for you.
