# Loop journal — experience-acp

> Theme: user-perspective UX (priority #1) · ACP (Agent Client Protocol) quality · source-code
> cleanup and architecture review. Worktree `/tmp/muse-experience-acp`, Tier2+ (owner standing
> authorization 2026-07-17). Cron registered 2026-09-04, session-scoped, 20-minute interval.
> Convention: [README](README.md) · index row in [INDEX.md](INDEX.md).

## Open queue

- [open] 2026-09-04 :: AXIS A — bare `muse` with no arguments in a non-interactive context prints
  "New here? Run `muse` to start chatting, or `muse setup` to configure a model." and then the full
  help tree. The user just ran `muse`, so the hint points at the command they already ran: a
  self-referential dead end. `museGettingStartedHint()` (apps/cli/src/program.ts) is documented as
  the `muse --help` header, but the no-args fallback prints it too. Fix: branch the hint on whether
  chat was actually reachable, or name the next step that differs from what was just run.
- [open] 2026-09-04 :: AXIS B — no ACP adapter exists (`git grep -i agent-client-protocol` is
  empty). First vertical slice: stdio JSON-RPC framing + the `initialize` handshake against
  protocol version 1, behind a `muse acp` entry point. Design material: growth-backlog ORC-1/2/5/8/
  9/10/11, competitor-teardown §12. Correct the growth-backlog line that calls ACP "Anthropic Code
  Protocol" while touching that file.

## fire 1 · 2026-09-04 · skill v3.x · (this commit)

meta: value-class=user-visible-truthfulness · pkg=runtime-state+cli · kind=fix · verdict=PASS · firesSinceDrill=1
ratchet: testFiles +0 (both new suites live in existing files) · runtime-state tests 222 → 231 · no eval delta

**what** — `muse doctor` reported a machine that had simply never installed the opt-in resident
daemon as a fatal failure: `[fail] local doctor — at least one fatal check` with `✗ resident daemon:
resident health failed: artifact missing, live definition mismatch, resident PID mismatch, heartbeat
missing, terminal state missing, restart state missing`. `muse status` on the same machine said
`daemon: not running (not installed) — run muse daemon --install`. Added a fourth state
`not-installed` to the shared health truth, reached only through `isResidentDaemonAbsent` — a full
conjunction requiring every install signal to be positively probed and absent, with both the
autostart and process probes reporting `ok`. Doctor renders it as a `warn` naming the install
command; qualification (`not-installed → failed`), the repair plan's absence path, and the API
status route keep their existing behavior.

**why** — the first diagnostic a new owner runs told them their clean install was broken, in six
internal-state phrases with no next action, and contradicted `muse status` about the same fact. The
codebase already argues this position for the proactive heartbeat check: absence of evidence is a
warning, not a green tick — and equally not a fatal error.

**review-points** — the predicate is deliberately evidence-positive: an observation that merely
OMITS `terminal`/`restart` (both optional on the public `RuntimeQualificationObservation`) does not
qualify as absent, so a synthesized observation can never launder its way into "nothing is broken".
Non-darwin platforms never reach `runtime: "not-registered"`, so Windows/Linux keep today's
classification untouched.

**risks** — `not-installed` is a fourth value on a union that crosses a package boundary; the six
consumer sites were enumerated and handled, and no serializer, parser or validator whitelists the
old three-value union.

**verification** — `pnpm -r build` · `typecheck:fast` · `lint` · `test:changed` (883 tests) ·
`@muse/cli` 5026/5026 · `@muse/runtime-state` 231/231 · `pnpm self-eval` 12/12 gates.
mutation-RED, six mutations, all caught then restored GREEN: (1) remove the `not-installed`
classification, (2) widen the predicate past the process-probe guard, (3) revert the doctor
rendering, (4) accept `heartbeat: "unknown"`, (5) drop the autostart-probe guard, (6) tolerate an
unprobed terminal state. Independent evaluator (separate Opus instance, fresh context) PASS after
driving the real `inspectResidentDaemon` → `runLocalDoctor` path end to end; mutations (4)-(6) and
the evidence-positive predicate are its findings, applied before commit.

**lesson** — probing a "fresh machine" via a temp `HOME` on a box that really does run the daemon is
contaminated: `launchctl` is user-global and still reported the service, so the observed reason codes
were not the ones a genuinely fresh machine produces. The defect was proven on the pure classifier
instead. Future UX fires: a temp `HOME` isolates files, never system-wide daemons or processes.
