# Verified actions, task centre and readiness

Task: verified-tasks-readiness. Source: explicit user request to implement the three agreed improvements, 17 November 2026.

Scope: implement actual action verification, a task centre with execution cancellation, and readiness diagnostics in farhodsaraev/falcon. No merge, release or installed-user changes performed by this development run.

Repository: farhodsaraev/falcon. Branch codex/verified-tasks-readiness. Base 192f3a42546625e8d2c16cb1302346c33613f1a9. Current changes uncommitted; PR and current-HEAD CI pending.

Implementation: tasks.js keeps private bounded task snapshots and control fences. Each task gets a unique engine session; bounded conversation messages preserve follow-ups. OpenClaw before/after-tool hooks report actual results and deny new tools after cancellation. AbortSignal cancels HTTP; chat.abort targets only the task session. Stop remains unconfirmed without a matching runtime acknowledgment or settled hook. Pending approvals are scoped by session. Readiness probes are read-only and distinguish blocked/unknown; explicit tracking repair updates existing installations and reloads the assistant.

Entry points: src/app/server.js, tasks.js, readiness.js, addon.js; falcon-agent/engine-addon/task-hooks.js, verification.js, inspect-slide.js; ui/tasks.js, bridge.js, renderer.js, voice.js.

Acceptance: model [[did]] cannot create verified cards; file readback detects mismatches; presentation app is inspected independently; late/foreign task events cannot affect a successor; Stop cancels execution or explicitly remains unconfirmed; unavailable dependencies/permissions never get fabricated ready states; existing installations can update tracking.

Observed checks on Windows/Node24 against working diff: baseline 48/48 passed after moving TEMP/TMP into workspace (sandbox AppData restriction was environment-only). New task contracts 11/11; complete suite 59/59. Tests use a local controllable HTTP gateway and actual document/file fixtures, not paid AI or live Office. Runtime CLI and hook types checked against upstream OpenClaw primary sources. Independent read-only review found six issues; fixes implemented, follow-up review pending.

Known boundaries: completed external effects are not undone. Unsupported action postconditions remain unverified. Mac Office/Keynote permission behavior and paid real-AI flows not live-tested. Chrome headless UI checks passed on Windows: verified card, Stop through UI/API, Escape/focus, readiness and layouts at 520px/375px, with no page errors. Current-commit CI pending.

Next: complete independent follow-up review, commit, open PR from the authorized fork and verify its HEAD CI. No production merge authorization supplied.
