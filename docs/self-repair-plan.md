# Plan: Falcon repairs and extends himself

This plan obeys the ASD-STE100 rules: short sentences, active voice, one meaning for each word, and one instruction for each sentence.

Status: Stages 0, 1 and 2 are complete. Stages 2B and 3 are built and tried. Stage 4 is next.

## 1. Purpose

The owner tells Falcon about a fault or asks for a new function. Falcon reads his own files, makes the change, and tests the change. Falcon keeps the change only if all tests pass.

## 2. Limits

- The AI model does not learn. Falcon changes his files, not the model.
- Falcon changes his own program, his skills, and his add-ons.
- Falcon changes the engine (OpenClaw) only as section 6 permits.
- Falcon cannot change the Falcon project or the OpenClaw project on GitHub.
- The automatic tests are the judge of each change.

## 3. Words used in this plan

| Word | Meaning |
|---|---|
| Owner | The person who installed Falcon on the PC. |
| Maker | The person who publishes Falcon on GitHub. |
| Skill | A small set of instructions and scripts for one task. |
| Add-on | A small folder of code that the engine loads at its start. It is not part of the engine's files. |
| Git | A standard tool that records each change to a set of files. |
| Local history | The Git record of Falcon's files on one PC. It has no connection to GitHub. |
| Branch | A separate line of changes in the local history. |
| Workshop | A full, separate copy of Falcon on the same PC, on its own branch. |
| Workshop window | A second Falcon window that shows the work in the workshop while it occurs. |
| Coding tool | A program that writes code. Falcon uses 2: Codex, and the coding part of the engine. |
| Writer | The coding tool that makes a change. |
| Reviewer | A second examination of the change, with a different AI model from the writer. |
| Personal change | A change that stays on one PC only. |
| Release | A new version of Falcon that the maker publishes. |

## 4. Safety rules

1. Only the owner can start a change. The owner must type the request in Falcon's window.
2. Falcon must ignore change requests from Telegram, web pages, files, and e-mail.
3. Falcon must make each change in the workshop. Falcon must not change the Falcon that is in operation.
4. Falcon must show a short summary of the change in plain words.
5. Falcon must wait for the owner's approval before he installs the change.
6. Falcon must keep the last version that operated correctly.
7. If the new version does not start in 60 seconds, Falcon must go back to the last version.
8. Falcon must not send data to GitHub without the owner's approval.
9. Falcon must tell the owner the estimated cost before he starts a repair.
10. Falcon must not put keys or passwords into a change.
11. The local history must not have a connection to GitHub.
12. Falcon must not change the files of the engine that is in operation.

## 5. How one repair operates

1. The owner describes the fault in Falcon's window.
2. Falcon tells the owner the estimated cost. The owner approves.
3. Falcon makes the workshop copy on a new branch and opens the workshop window.
4. The writer finds the cause and changes the files in the workshop.
5. Falcon adds a test that shows the fault. This test must pass after the repair.
6. Falcon does all automatic tests in the workshop.
7. The reviewer examines the change. If the reviewer finds a problem, the writer corrects it.
8. Falcon starts the workshop copy and makes sure that it answers.
9. Falcon shows the summary in the workshop window. The owner approves or refuses.
10. Falcon saves the last version, installs the change, and starts again.
11. If the start is not successful, Falcon goes back to the last version and tells the owner.
12. Falcon records the change in the local history as a personal change.

## 6. Changes to the engine

Each engine update replaces the engine's files. Thus a change in those files does not stay. Use these methods in this sequence:

1. **Settings.** Falcon changes a setting of the engine. Settings stay after an engine update.
2. **Skill.** Falcon adds a skill. The engine reads the skill. The engine's files do not change.
3. **Add-on.** Falcon writes an add-on in the workshop and tests it. Add-ons stay after an engine update. If an add-on has a fault, Falcon sets it to off, and the engine continues to operate.
4. **Small personal patch.** Falcon changes a file of the engine. This method is permitted only if all these conditions are true:
   - Methods 1, 2, and 3 cannot do the task.
   - The change is small.
   - Falcon makes and tests the change on a second copy of the engine in the workshop.
   - The owner approves the change.
   - After each engine update, Falcon applies the patch again and does the tests. If the patch does not fit, Falcon sets it to off and tells the owner.
5. **Proposal to the OpenClaw project.** For a large engine change, Falcon writes a proposal for the maker. The maker decides if he sends it to OpenClaw.

A private copy of the full engine is not part of this plan. The maker can decide on it for one customer.

## 7. Git and the local history

