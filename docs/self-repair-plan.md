# Plan: Falcon repairs and extends himself

This plan obeys the ASD-STE100 rules: short sentences, active voice, one meaning for each word, and one instruction for each sentence.

Status: plan only. No stage is started.

## 1. Purpose

The owner tells Falcon about a fault or asks for a new function. Falcon reads his own files, makes the change, and tests the change. Falcon keeps the change only if all tests pass.

## 2. Limits

- The AI model does not learn. Falcon changes his files, not the model.
- Falcon changes only his own program and his skills.
- Falcon does not change the engine (OpenClaw). The engine stays the official version.
- The automatic tests are the judge of each change.

## 3. Words used in this plan

| Word | Meaning |
|---|---|
| Owner | The person who installed Falcon on the PC. |
| Maker | The person who publishes Falcon on GitHub. |
| Skill | A small set of instructions and scripts for one task. |
| Workshop | A full, separate copy of Falcon on the same PC. |
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

## 5. How one repair operates

1. The owner describes the fault in Falcon's window.
2. Falcon tells the owner the estimated cost. The owner approves.
3. Falcon makes the workshop copy.
4. The writer finds the cause and changes the files in the workshop.
5. Falcon adds a test that shows the fault. This test must pass after the repair.
6. Falcon does all automatic tests in the workshop.
7. The reviewer examines the change. If the reviewer finds a problem, the writer corrects it.
8. Falcon starts the workshop copy and makes sure that it answers.
9. Falcon shows the summary to the owner. The owner approves or refuses.
10. Falcon saves the last version, installs the change, and starts again.
11. If the start is not successful, Falcon goes back to the last version and tells the owner.

## 6. Work stages

### Stage 0: Trial of the coding tools

- **Task:** Give the same 3 real Falcon faults to OpenCode, to Codex, and to the engine. Do the trial on Windows.
- **Measure:** the number of correct repairs, the time, and the cost for each tool.
- **Result:** the best writer and the best reviewer.
- **Time:** half a day. **Cost:** 2 to 5 US dollars of AI credit.

### Stage 1: Falcon makes new skills

- **Task:** Falcon writes a new skill, tests it, and keeps it.
- **Risk:** low. A bad skill stops only that skill.
- **Done when:** the owner asks for a new skill, and the skill operates in the same conversation.
- **Time:** 1 day.

### Stage 2: The workshop

- **Task:** Make the workshop copy, the test step, the start step, and the automatic return to the last version.
- **Done when:** a change that breaks the start is installed for test, and Falcon goes back in 60 seconds.
- **Time:** 3 to 4 days.

### Stage 3: Fault repair with a writer and a reviewer

- **Task:** Connect the 2 selected coding tools to the workshop. Add the cost estimate and the approval screen.
- **Done when:** Falcon repairs 3 known faults from a plain request, and all tests pass.
- **Time:** 2 to 3 days.

### Stage 4: Personal changes that stay after a release

- **Task:** Save each personal change as a separate item with a plain description.
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

### Stage 6 (optional): The race for difficult faults

- **Task:** 2 or 3 coding tools repair the same fault in separate workshops. Falcon keeps the repair that passes all tests with the smallest change.
- **Time:** 1 day.

## 7. Cost for the user

| Method | Cost for each repair |
|---|---|
| One coding tool | 0.20 to 2 US dollars |
| Writer and reviewer | Approximately 1.5 times the cost of one tool |
| Race | 2 to 3 times the cost of one tool |

Repairs use a stronger AI model than daily work. Daily work continues to use the low-cost model.

## 8. Sequence and total time

Do the stages in this sequence: 0, 1, 2, 3, 4, 5. Stage 6 is optional. The total time is approximately 10 to 16 work days.

## 9. Decisions that the maker must make

1. Approve the trial in Stage 0 and its cost of 2 to 5 US dollars.
2. Decide if customers can install repairs on their PCs, or only send them to the maker.
3. Set a cost limit for one repair. The recommended limit is 2 US dollars.
4. Decide if Falcon does the reviewer step for every repair or only for large changes.
