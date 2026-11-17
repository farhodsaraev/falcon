# Falcon

A private assistant that lives on your Mac or Windows PC. Falcon answers like a calm British butler, in English or Russian, and he gets things done: opens presentations on the slide you ask for, finds files, describes what is on your screen, works in the browser and operates desktop apps. He asks before sending, deleting or running anything unfamiliar.

## Install

**Mac:** open **Terminal** (press ⌘ Space, type "Terminal", press Return), paste this line and press Return:

```sh
curl -fsSL https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/install.sh | bash
```

**Windows:** open **PowerShell** (press Start, type "PowerShell", press Enter), paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/install.ps1 | iex
```

No administrator password is needed. The installer adds a **Falcon** app (Applications and Desktop) and opens his window. Paste your AI key there (OpenAI, OpenRouter or Anthropic), tick the box, press **Start**. The key stays on your computer.

## Things to try

- "Good morning, Falcon."
- "Open my quarterly review presentation and go to slide 5." then "Now slide 7."
- "Find last month's invoice."
- "What's on my screen right now?"
- "Open bbc.com/news and tell me the top headline."
- "Scout Uzum and make me a five-slide deck from what you find."
- "Put last month's invoices in a spreadsheet."
- "Remind me tomorrow at nine to call the bank." · "Draft an email to Ann about the contract." (Mac)
- «Фалкон, что у меня сейчас на экране?»

## Tasks and checked results

Open **Tasks** in the title bar to see current and recent requests, their progress and action checks. **Stop task** cancels that request in the assistant and blocks further tool calls; it also stops speech. Completed actions are not undone. If the assistant cannot confirm a stop, the panel says so and offers Retry Stop instead of claiming cancellation.

Action checks say **Verified**, **Failed** or **Not confirmed**. Files are read back, generated Office packages are inspected and supported presentation apps are queried independently. Other tool results remain unconfirmed. An assistant-written claim never produces a verified card.

Open **Settings → Readiness** to check the assistant connection, execution tracking, skill dependencies, presentation app and microphone permission. Unknown permissions stay unconfirmed; checks do not open permission dialogs. Existing installations can use **Update tracking (restarts assistant)** to install and reload the execution add-on. A restart affects the assistant connection, including Telegram; finish other work first.

## Approvals

When Falcon wants to run a command he has not been allowed before, a card appears in his window showing the exact command. Choose **Allow once** or **Don't allow**. If nobody answers, the command is refused.

## Sites you are signed in to

Falcon has a browser of his own with no logins. For your mail, calendar or documents you can sign in once inside Falcon's browser (you type the password; Falcon never does), or let him use your own Chrome: open `chrome://inspect/#remote-debugging`, switch on remote debugging, and click **Allow** when Chrome asks.

## Status

Early version for macOS and Windows 10/11. Every change is installed from scratch on a clean Mac and a clean Windows machine by an automatic test.

**Voice:** press the microphone in Falcon's window and just talk; you can interrupt him. Voice uses OpenAI's Realtime API and needs an OpenAI key (add it on the welcome screen or under the gear icon).

On a Mac, the first time Falcon looks at the screen or controls Keynote, macOS asks for permission (Screen Recording, Automation). Click Allow, or switch it on in System Settings → Privacy & Security.

## Credits

Falcon runs on the open-source [OpenClaw](https://github.com/openclaw/openclaw) agent runtime (MIT licence), which the installer sets up for you.