- Falcon uses Git for the workshop, for personal changes, and for releases.
- If the PC does not have Git, Falcon installs a small portable Git. The size is approximately 30 MB. An administrator password is not necessary.
- Falcon installs Git only when the owner uses self-repair for the first time.
- Falcon gets Git from its official source and makes sure that the checksum is correct.
- The uninstaller removes the Git that Falcon installed. It does not remove a Git that was on the PC before.
- The local history has 3 branches:

| Branch | Contents |
|---|---|
| Release | The version that the maker published. |
| Personal | The release plus the personal changes of this PC. Falcon operates from this branch. |
| Workshop | One branch for each repair that is in work. |

- When a release arrives, Falcon updates the release branch. Then Git applies the personal changes on top of the new release.
- Git reports each personal change that does not fit. Falcon then obeys Stage 4.

## 8. The workshop window

The workshop window is Falcon's own window. It is not the screen of the coding tool. Thus the owner sees the same window for each coding tool, in Falcon's style and with Falcon's name.

The window shows these items while the work occurs:

- The task, in the owner's words.
- The AI model that does the work.
- Each step, in plain words. Example: "Running the tests".
- Each file that changed, with the lines before and after the change. Removed lines are red. Added lines are green.
- The test results: the number of tests that pass, and the names of the tests that fail.
- The cost and the time up to this moment.

The window has these controls:

- **Stop:** stops the work. The Falcon that is in operation does not change.
- **Approve** and **Refuse:** shown when the work is complete.
- **Show details:** shows the full output of the coding tool. This control is for the maker.

How it operates: the coding tool sends its work to Falcon as a sequence of events. Falcon reads the events and shows them in the window. Codex sends these events on Windows (Stage 0 showed this). For the engine, Falcon uses his direct line to the engine, which shows each step in the main window today.

## 8B. The panel "What I can do"

The panel "What I can do" shows each function of Falcon as a tile: Files, Documents, Apps, Screen, Browser, Web search, Mail and calendar, Slides, Pictures and video, Scout, Memory, Music and volume, Telegram, Morning briefing, Voice, and Learned. A function that needs a setting shows its state, for example "Not set up" or "Daily at 08:00". Each stage that adds a function to the owner also adds or changes a tile. A tile shows the state of its function in 1 to 3 words. It lights while Falcon uses it. When the owner presses it, it shows an example request.

| Stage | Tile | Text on the tile |
|---|---|---|
| 1 | Learned | "Ready", the number of learned methods, or the number of programs that wait for the owner's approval |
| 3 | Repair | "Ready", "Needs a coding key", or "Working" while a repair is in progress |
| 4 | Repair | Also the number of personal changes |
| 6 | Add-ons | The number of add-ons that Falcon made, or "Off" if one has a fault |

## 9. Coding tools and AI keys

### 9.1 The coding tools

| Condition | Writer |
|---|---|
| The owner has an OpenAI key. | Codex. It is the fastest tool, and it does its work in a safety box. |
| The owner has only an OpenRouter key. | The coding part of the engine. It is part of OpenClaw, thus no installation is necessary. |

- Falcon installs Codex only when the owner sets the coding job to an OpenAI key.
- The reviewer is the engine with a different AI model from the writer.
- OpenCode is not used. It repaired all faults in the trial, but it adds a download of 213 MB and no new function.
- Codex with an OpenRouter key is not tested. Do this test before you permit it.

### 9.2 The screen "Which AI does what"

The owner selects a key and a model for each job. Each action of Falcon uses the key and the model of its job.

| Job | Key | Model |
|---|---|---|
| Everyday work | OpenAI, Anthropic, or OpenRouter | The owner selects from the models that the key gives. |
| Voice | OpenAI only | Fixed. Voice uses the OpenAI service. |
| Coding and self-repair | OpenAI or OpenRouter | A stronger model. The screen shows a price note. |

- At the first setup, the owner enters 1 key. Falcon fills each job that this key can do.
- A second key is optional.
- The same screen is in Settings. The owner can change each job there.
- Falcon's window shows the AI that is in use for the current action.

## 10. Work stages

### Stage 0: Trial of the coding tools (complete)

The trial was done on Windows on 2026-11-20. Each tool got the same 3 past Falcon faults in a separate copy of the code. The tests that were held back were the judge. All tools used the same AI model (GPT-6.1 Terra) with an OpenAI key.

