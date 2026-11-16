# Falcon — setup guide (Windows)

Falcon is a private assistant that lives on your computer. He answers like a calm British butler, in English or Russian, and he can open presentations, find files, describe what is on your screen, work in the browser and operate desktop apps. He asks before sending, deleting or running anything unfamiliar.

## What you need

- Windows 10 or 11
- An OpenAI API key (from platform.openai.com) with a few dollars of credit
- About 10 minutes

## Install

1. Unzip the `falcon-agent` folder anywhere, for example onto the Desktop.
2. Open **PowerShell** (press Start, type "PowerShell", press Enter).
3. Paste this line, changing the path if you unzipped elsewhere, and press Enter:

   ```
   powershell -ExecutionPolicy Bypass -File "$HOME\Desktop\falcon-agent\setup-falcon.ps1"
   ```

4. Type `YES` when asked, then paste your OpenAI key. The key is stored on your computer only.
5. A chat window opens in your browser. Say hello.

## Things to try

- "Good morning, Falcon."
- "Open my quarterly review presentation and go to slide 5." then "Now slide 7."
- "Find last month's invoice."
- "What's on my screen right now?"
- "Open bbc.com/news and tell me the top headline."
- «Фалкон, что у меня сейчас на экране?»

## Approvals

The first time Falcon wants to run a command he has not been allowed before, a prompt appears in the chat window. Choose **Allow once**, **Always allow** or **Deny**. If nobody answers, the command is refused.

## Using sites you are signed in to

Falcon has a browser of his own with no logins. For your mail, calendar or documents, either:

- sign in once inside Falcon's browser panel (you type the password; Falcon never does), or
- let him use your own Chrome: open `chrome://inspect/#remote-debugging` in Chrome, switch on remote debugging, and click **Allow** when Chrome asks.

## Uninstall

In PowerShell: `openclaw uninstall`

## Under the hood

Falcon runs on the open-source OpenClaw agent runtime (MIT licence, copyright its authors), configured and extended for this assistant. The licence text ships with the runtime.
