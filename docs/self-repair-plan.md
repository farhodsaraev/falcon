# Plan: Falcon repairs and extends himself

This plan obeys the ASD-STE100 rules: short sentences, active voice, one meaning for each word, and one instruction for each sentence.

Status: plan only. No stage is started.

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
| Coding tool | A program that writes code: OpenCode, Codex, or the engine. |
| Writer | The coding tool that makes a change. |
| Reviewer | A different coding tool that examines the change. |
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

How it operates: the coding tool sends its work to Falcon as a sequence of events. Falcon reads the events and shows them in the window. Stage 0 must make sure that each coding tool can send these events on Windows.

## 9. Work stages

### Stage 0: Trial of the coding tools

- **Task:** Give the same 3 real Falcon faults to OpenCode, to Codex, and to the engine. Do the trial on Windows.
- **Measure:** the number of correct repairs, the time, and the cost for each tool.
- **Examine:** if each tool can send its work as events for the workshop window.
- **Result:** the best writer and the best reviewer.
- **Time:** half a day. **Cost:** 2 to 5 US dollars of AI credit.

### Stage 1: Falcon makes new skills

- **Task:** Falcon writes a new skill, tests it, and keeps it.
- **Risk:** low. A bad skill stops only that skill.
- **Done when:** the owner asks for a new skill, and the skill operates in the same conversation.
- **Time:** 1 day.

### Stage 2: Git and the workshop

- **Task:** Install the portable Git if the PC does not have Git. Make the local history from the installed files.
- **Task:** Make the workshop copy, the test step, the start step, and the automatic return to the last version.
- **Task:** Add the removal of Falcon's Git to the uninstaller.
- **Done when:** on a clean Windows PC without Git, Falcon installs Git and makes a workshop.
- **Done when:** a change that breaks the start is installed for test, and Falcon goes back in 60 seconds.
- **Time:** 4 to 5 days.

### Stage 3: Fault repair with a writer and a reviewer

- **Task:** Connect the 2 selected coding tools to the workshop. Add the cost estimate.
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

- **Task:** 2 or 3 coding tools repair the same fault in separate workshops. Falcon keeps the repair that passes all tests with the smallest change.
- **Time:** 1 day.

## 10. Cost for the user

| Method | Cost for each repair |
|---|---|
| One coding tool | 0.20 to 2 US dollars |
| Writer and reviewer | Approximately 1.5 times the cost of one tool |
| Race | 2 to 3 times the cost of one tool |

Repairs use a stronger AI model than daily work. Daily work continues to use the low-cost model.

## 11. Sequence and total time

Do the stages in this sequence: 0, 1, 2, 3, 4, 5, 6. Stage 7 is optional. The total time is approximately 17 to 24 work days.

## 12. Decisions that the maker must make

1. Approve the trial in Stage 0 and its cost of 2 to 5 US dollars.
2. Decide if customers can install repairs on their PCs, or only send them to the maker.
3. Set a cost limit for one repair. The recommended limit is 2 US dollars.
4. Decide if Falcon does the reviewer step for every repair or only for large changes.
5. Decide if customers can use small personal patches on the engine, or only add-ons.