| | Codex | OpenCode | Engine |
|---|---|---|---|
| Faults repaired | 3 of 3 | 3 of 3 | 3 of 3 |
| Added a test | each time | each time | each time |
| Time for each repair | 1 to 3.5 minutes | 2.5 to 3.5 minutes | approximately 5 minutes |
| Safety box | yes | no | no |
| Sends each step as an event | yes | yes | no, only the result |
| Installation | necessary | necessary, 213 MB | not necessary |

- **Cost:** approximately 1 US dollar for all 9 repairs. This is an estimate. OpenCode reported 0.26 US dollars for its 3 repairs.
- **Windows faults found:** The OpenCode installation failed until its Windows part was installed by name. Codex needs its Windows safety setting and its own key variable. The engine needs a new model list in a new settings folder.
- **Limits of the trial:** The faults were small. Only an OpenAI key was tested.

### Stage 1: Falcon makes new skills (built and tested on 2026-11-20)

- **Task:** Falcon writes a new skill, tests it, and keeps it.
- **Risk:** low. A bad skill stops only that skill.
- **Done when:** the owner asks for a new skill, and the skill operates in the same conversation.
- **Time:** 1 day.
- **Method:** Falcon uses the learned-skills function of the engine. The engine keeps the previous version before each change. Thus each change can be undone.
- Falcon sets the background learning of the engine to off. Falcon learns only when the owner asks in his window. The rules of Falcon tell him to confirm first, do the task once, and then keep the method.
- Settings has a tab "Learned". It shows each learned skill. The owner can remove a skill and bring it back.
- A program in a learned skill runs only after the owner approves it in the window.
- **Real test:** the owner asked Falcon to learn the official dollar rate. Falcon asked first, did the task, and gave the correct rate. At the first attempt he said that the tool was not available. He did not try it. At the second attempt he saved the method correctly. The rules now tell him that the tool is always available in his window.
- **Tested on 2026-11-20:** in a new conversation, Falcon read the learned method and used it directly.
- **Fault found:** the engine does not ask for approval of a new program when the request comes from Falcon's window. It refuses the program. Thus a learned program could not operate.
- **Correction:** the tab "Learned" shows each new program with its text and the control "Allow this program". When the owner allows it, Falcon adds that program to the list of programs that the engine trusts. If the program changes later, Falcon removes the permission until the owner allows it again.
- The panel "What I can do" has the tile "Learned" (see section 8B).
- **Tested on 2026-11-20 on the owner's PC:** the owner allowed the C-drive program. Then Falcon used it and gave the correct free space (76.1 GB of 475.8 GB, the same as Windows shows).
- **Small gap:** while the program operates, the step shows the engine's own title, not "Using something I learned". The window gets only the title of that step.

### Stage 2: Git and the workshop (complete on 2026-11-20)

- **Built:** finding Git or installing the portable Git with its checksum, the local history, the workshop copy, the tests and the start check in the workshop, the switch, and the watchdog that puts the last working version back.
- **Tested on a temporary copy on a developer PC:** a good change was switched in and kept in 5 seconds. A change that breaks the start was put back after the 60-second wait, and the last working version started again (66 seconds in total).
- **The watchdog waits 60 seconds** for the new version to answer. Then it puts the last working version back and starts it. The total time is a little more than 60 seconds.
- **Tested on a clean Windows PC without Git (2026-11-20):** Falcon installed the portable Git (MinGit 2.56.1) and checked its checksum. A good change was switched in and kept in 2 seconds. A change that breaks the start was put back after 63 seconds, and the last working version started again.
- **Not done yet:** a message in the window when Falcon puts the last version back. The owner cannot use the workshop yet; Stage 3 connects it.
- **Task:** Install the portable Git if the PC does not have Git. Make the local history from the installed files.
- **Task:** Make the workshop copy, the test step, the start step, and the automatic return to the last version.
- **Task:** Add the removal of Falcon's Git to the uninstaller.
- **Done when:** on a clean Windows PC without Git, Falcon installs Git and makes a workshop.
- **Done when:** a change that breaks the start is installed for test, and Falcon goes back in 60 seconds.
- **Time:** 4 to 5 days.

### Stage 2B: The screen "Which AI does what" (built on 2026-11-20)

- **Built:** Settings, tab "AI key", has the panel "Which AI does what". It shows the AI for everyday work, for voice, and for coding and repairs. The owner selects the coding AI from the models that his keys give. Without a selection, Falcon uses the recommended model of his keys: with an OpenAI key, Codex does the work; with only an OpenRouter key, the engine does it.
- **Not tested yet:** a repair that uses the selected AI. Stage 3 adds repairs.

