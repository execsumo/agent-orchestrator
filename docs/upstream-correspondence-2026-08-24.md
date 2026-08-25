# Upstream correspondence — 2026-08-24

Archive of texts posted to `Untrivial-ai/agent-orchestrator` on 2026-08-24.
The working drafts live outside git at
`~/projects/agent-orchestrator-artifacts/`; this file is the durable copy.

## Comment on PR #4267 — chat-mode workers and `turn_complete`

https://github.com/Untrivial-ai/agent-orchestrator/pull/4267#issuecomment-5390966941

Live use surfaced a scope gap: chat-mode workers never fire `turn_complete`.
A delegated codex worker in chat mode completed its turn (two commits on its
branch) with no notification; the store held zero rows, so this was not the
resolution path or the CHECK bug — the emission guard (`Kind == worker &&
Mode == TUI`) excluded it. Proposal: drop the mode term so any non-terminated
worker transitioning active/waiting-input/blocked → idle notifies.
Counterargument acknowledged (volume); mitigations: per-session dedupe on an
unresolved `turn_complete`, or config gating. Ask: extend #4267 or follow up.

## Issue #4337 — opened, then closed same day

https://github.com/Untrivial-ai/agent-orchestrator/issues/4337

Originally: "Orchestrators have no way to learn that a delegated worker
finished its turn", proposing message-injection via the `ao send` path.

Closed with:

> Closing this — we investigated further and took a better path.
>
> **1. History we should have engaged with originally.** The daemon previously
> had exactly this capability: #2836 added a durable worker-idle→orchestrator
> outbox, #3038 hardened it after live noise problems (one worker generated 25
> nudges in an evening), and #3257 removed it entirely — *idle does not mean
> done*, and the human already sees session state in the UI. Proposing
> message-injection without that context was naive; the removal was clearly
> deliberate design, not an oversight.
>
> **2. Our actual problem was prompt asymmetry, not missing awareness
> machinery.** Issue-intake workers get *"open or update a pull request when
> ready"* appended to their prompts, so once they finish, the auto-review
> coordinator picks up the PR and progresses everything to ready-to-merge.
> Ad-hoc delegation briefs passed through verbatim — no PR instruction, no PR,
> no auto-review, and tickets stalled at commits. We fixed this on our side by
> giving delegated briefs the same completion-contract footer as intake, which
> closes the loop without reviving any of the removed machinery or changing
> daemon notification semantics.

### ⚠️ Correction owed on that comment (2026-08-25)

The quoted text above is archived as posted and is left unedited. Part 2 of it
is **wrong as written**, and the error is worth a follow-up comment before this
issue is cited anywhere upstream.

The fix that closed #4337 (`8a5d44791`) appended the footer inside
`DelegateTask`, which is reachable only from `POST /api/v1/orchestrators/delegate`
— the renderer's task composer, i.e. the *human*'s delegation path. An
orchestrator **agent** does not use that endpoint. Its own system prompt
(`session_manager/prompt.go:190`) tells it to delegate with `ao spawn --prompt`,
which is `POST /api/v1/sessions` → `Svc.Spawn`, and that path still passed the
brief through verbatim. So the comment's "we fixed this on our side by giving
delegated briefs the same completion-contract footer" was true only for briefs
typed by a human into the composer — not for the orchestrator-issued delegation
the issue was actually about.

Caught in dog-fooding the next day: worker `vibeboxui-4`'s delivered first user
turn was the brief with no footer. Fixed properly in `7b4169ad8`
(`deploy/all-features`), which moves the append into a `withCompletionContract`
helper called from **both** spawn paths. See HANDOFF.md §11.7.

If a PR goes upstream, it is the two-path helper — not the `DelegateTask`-only
footer described above.