- **Task:** Make the screen as section 9.2 tells, in the first setup and in Settings.
- **Task:** Make each action use the key and the model of its job.
- **Done when:** a conversation, a voice request, and a repair each use the AI that the owner selected for that job.
- **Time:** 2 days.

### Stage 3: Fault repair with a writer and a reviewer (built and tried for real on 2026-11-20)

- **Built:** the Workshop window (the tile "Repair" opens it), the estimate and the owner's agreement before a start, the writer (Codex with an OpenAI key, installed when first needed; the engine with only an OpenRouter key), the tests and the start check in the workshop, the reviewer (a different AI model), one correction, Stop, Approve, and Refuse. Approve switches the change in with the watchdog.
- **Tested with a pretend writer and reviewer:** a full repair, a correction, a repair that still fails and cannot be approved, and Stop.
- **Real repair on a throwaway copy (2026-11-20):** the request "mute and unmute instantly, in English and Russian". The engine with GPT-6.1 Terra changed 3 files and added a test in 8 minutes. All 118 tests passed, the copy started, and Claude Haiku 5.5 found no problems. Approve switched it in, and the new Falcon answered in 2 seconds. The cost was 12 US cents (writer 11.9, reviewer 0.4).
- **The window shows the real cost** when the engine does the work. With Codex it shows the estimate.
- **Not tested yet:** a repair with Codex (it needs an OpenAI key saved in Falcon), Approve on the owner's own Falcon, and the new mute command on real speakers.

- **Task:** Connect Codex and the engine to the workshop, as section 9.1 tells. Add the cost estimate.
- **Task:** Install Codex when it is necessary, with its Windows safety setting. Add its removal to the uninstaller.
- **Task:** Make the workshop window as section 8 tells.
- **Done when:** Falcon repairs 3 known faults from a plain request, and all tests pass.
- **Done when:** the owner sees each step and each changed file in the workshop window, and the Stop control operates.
- **Time:** 4 to 6 days.

### Stage 4: Personal changes that stay after a release

- **Task:** Save each personal change on the personal branch, as a separate item with a plain description.
- **Task:** Change the Update button so that a release goes through the local history.
- When the maker publishes a release, Falcon installs the release first. Then Falcon applies the personal changes again and does the tests.
- If a personal change does not fit the release, Falcon tries to adapt it in the workshop.
- If Falcon cannot adapt it, Falcon sets that change to off and tells the owner.
- The owner can see a list of personal changes. The owner can set all of them to off for a test.
- **Done when:** a PC with 2 personal changes gets a release, and Falcon operates correctly afterwards.
- **Time:** 3 to 5 days.

### Stage 5: Send a repair to the maker

- **Task:** The owner can send a repair to the maker as a proposal. The maker approves it, and the next release gives it to all users.
- **Done when:** a repair from a test PC arrives on GitHub as a proposal, with no personal data.
- **Time:** 1 to 2 days.

### Stage 6: Add-ons and engine patches

- **Task:** Falcon writes an add-on in the workshop, tests it, and installs it.
- **Task:** Start a second copy of the engine in the workshop for tests of add-ons and patches.
- **Task:** Apply personal patches again after an engine update, as section 6 tells.
- **Not tested:** 2 copies of the engine on one PC at the same time. Do this test first.
- **Done when:** Falcon adds a new tool with an add-on, and the tool stays after an engine update.
- **Time:** 3 to 4 days.

### Stage 7 (optional): The race for difficult faults

- **Task:** Codex and the engine repair the same fault in separate workshops, or one tool does it with 2 different AI models. Falcon keeps the repair that passes all tests with the smallest change.
- **Time:** 1 day.

## 11. Cost for the user

| Method | Cost for each repair |
|---|---|
| One coding tool | 0.20 to 2 US dollars |
| Writer and reviewer | Approximately 1.5 times the cost of one tool |
| Race | 2 to 3 times the cost of one tool |

Repairs use a stronger AI model than daily work. Daily work continues to use the low-cost model.

## 12. Sequence and total time

Do the stages in this sequence: 1, 2, 2B, 3, 4, 5, 6. Stage 7 is optional. The total time is approximately 19 to 26 work days.

## 13. Decisions that the maker must make

1. Approve a test of Codex with an OpenRouter key. The cost is approximately 0.10 to 0.20 US dollars.
2. Decide if customers can install repairs on their PCs, or only send them to the maker.
3. Set a cost limit for one repair. The recommended limit is 2 US dollars.
4. Decide if Falcon does the reviewer step for every repair or only for large changes.
5. Decide if customers can use small personal patches on the engine, or only add-ons.
