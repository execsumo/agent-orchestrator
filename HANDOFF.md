# Agent Orchestrator: Tailnet Web Supervision

**Status (2026-08-23, late):** **every workstream W0–W6 is built and verified,
every gate G0–G8 passes, and the integration branch has been split into
upstreamable branches.** A browser on loopback renders live data and a real
streaming PTY with no Electron; the full tailnet loop works from a second
device — board, terminal, chat, orchestrator delegation, recovery, port-drift;
and the security suite is proven clause by clause.

**Five upstream PRs are open:** #4266 and #4267 (the two post-gate fixes), and
#4309, #4312, #4313 (W1, W0+W2, and W4 from the split). See the branch table in
§11.1.

⚠️ **`main` is a stale base.** The fork's `main` is **24 commits behind
`upstream/main`** (0 ahead — a clean fast-forward). The three frontend split
branches have already been rebased onto `upstream/main`; the **integration branch
has not** and still sits on the old base. Anything cut from the integration
branch today inherits that staleness — see §11.8.

**The local daemon now runs `deploy/all-features`** — `upstream/main` plus every
slice, both fixes, W6 and the picker tests. `~/bin/ao` was rebuilt and the daemon
restarted 2026-08-23 17:55. See **[§11.9](#119-deployall-features--the-branch-the-local-daemon-now-runs)**
for the assembly order, the build ordering a blank page depends on, and the
rollback path.

**The tailnet loop is verified end to end.** The operator loaded
`https://vibebox.goose-marlin.ts.net:8443/` from a second device and the page
renders. That check surfaced one regression the rebuild had shipped — an
Open-in-editor error banner on every session view — **fixed in `96eaf5b4a`**
(§11.9). A **hard refresh is required after any rebuild**, or the cached previous
bundle makes a good build look broken.

**The build is finished.** The §11.7 branch deletions were **executed
2026-08-24** (11 local branches + 3 worktrees removed, containment proofs re-run
first). **State as of 2026-08-25:** the daemon runs `deploy/all-features` @
`7b4169ad8`, which adds three fork-local fixes on top of the assembly —
chat-mode workers fire `turn_complete` (`b6c4c5bf9`), delegated briefs carry the
same completion contract as issue intake (`8a5d44791`), and that contract
actually reaches orchestrator-spawned workers (`7b4169ad8` — `8a5d44791` put it
on the composer path only, so `ao spawn`, which is how an orchestrator
delegates, still shipped briefs verbatim; see §11.7). Rollback:
`~/bin/ao.pre-7b4169ad8`. Upstream threads open: five PRs (#4266,
#4267, #4309, #4312, #4313) plus a pending discussion comment on #4267 (widening
to chat workers); #4337 was opened and **closed by us** — on the incomplete fix,
so a correction is owed there (drafted, unposted, in
`docs/upstream-correspondence-2026-08-24.md`). Remaining: W3's PR queued behind
#4312 merging, maintainer responses, and **the live verification that has now
slipped two cycles** — delegate a real task and confirm the worker's delivered
prompt carries the footer, then that it opens its PR and lanes progress
unattended. §11.7 has the one-line SQL for the first half.

⚠️ **`turn_complete` was observed 2026-08-23 (late) and the observation found a
real bug** — the feature fired correctly but the schema's CHECK constraint
rejected every insert, silently, because notification writes are best-effort.
**Fixed in `0107`**, live-confirmed, and pushed to PR #4267. Read
**[§11.10](#1110-turn_complete-observed--and-the-schema-bug-the-observation-found)**
— it also carries the test-suite facts (11 `npm run test` failures, none of them
ours) and the reboot gap.

⚠️ **This file, on branch `docs/tailnet-webui-handoff`, is the only authoritative
copy.** The copies in `../agent-orchestrator-worktrees/w0`–`w5` are the
pre-fan-out draft that still claims "W0 in progress, W1–W6 not started". They are
wrong. Do not orient off a worktree copy.

**Starting fresh with no context? Read [§11.1](#111-what-exists-right-now)
first** — it is the current state of the world, including what is merged, what
is running, and exactly what to do next. Then read §2 (what upstream already
ships) and §3 (the architecture and what was rejected).

⚠️ **Before running any test suite, read [§7 G0b](#7-verification-gates).** This
box has 4 cores; under parallel agents the suites produce **false** timeout
failures, and "fixing" one corrupts working code.

---

## 1. Goal

Supervise coding agents running inside this container from a **web browser on any
device on the user's Tailscale tailnet** — no Electron, no desktop GUI, nothing
exposed to the public internet.

A person opens one URL, logs in with a password, and gets the full Agent
Orchestrator workspace: projects, the Kanban board of workers, the **project
orchestrator** (planning + delegation) as a first-class surface, live agent
terminals, chat, PR/CI/review state, and task completion.

Constraints that shape every decision below:

- Reuse upstream's work. Do not rebuild what already ships.
- Keep generally-useful changes upstreamable; keep this container's deployment
  glue separate.
- Never expose anything publicly. Tailnet-only, authenticated.
- Prefer robust and durable over clever.

---

## 2. Corrected baseline — what upstream already ships

The original draft described upstream as "Electron-first with a loopback-only
daemon" and framed tailnet reachability as the big unknown. That is wrong. Every
line below was verified by reading the code in this checkout.

| Capability | Status | Evidence |
| --- | --- | --- |
| Network-facing authenticated listener | **Ships** ("Connect Mobile") | `backend/internal/httpd/lan_listener.go` |
| Bearer-password auth + per-source lockout | **Ships** | `backend/internal/httpd/auth.go` |
| Tailnet-only TLS via `tailscale serve` (never `funnel`) | **Ships** | `backend/internal/mobilebridge/tailscaleserve.go` |
| MagicDNS hostname discovery | **Ships** | `backend/internal/mobilebridge/magicdns.go` |
| Control-route blocking at the socket | **Ships** | `lanControlBlockedPrefixes` in `lan_listener.go` |
| Remote supervisor client | **Ships, but native** (Expo/React Native) | `packages/mobile/` |
| Daemon lifecycle without Electron | **Ships** | `ao daemon` / `start` / `stop` / `status` / `doctor` in `backend/internal/cli/root.go` |
| PTY terminals served by the daemon | **Ships** | `backend/internal/terminal`, `/mux` in `httpd/terminal_mux.go` |
| Renderer bridge abstraction with a browser fallback | **Ships** | `frontend/src/renderer/lib/bridge.ts` (193 lines, complete stub) |
| Browser dev mode with an API/WS proxy | **Ships** | `dev:web` + `server.proxy` in `frontend/vite.renderer.config.ts` |
| Project orchestrator + delegation | **Ships** | `backend/internal/service/session/delegation.go`, `/api/v1/orchestrators*` |
| **Anything that serves a web UI to a browser** | **Does not exist** | no static/SPA handler anywhere in `backend/internal/httpd` |

**So the transport, auth, TLS, and remote-supervision semantics are done.** The
missing piece is narrower and different from what the first draft assumed: there
is no browser client, and the renderer cannot currently act as one.

### The three things that actually block a browser client

1. **`VITE_NO_ELECTRON` is overloaded.** The vite proxy comment says the flag
   exists to test "against a running daemon", but the same flag *unconditionally*
   switches the renderer to mock data — `lib/preview-mode.ts`,
   `hooks/useWorkspaceQuery.ts` (returns `mockWorkspaces`), `useShellTerminals`,
   `useMigrationOffer`, `useSessionScmSummary`, `useSystemRequirementsGate`.
   There is no escape hatch. `dev:web` is a **design preview**, not a web client.

2. **Browser transports cannot carry a Bearer header.** LAN auth is
   `Authorization: Bearer <password>` on every request. The Expo app gets away
   with it because React Native's `WebSocket` accepts a `headers` option
   (`packages/mobile/lib/mux.ts:136`). A browser cannot do that for
   **WebSocket** (`/mux`, terminals) or **EventSource** (`/api/v1/notifications/stream`,
   `/api/v1/sessions/{id}/workspace/events`), nor for the **top-level HTML
   navigation** that loads the app.

3. **Electron-only assumptions in ~7 renderer files.** Not 131 — that earlier
   number counted test files and text matches. The real non-test direct
   `window.ao` uses are in `BrowserPanel.tsx`, `hooks/useBrowserView.ts`,
   `TerminalPane.tsx`, `WindowTitlebar.tsx`, `SessionView.tsx`, `main.tsx`,
   `InstallDependencyDialog.tsx`. Everything else already goes through
   `aoBridge`. The worst one is `TerminalPane.tsx:669` — `if (!window.ao)` early-returns
   a **static fake terminal**, so terminals are stubbed by Electron-absence
   rather than by real capability.

---

## 3. Architecture decision (ADR-0003, inline)

### Decision

**Serve the existing renderer, built for a browser target, as static assets from
the daemon's existing LAN listener, authenticated by a session cookie, reached
over `tailscale serve` on a non-conflicting HTTPS port.**

Three sub-decisions, each with the rejected alternative:

**3.1 De-Electronize the existing renderer — do not build a new web client.**
`frontend/src/renderer/lib/bridge.ts` is already a single, complete, typed
abstraction over every Electron capability, with a working browser fallback and
a `nativeCompositionEnabled: false` flag already in it. The alternative — a thin
client on `packages/product-ui` + `packages/cloud-client` — was rejected:
`cloud-client` targets the **AO Cloud API**, not the daemon, and product-ui
carries leaf components only, so that path means re-implementing the entire
product UI. That is the opposite of leveraging existing work.

**3.2 Serve from the LAN listener — not from a reverse proxy in front of loopback.**
A Caddy/nginx proxy fronting `127.0.0.1:3001` needs zero Go changes, and was
rejected anyway. The loopback listener is unauthenticated *by design*, and its
protections are enforced at the socket: `lanControlBlockedPrefixes` 404s
`/shutdown`, `/internal/`, `/api/v1/mobile`, `/api/v1/dev`, `/api/v1/browser`,
`/api/v1/system/install`, and the comment there is explicit that the socket is
"the one thing a caller cannot spoof" because `localControlRequest` and `RealIP`
trust client-supplied `Host` / `X-Forwarded-For`. A proxy would have to
re-implement that blocklist correctly and forever. Reusing the LAN listener
inherits auth, lockout, and the control-block for free. It also makes the SPA
**same-origin** with the API, which removes CORS from the design entirely.

AGENTS.md's hard rule — *"Do not add any other network-facing bind"* — is
respected: this adds **no new listener**. It adds static routes and a second
credential form to the listener that already exists. Like ADR-0001 before it,
this ADR extends what that listener may serve; AGENTS.md should be amended to
say the LAN listener may also serve the web UI.

**3.3 Browsers authenticate by tailnet identity, with a session cookie as the
universal fallback — Bearer stays for native clients.**
A browser cannot attach `Authorization` to a WebSocket or an `EventSource`, so
the Bearer scheme that serves the Expo client cannot serve a browser. Two
credentials that *do* reach all three transports were measured working through
the proxy (§4): the **`Tailscale-User-Login` header** that `tailscale serve`
injects, and a **session cookie**. Identity is the primary path here — no
password to type or rotate, revocation via Tailscale ACLs — with the cookie as
the fallback for any deployment not behind `tailscale serve`. Precedence and the
loopback-bind invariant that makes identity trustworthy are in §5.7.

Alternatives rejected: *query-param token* — **`tailscale serve` strips query
parameters from WebSocket upgrade requests**
([tailscale#18651](https://github.com/tailscale/tailscale/issues/18651)), so it
is broken on the exact transport we need; *broadening the existing `ao_conn`
cookie* — it is deliberately path-scoped to `/preview/files/` and must stay that
way.

### Consequences (accept these, do not relitigate)

- The LAN listener gains an unauthenticated surface: exactly one self-contained
  login page. Everything else stays behind auth.
- Cookie auth is ambient, so **CSRF and CSWSH become live risks that did not
  exist before**. Mitigations in §5 are mandatory, not optional.
- Binding the LAN listener to `127.0.0.1` (see §5.4) means the plaintext hop is
  loopback-only and TLS terminates at `tailscaled`. This **retires ADR-0001's
  accepted "plaintext on the LAN" limitation** for this deployment, and with it
  the concern that the connection password is stored in plaintext in
  `~/.ao/mobile/config.json` for a home-LAN threat model.
- The agent **workspace preview** panel (a session's own dev server) is served on
  isolated `<base32>.localhost` origins (`backend/internal/preview/entry.go:201`).
  A remote browser cannot resolve those. Preview is a known remote limitation.

---

## 4. Verified environment facts

Measured in this container on 2026-08-22:

- Go toolchain resolves `go1.26.7` automatically; `cd backend && go build ./...` **passes**.
- Node `v22.23.2` — exactly the version `frontend/scripts/build-acp-runtime.mjs` pins.
- `claude` and `codex` CLIs on PATH. `opencode`, `gemini` absent.
- Tailscale up. This node is **`vibebox`**, MagicDNS name **`vibebox.goose-marlin.ts.net`**.
- **`tailscale serve` on `:443` is already taken** — it proxies `/` to
  `http://127.0.0.1:8000` ("Harness Asset Manager"). AO's `Serve.Apply` hardcodes
  `--https=443` and **would clobber it**.
- No `~/.ao`, no `node_modules`. Clean slate.
- ACP chat runtime (needed by the orchestrator) is locatable via
  `AO_ACP_RUNTIME_DIR` or `AO_CLAUDE_ACP_COMMAND`
  (`backend/internal/adapters/chatdriver/claudeacp/driver.go:160-192`) — no code
  change needed for a headless install.

**WebSocket auth, measured.** A probe server using AO's exact
`websocket.Accept(..., &websocket.AcceptOptions{InsecureSkipVerify: true})`
options confirmed on loopback:

- Upgrade succeeds with a **cross-origin `Origin` header** → the CSWSH hole in
  §5.2 is real, not theoretical.
- `Cookie` arrives intact on the upgrade request.
- `Sec-WebSocket-Protocol` negotiation works end-to-end (`ao.bearer.<token>`
  echoed back as the selected subprotocol).

**Measured through `tailscale serve` on `:8443` → `127.0.0.1:9099`**, for both a
plain HTTP request and a real WebSocket upgrade. Everything the design needs
survives the proxy:

| Header the backend receives | HTTP | WS upgrade |
| --- | --- | --- |
| `Cookie` | intact | intact |
| `Origin` (`https://vibebox.goose-marlin.ts.net:8443`) | intact | intact |
| `Host` (equals `Origin` host → §5.1 CSRF check works) | intact | intact |
| `X-Forwarded-Proto: https` (→ `Secure` cookie detection works) | yes | yes |
| `X-Forwarded-For` (real tailnet IP → per-device lockout works) | yes | yes |
| `Sec-WebSocket-Protocol` negotiation | n/a | works |
| **`Tailscale-User-Login`, `Tailscale-User-Name`** | injected | **injected** |

Two consequences. First, **cookie auth for `/mux` is confirmed working** — §5.3's
subprotocol path is a real fallback, not the expected route (still build it;
it is ~15 lines and it is the escape hatch if the proxy is ever removed).
Second, `tailscale serve` injects **verified tailnet identity** on every request
including the WebSocket upgrade, which enables password-free login — see §5.7.

---

## 5. Mandatory security requirements

These are requirements, not suggestions. Each must have a test.

**5.1 CSRF.** Cookie-authenticated requests with a method other than `GET`/`HEAD`
must be rejected unless `Sec-Fetch-Site: same-origin` **or** the `Origin` host
equals the request `Host`. Cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`,
and `Secure` when the request arrived over TLS or carries
`X-Forwarded-Proto: https`. Bearer-authenticated requests are unaffected.

**5.2 CSWSH — same commit as the cookie, no exceptions.**
`terminal_mux.go:38` sets `InsecureSkipVerify: true`, justified by a comment
reading "the daemon binds loopback only". **Once a cookie exists on a network
listener that justification is void**, and any page in a logged-in user's browser
could open a terminal. The `/mux` upgrade must enforce a same-origin check when
the request authenticated **via cookie**, while preserving skip-verify for
**Bearer** (native clients legitimately send arbitrary `Origin`). Thread the auth
kind through the request context.

**5.3 Build the subprotocol fallback regardless.** Accept
`Sec-WebSocket-Protocol: ao.bearer.<token>` on `/mux` and echo the selected
subprotocol. It is ~15 lines, it is the standard technique, and it is the only
escape hatch if cookies do not survive the proxy. Do not use a query parameter —
`tailscale serve` strips them.

**5.4 Narrow the bind, and make the port strict.** `LANManager.Start` hardcodes
`0.0.0.0:%d` (`lan_listener.go:137,144`). In a container, `0.0.0.0` is reachable
from the container network. Add an optional bind host — config field plus
`AO_CONNECT_BIND_HOST` — **defaulting to `0.0.0.0` so upstream behavior is
unchanged**. This deployment sets `127.0.0.1`, making `tailscale serve` the only
path in.

Same change adds a **strict-port** option. `Start` currently falls back to
`net.Listen("tcp", "0.0.0.0:0")` — an **ephemeral port** — when the configured
port is taken (`lan_listener.go:144`). That fallback is safe for the desktop
because `mobile_restore.go` re-applies `tailscale serve` against *whatever port
was actually bound*, and `Serve.Target()` exists to detect "a stale config left
by a crash". This deployment turns `securePairing` off (§ W5), so that
reconciliation does not run — which makes the ephemeral fallback a silent
failure: the daemon restarts, 3011 is briefly held, the listener lands somewhere
else, and the tailnet URL 502s while `tailscale serve status` still looks
correct. Add `AO_CONNECT_STRICT_PORT` (default off, preserving upstream
behavior); this deployment sets it on so a port conflict fails loudly at
startup instead of drifting.

**What the loopback bind does to the phone app.** Narrowing the bind removes the
Expo client's *direct* `host:3011` path — it can no longer reach the daemon over
the LAN. It is **not** locked out: `packages/mobile/lib/config.ts:95-102` builds
its HTTP and `wss://` URLs from an arbitrary `host` + `httpPort` + `secure` flag,
and `ManualConnectSheet.tsx` lets a user type them. So the phone connects to
`vibebox.goose-marlin.ts.net` : `8443` with `secure: true`, through the same
`tailscale serve` proxy as the browser, still authenticating with its Bearer
password (§5.7 precedence #1, which identity auth does not displace). That is a
strict upgrade — the phone gets TLS instead of ADR-0001's plaintext LAN hop.

The casualty is **QR pairing**: the QR encodes the host and port the daemon
believes it is reachable on, which under a loopback bind is unreachable from
anywhere else. Phone setup becomes manual-connect only. Accepted; recorded in §9.

**5.4b The lockout key must not be spoofable — the login route depends on it.**
`middleware.RealIP` runs outermost (`router.go:52`) on both listeners and
**rewrites `RemoteAddr` from the client-supplied `X-Forwarded-For` header**.
`sourceKey()` (`auth.go:74`) reads `RemoteAddr`. Today that is harmless: Bearer
auth has no cheap brute-force target. The new `POST /api/v1/web/session` route
is exactly such a target, and an attacker who can reach the socket could rotate
`X-Forwarded-For` per request and **never trip the 5-attempt lockout**.

Through `tailscale serve` the XFF value is set by `tailscaled` and is genuine
(measured, §4) — which is what makes per-device lockout meaningful. So: trust XFF
for the lockout key **only** when the request arrived via the trusted proxy path;
otherwise key off the real transport peer address. Do not simply delete `RealIP`
— other consumers rely on it.

**5.5 Session store.** Cookie value is a 32-byte random opaque id, never the
password. Store **hashes** in `~/.ao/web/sessions.json`, mode `0600`, atomic
write (match `mobilebridge/config.go`). Sliding 30-day expiry, 90-day absolute.
Password regeneration or disabling the bridge revokes **all** sessions.
Persisting across daemon restarts is a requirement — logging every device out on
every restart is not durable.

**5.6 Never commit** the connection password, tailnet identity, session store,
or anything under `~/.ao`.

**5.7 Tailnet identity as a third credential (measured, opt-in).**
`tailscale serve` injects `Tailscale-User-Login` on every proxied request — HTTP
**and** the WebSocket upgrade (§4). When trusted, this authenticates all three
browser transports with no password, no login page, and no credential stored on
the device. Revocation becomes a Tailscale ACL or device removal rather than a
password rotation. For a private operator console this is both better UX and a
stronger credential than a shared 8-character password.

It is trustworthy only because a header is spoofable by anyone who can reach the
socket directly. Therefore:

- **Hard invariant, enforced in code:** identity trust may be enabled **only**
  when the LAN listener's bind host is a loopback address (§5.4). Refuse to start
  with identity trust on and a non-loopback bind — do not warn, refuse. With a
  loopback bind, the only non-local reachable path is `tailscaled` itself, and a
  local process could already reach the unauthenticated loopback daemon on 3001,
  so it gains nothing by spoofing.
- Off by default. `AO_CONNECT_TRUST_TAILSCALE_IDENTITY=1` plus an explicit
  allowlist of logins (`AO_CONNECT_ALLOWED_LOGINS`). An empty allowlist denies
  everyone; never treat "any tailnet user" as the default.
- Log the authenticated login on session start so access is auditable.

**Auth precedence** — one decision point, three accepted credentials:
1. `Authorization: Bearer <password>` — native/Expo clients, behavior unchanged.
2. Web session cookie (§5.5) — browsers, after password login.
3. Trusted tailnet identity (this section) — browsers, when enabled; bypasses the
   login page entirely.

Build **both** 2 and 3. Identity is the path this deployment uses; the cookie is
the universal fallback for any deployment not behind `tailscale serve`, and it is
what the login page exists for.

**Identity auth is ambient and has no `SameSite` protection.** A cookie at least
gets `SameSite=Strict`; an injected header is attached by `tailscaled` to *any*
request the browser makes to that origin, including one initiated by a hostile
page. So §5.1 (CSRF) and §5.2 (CSWSH on `/mux`) apply to identity-authenticated
requests **in full and without exception** — under identity auth they are the
only thing standing between a hostile tab and a live terminal. Test them against
identity auth specifically, not just against cookies.

---

## 6. Workstreams

Ownership is by **file**, so parallel agents do not collide. Do not edit files
another workstream owns; if you must, say so in the PR and coordinate.

### W0 — Freeze the bridge contract (BLOCKING; land first, alone)

> ✅ **MERGED `ecc655d3f`.** Electron-absence is detected at runtime via
> `window.ao === undefined` rather than by reading `VITE_NO_ELECTRON`, so that
> flag is now vestigial (`dev:web` still sets it; nothing reads it). Build
> output is git-ignored, not committed.

Everything else depends on this type existing. Keep it small and merge it fast.

**Owns:** `frontend/src/preload.ts` (type + literal only),
`frontend/src/renderer/lib/bridge.ts`, `frontend/src/renderer/lib/preview-mode.ts`,
`frontend/src/renderer/hooks/{useShellTerminals,useMigrationOffer,useSessionScmSummary,useSystemRequirementsGate,useWorkspaceQuery}.ts`,
`frontend/package.json`, `frontend/vite.renderer.config.ts`.

> **Correction (2026-08-22, verified): the mock-data blast radius is 11 files,
> not 6.** The list above is incomplete, and the missing files are ones §6 hands
> to *other* workstreams — so leaving it uncorrected produces a three-way
> collision. The full consumer set of
> `usesPreviewWorkspaceData` / `import.meta.env.VITE_NO_ELECTRON` in
> `frontend/src` is:
>
> ```
> lib/preview-mode.ts            hooks/useWorkspaceQuery.ts
> hooks/useShellTerminals.ts     hooks/useMigrationOffer.ts
> hooks/useSessionScmSummary.ts  hooks/useSystemRequirementsGate.ts
> hooks/useAgentSwitches.ts      lib/session-reviews.ts
> components/SessionsBoard.tsx   components/SessionInspector.tsx (+ .test.tsx)
> routes/_shell.tsx              (5 separate uses)
> ```
>
> **W0 owns all of them.** Because W0 lands alone and first, widening its
> ownership costs nothing; the alternative is W2 (`SessionInspector`,
> `SessionsBoard`) and W4 (`routes/_shell.tsx`) each half-migrating the same flag.
> Re-run the grep before starting — anything else it finds, W0 owns too.

1. Add to `AoBridge` a frozen capability record:

   ```ts
   export type AoCapabilities = {
     terminals: boolean;          // live PTY over /mux
     nativeBrowserPanel: boolean; // Electron WebContentsView inspector panel
     windowChrome: boolean;       // custom titlebar / native menus
     daemonControl: boolean;      // start/stop/restart the daemon process
     nativeFileDialogs: boolean;  // OS folder picker
     osNotifications: boolean;    // dock bounce / OS notifications
     filePathDrop: boolean;       // drag-drop yields absolute host paths
   };
   ```

   Electron preload: all `true`. Web bridge: `terminals: true`, everything else
   `false`.

2. Replace the `window.ao ?? {…stub}` expression with an explicit
   `createWebBridge()` selected when `window.ao` is undefined. Same shape, but a
   named implementation the web workstreams can extend.

3. **Split the overloaded flag.** Introduce `VITE_AO_PREVIEW_DATA` and move all
   six mock-data gates onto it. `VITE_NO_ELECTRON` keeps its one honest meaning:
   "no preload".
   **`dev:web` must set BOTH** (`VITE_NO_ELECTRON=1 VITE_AO_PREVIEW_DATA=1`) so
   `frontend/e2e/support/fake-bridge.ts` and the `window.__aoFakeAgent` seam in
   `useWorkspaceQuery` keep working unchanged. `npm run test:e2e:renderer` must
   pass before and after this workstream — that is the acceptance test.

4. Add scripts:
   - `dev:web:live` — `VITE_NO_ELECTRON=1 vite …` (no preview flag), proxying to a
     real daemon via the existing `AO_DEV_API_TARGET`.
   - `build:web` — production browser build into
     `backend/internal/httpd/webui/dist`, with `VITE_AO_WEB=1`.

5. In web mode, call `setApiBaseUrl(window.location.origin)` at boot.
   `muxUrlFromApiBase` already derives `wss://<host>/mux` correctly for
   same-origin — verify, do not rewrite it.

**Done when:** `npm run typecheck`, `npm run test`, `npm run test:e2e:renderer`
all pass, and `dev:web` behaves exactly as before.

---

### W1 — Backend: web session auth + static serving (Go)

> ✅ **MERGED `a9137eed0`.** All 11 mandatory tests exist and are real (verified
> by reading them, not by trusting green). Routes were threaded through
> `server.go` — **`NewWithDeps` gained a `ControlDeps.WebSession`** — because the
> SPA must also be served on the **loopback** listener for G3; a LAN-listener-only
> wrapper would have silently dropped that gate. Confirmed live: a daemon built
> from this branch serves the embedded SPA at `/` on loopback and answers
> `/api/v1/web/session`.

**Owns:** new `backend/internal/httpd/webui/`, new `backend/internal/websession/`,
`backend/internal/httpd/{auth.go,terminal_mux.go,router.go,lan_listener.go}`,
`backend/internal/mobilebridge/config.go`,
`backend/internal/httpd/controllers/dto.go`,
`backend/internal/httpd/apispec/specgen/build.go`,
new `backend/internal/cli/connect.go`.

1. **Session endpoints** (new, on the shared router, **not** under a
   LAN-blocked prefix):
   - `POST /api/v1/web/session` `{password}` → `204` + `Set-Cookie`. Verify with
     `mobilebridge.PasswordMatches`. Subject to the existing per-source lockout.
   - `DELETE /api/v1/web/session` → revoke this session.
   - `GET /api/v1/web/session` → `{authenticated: bool}`.

2. **`authMiddleware`**: accept the web cookie in addition to Bearer. Preserve
   the `ao_conn` preview cookie path-scoping exactly as-is. Apply §5.1.

   **Unauthenticated navigations must redirect, not return JSON.** Auth failures
   currently go through `envelope.WriteAPIError(… StatusUnauthorized …)`, so a
   person opening the tailnet URL with no cookie would be shown a raw JSON
   envelope. When the request is a document navigation
   (`Sec-Fetch-Mode: navigate`, or `Accept` contains `text/html`), answer
   `302 → /login`. Keep the JSON 401 for everything else.

   Second half of the same item, on the client: an expired session mid-use
   returns 401 to `api-client.ts`, which routes through `daemonFailureMessage`
   and would read to the user as *"the daemon is down."* The web bridge must
   treat 401 as **re-login required** and send the user to `/login`, never as
   daemon failure.

3. **Tailnet identity auth** per §5.7: accept `Tailscale-User-Login` against the
   configured allowlist, gated on the enable flag **and** the code-enforced
   loopback-bind invariant (refuse to start otherwise). When identity
   authenticates a request, skip the login page entirely. Log the login.

4. **`/mux`**: apply §5.2 and §5.3.

5. **Static handler** `internal/httpd/webui`: `//go:embed all:dist`, serving the
   SPA with history fallback to `index.html`. Must never shadow `/api`, `/mux`,
   `/healthz`, `/readyz`, `/shutdown`, `/internal/`. Commit a placeholder
   `dist/index.html` so `go build ./...` works without a frontend build. Serve one
   self-contained `/login` page (inline CSS/JS, zero external assets)
   unauthenticated; **every other asset requires auth on the LAN listener**. On
   the loopback listener nothing requires auth — that matches the existing trust
   model.

6. **Bind host + strict port** per §5.4.

7. **CLI `ao connect`** — `enable`, `disable`, `status`, `password --regenerate`.
   Thin client over the loopback `/api/v1/mobile/*` routes, per the CLI rules in
   AGENTS.md. This exists because those routes are loopback-only by design and
   this container has no Electron settings UI to drive them. `status` prints the
   reachable URL.

**Contract discipline:** any DTO change goes through `controllers/dto.go` +
`apispec/specgen/build.go` then `npm run api`; commit `openapi.yaml` and
`frontend/src/api/schema.ts` with the Go change. **W1 and W6 both touch those two
files — W6 must not start until W1 has merged.**

**Done when:** `go build ./...`, `go test ./...`, `go test -race ./...`,
`go vet ./...`, `npm run lint` pass, with tests covering: cookie login/logout,
lockout on the login route **that a rotating `X-Forwarded-For` cannot evade**
(§5.4b), CSRF rejection **under both cookie and identity auth**, cookie/identity-vs-Bearer origin behavior on `/mux`, subprotocol
negotiation, session persistence across restart, revocation on password
regeneration, identity auth refused for a login outside the allowlist, the
daemon **refusing to start** with identity trust on and a non-loopback bind
(§5.7), an unauthenticated document navigation redirecting to `/login` while an
API call still gets JSON 401, and `lanControlBlock` still 404ing every blocked
prefix.

---

### W2 — Frontend: capability refactor

> ✅ **MERGED `f4eb632a9`.** Also owns the daemon-status UI (see the ownership
> fixes above). **Key correction, do not undo it:** `TerminalPane` branches on
> **preview-data mode BEFORE capability**, and the preview branch is narrowed to
> non-chat worker targets. The e2e fake bridge sets `terminals: true`, so gating
> the fake transcript on capability alone opens a real `/mux` socket with no
> daemon behind it; and gating it on preview-mode alone swallows the chat
> surface. Both were caught only by the full e2e suite.

**Owns:** `frontend/src/renderer/components/{BrowserPanel,TerminalPane,WindowTitlebar,SessionView,InstallDependencyDialog}.tsx`,
`frontend/src/renderer/hooks/useBrowserView.ts`, `frontend/src/renderer/main.tsx`.

Replace every direct `window.ao` truthiness test with the matching capability.

- **`TerminalPane.tsx:669` is the important one.** Delete the `!window.ao`
  early-return and gate on `capabilities.terminals`. In the browser this must
  render a **real live terminal** over `wss://<host>/mux`.
- `BrowserPanel` / `useBrowserView`: gate on `nativeBrowserPanel`. In web, do not
  render the panel; show one honest line explaining it is desktop-only. (It is
  blocked twice over — Electron compositing *and* `/api/v1/browser` being on
  `lanControlBlockedPrefixes`.)
- `WindowTitlebar`: gate on `windowChrome`; the browser supplies its own.
- `main.tsx` dock bounce: gate on `osNotifications`.
- `SessionView.tsx:302`: that `window.ao &&` is gating a PR-related affordance —
  determine which capability it actually means and use it; do not blanket-disable.
- Daemon startup UI: with `daemonControl: false`, the web client must not offer
  start/stop/restart. Report readiness from `/healthz` and, when the daemon is
  down, say so plainly instead of showing a dead button.

**Done when:** typecheck + unit tests pass, and a browser against a live daemon
shows a streaming terminal with no Electron present.

---

### W3 — Project creation without native dialogs

> ✅ **MERGED `a1a54aef1`.** Took two correction rounds. Its first attempt reported done with a green
> suite while having dropped most of its scope (no tests, no typed-path field,
> `projectRepositoryPreflight` and `scanImportFolder` still unconditional).
> Merging it will conflict with W2 in `frontend/e2e/support/fake-bridge.ts` —
> both added the same `capabilities` record; keep one copy.

**Owns:** `frontend/src/renderer/components/{CreateProjectFlow,CloneRepositoryDialog}.tsx`.

Today the only ways in are `aoBridge.app.chooseDirectory` (an Electron dialog)
and drag-dropped paths. There is **no text input**, so in a browser a human
currently cannot add a project at all. This is on the critical path to "usable".

Deliberately kept off the risky filesystem-enumeration API (that is W6):

- Add a **typed absolute-path** field, shown when `nativeFileDialogs` is false.
  Validate server-side via the existing `POST /api/v1/projects` error envelope —
  surface the daemon's message and request id, do not invent client-side checks.
- Make **clone-from-URL** the primary path in web mode
  (`POST /api/v1/projects/clone`). For a container-hosted install this is the
  common case: the user has no local repos to pick.
- `projectRepositoryPreflight` calls `aoBridge.app.scanImportFolder`, which is
  Electron-main-only. When `nativeFileDialogs` is false, skip preflight and rely
  on the daemon's own validation. Do not fabricate a fake scan result.

**Done when:** a human on another device can add a project by pasting a git URL,
and by typing a path, with clear errors on both.

---

### W4 — Orchestrator as a core surface

> ✅ **MERGED `0a608a75a`.** Adds `routes/_shell.projects.$projectId_.orchestrator.tsx`,
> `lib/orchestrator-state.ts` (ported from `packages/mobile`, with tests), and a
> permanent sidebar entry. It also adds **one new `@ORC` test** to the shared
> `frontend/e2e/smoke-t0.spec.ts`; it reports no existing assertion was changed —
> confirm that when you review the diff.

**Owns:** `frontend/src/renderer/routes/*`, `frontend/src/renderer/components/{ShellSidebar,ShellTopbar}.tsx`,
new `frontend/src/renderer/lib/orchestrator-state.ts`,
`frontend/src/renderer/lib/{spawn-orchestrator,restart-orchestrator}.ts`.

The orchestrator is AO's planning-and-delegation agent: it holds project-scoped
planning history, and it spawns and redirects workers
(`backend/internal/service/session/delegation.go`, `/api/v1/orchestrators`,
`/api/v1/orchestrators/delegate`). Today the renderer reaches it through
scattered entry points (board CTA, topbar, sidebar, post-add auto-spawn). In the
web UI it must be a **destination**, not a shortcut.

- Add a stable per-project route (`…/projects/$projectId/orchestrator`) that is
  always present, whether or not an orchestrator is running.
- Sidebar shows a permanent per-project Orchestrator entry with live state:
  `missing` / `stopped` / `running` plus activity.
- **Reuse the semantics the Expo client already got right.** Port the pure logic
  in `packages/mobile/lib/orchestratorView.ts` into
  `renderer/lib/orchestrator-state.ts` with tests. Do **not** import from the
  Expo package. Two rules it documents and this must preserve:
  - `SpawnOrchestrator{clean:false}` is an idempotent **ensure** — on a running
    orchestrator it does nothing. Using it as "Restart" is a bug that shipped once.
  - `clean:true` is destructive (retires every live orchestrator for the project)
    and **must** confirm first.
- Surface delegation both ways: the orchestrator view lists the workers it
  spawned; a delegated worker shows its origin.
- Rendering needs no new component — an orchestrator is a session with a flag
  (`types/workspace.ts:177`), already rendered by `SessionView`/`CenterPane` in
  chat mode.
- Handle the no-chat-driver case honestly: `hasConfiguredOrchestratorAgent` plus
  the preflight codes already enumerated in `lib/spawn-orchestrator.ts`
  (`SESSION_MODE_UNSUPPORTED`, `CHAT_DRIVER_UNAVAILABLE`, `CHAT_DRIVER_INCOMPATIBLE`,
  `CHAT_AUTH_REQUIRED`) → explain and link to settings, never a dead button.

**Done when:** from a remote browser a human can start the orchestrator, hold a
planning conversation, have it delegate a task, and click through to the worker
it created.

---

### W5 — Deployment and documentation (fork-local; never upstreamed)

> ✅ **MERGED `a3d1ace0c`.** Ships `deploy/ao-daemon.service` (+ `.env.example`
> with the allowlist commented out, so the default stays deny-everyone),
> `docs/adr/0003-web-ui-on-the-lan-listener.md`, `docs/tailscale-runbook.md`,
> `docs/operations-runbook.md`, `docs/limitations.md`. The unit's
> `ExecStartPost` re-applies the serve target from the port `ao connect status`
> reports, covering the reconciliation gap left by `securePairing` being off.

**Owns:** new `deploy/`, `docs/adr/0003-web-ui-on-the-lan-listener.md`, this file.

- Supervisor unit for `ao daemon` with a restart policy, plus an env file:
  `AO_ACP_RUNTIME_DIR` (or `AO_CLAUDE_ACP_COMMAND`), `AO_CONNECT_BIND_HOST=127.0.0.1`.
- **Tailscale runbook.** `securePairing` stays **OFF** — AO's `Serve.Apply`
  hardcodes `--https=443` and would clobber the user's existing Harness Asset
  Manager on `:443`. `RestoreOnBoot` therefore never re-applies serve. Manage it
  externally and idempotently:

  ```bash
  tailscale serve --bg --https=8443 http://127.0.0.1:3011
  # → https://vibebox.goose-marlin.ts.net:8443
  ```

  Verify `tailscale serve status` still shows `/ → http://127.0.0.1:8000` on :443.

  Because `securePairing` is off, AO's own serve reconciliation
  (`mobile_restore.go` → `Serve.Target()`) never runs. Cover that gap: set
  `AO_CONNECT_STRICT_PORT` (§5.4) so the listener can never silently drift to an
  ephemeral port, **and** have the supervisor re-apply the serve target from the
  port `ao connect status` actually reports. Belt and braces — this is the one
  failure mode that looks healthy from `tailscale serve status` while the URL
  502s.
- Write ADR-0003 from §3 verbatim, and note that AGENTS.md's LAN-listener rule
  should be amended to cover serving the web UI (same amendment pattern ADR-0001
  used for the loopback rule).
  ✅ ADR-0003 landed with W5. **The AGENTS.md amendment was missed and was
  applied separately on 2026-08-23** — W5 wrote the ADR but left the hard rule
  in AGENTS.md describing only the Bearer/`0.0.0.0` mobile listener, which
  actively misleads any agent reading the hard rules. It now covers the web UI,
  the cookie and identity credentials, the configurable bind host, and the three
  load-bearing invariants (CSRF, `/mux` origin by auth kind, loopback-only
  identity trust).
- Runbook: start, stop, restart, rotate password, revoke sessions, recover from a
  crashed daemon, recover from a stale serve config.
- Limitations page: no workspace preview remotely, no native browser panel, no
  OS file dialogs, no daemon start/stop from the browser.

**Upstream split.** W1/W2/W3/W4 are upstream candidates as independent PRs.
W5 is this container's deployment and stays in the fork. Keep them in separate
commits from the first commit — do not untangle later.

---

### W6 — Remote directory picker (second wave; starts only after W1 merges)

Deliberately deferred: a network filesystem-enumeration API is the most
security-sensitive new surface in this plan, and W3 already unblocks humans
without it.

- `GET /api/v1/fs/list` and `POST /api/v1/fs/inspect`, **jailed to configured
  roots**, path-traversal tested, and considered for the LAN control-block list.
- Port `frontend/src/main/import-folder-scan.ts` (264 lines) to Go so
  `scanImportFolder` / `checkAncestorRepo` stop being Electron-main-only.
- A `DirectoryPickerDialog` filling the `chooseDirectory` bridge slot.

---

## 7. Verification gates

Each gate is a hard stop. A green build is **not** a gate — every gate below is
observed behavior. Record results in this file as you pass them.

- **G0 Toolchain.** ✅ **PASSED 2026-08-22.** From a clean checkout: `npm install`
  at the repo root **and** in `frontend/` (this repo is **not** an npm workspace —
  the root scripts shell out with `npm --prefix`), then
  `cd backend && go build ./... && go test ./...`, `npm run lint`,
  `npm run frontend:typecheck`.

  **Four environment prerequisites the first draft missed — a clean checkout does
  NOT pass G0 without them:**

  1. **`npm --prefix packages/product-ui install` is required for typecheck.**
     §11.6 is right that product-ui never needs *building* (vite source-aliases
     it), but `tsc` resolves `packages/product-ui/src/utils.ts` imports from
     product-ui's own `node_modules`, so without that install
     `frontend:typecheck` fails with `TS2307: Cannot find module 'clsx' /
     'tailwind-merge'`. Three installs total: root, `frontend/`, `packages/product-ui/`.
  2. **A tmux server must be running for `go test ./...` / `npm run lint`.**
     Without one, `internal/adapters/runtime/tmux` and `internal/observe/activity`
     fail with `no server running on /tmp/tmux-1000/default`. Fix:
     `tmux new-session -d -s g0probe`. Both packages then pass. (herdr does not
     provide this server.) `npm run lint` is `go test ./... && golangci-lint run`,
     so it inherits the same requirement.
  3. **`npx playwright install chromium` is required for `test:e2e:renderer`.**
     Otherwise all 25 specs fail with `Executable doesn't exist at
     …/chromium_headless_shell-1223/…`. After installing: **25 passed**.
  4. **`npm --prefix frontend run test` has 10 pre-existing failing test files,
     all in `src/landing/`** (unmet `cheerio` and `@ao/shared/constants` imports).
     They are unrelated to the renderer and are **not** a regression — do not send
     an agent to fix them. Use the renderer-scoped command as the real gate:
     `cd frontend && npx vitest run --config vite.renderer.config.ts src/renderer src/main src/api`
     → **156 files / 2272 passed, 1 skipped**.

  **Measured baseline (use these numbers to judge a delegate's diff):**
  `go build ./...` exit 0 · `go test ./...` all pass (with tmux) ·
  `go vet ./...` exit 0 · `npm run lint` **0 issues** ·
  `npm run frontend:typecheck` exit 0 · renderer vitest **2272 passed** ·
  `npm run test:e2e:renderer` **25 passed**.

  **⚠️ The `go test ./...` baseline no longer reproduces on this box, and this
  project caused it (found 2026-08-23 during G8).**
  `internal/adapters/agent/fake:TestFullLifecycleSpawnToTermination` now fails
  with `read hook log: … events.log: no such file or directory`. The chain:
  `fake.go:106` launches the timeline as **`sh -lc`**; the `-l` makes the login
  shell run the profile, which prepends `/home/dev/bin` **ahead of** the stub
  directory the test puts on `PATH`; and `~/bin/ao` now exists because §11.1a
  put the built daemon there on 2026-08-23. So the script calls the **real**
  `ao hooks fake …` instead of the test's shim, `$AO_HOOK_LOG` is never
  written, and the read fails.

  - **Not a regression from this work** — `backend/internal/adapters/` is
    byte-identical to `main` (`git diff --quiet main...HEAD -- backend/internal/adapters/`).
  - **Not reproducible on upstream CI**, which has no `~/bin/ao`.
  - It passed at G0 only because `~/bin/ao` did not exist yet.
  - Verify with `sh -lc 'command -v ao'` → `/home/dev/bin/ao`.
  - **Do not "fix" it by touching the test.** If it is worth fixing at all, the
    honest fix is `sh -lc` → `sh -c` in `fake.go:106` (a login shell has no
    business resetting the PATH the caller built) — an upstream robustness
    change, deliberately out of scope here and not yet made.

  **Toolchain drift:** the installed Go is **`go1.25.7`**, not the `go1.26.7`
  §4 claims; `go build ./...` passes on it in ~2s and no toolchain download
  occurs. Ignore §11.6's "first build is slow" warning.
  **`packages/product-ui` does not need building.** `vite.renderer.config.ts:105`
  aliases `@aoagents/product-ui` straight to `packages/product-ui/src/index.ts`,
  and aliases its `clsx` / `tailwind-merge` to the frontend's copies. A frontend
  install is sufficient for `build:web`. (Verified — do not lose an hour to the
  "failed to resolve clsx" symptom the config comment warns about; that is a
  missing `npm install`, not a missing product-ui build.)
- **G0b Verification integrity under parallel agents.** ⚠️ **Learned the hard way
  2026-08-22 — read this before running any gate with delegates active.**
  This box has **4 cores**. With four coding agents working, load average was
  measured at **30–70**, and under that contention `vitest` and Playwright fail
  with **timeouts that are pure artifacts, not bugs**. A full renderer run
  reported 7 failures across `Sidebar.test.tsx` and `GlobalSettingsForm.test.tsx`;
  re-run alone, those same files passed **61/61** and **28/28**.

  The danger is not the wasted run — it is that an agent handed a phantom failure
  will "fix" working code, or loosen a timeout, to make it go away.

  Rules:
  - The **full renderer vitest** and **`test:e2e:renderer`** are **orchestrator-only
    and serialized**. Never put them in a delegate's DoD. Four concurrent chromium
    suites is the worst offender.
  - A delegate's DoD gets `frontend:typecheck` plus **vitest scoped to the test
    files it touched** — enough to prove it did not break its own work.
  - **Any timeout failure must be re-run as a single file in isolation before it
    is believed.** Passing alone means contention, not a bug.
  - Same applies to Go: `go test -race ./...` and the tmux integration tests are
    timing-sensitive. Verify W1's Go suite with the box quiet.
  - **Exception — a delegate that ADDS an e2e spec must be allowed to run that one
    spec** (`npx playwright test <file> --grep '<tag>' --workers=1`). The blanket
    no-Playwright rule as first written made it impossible for a delegate to
    verify a test it was writing, and W4 duly shipped an `@ORC` spec whose
    fixture seeded `fake-proj` while the assertion expected `ao-demo`. One spec,
    one worker, and only for a spec the delegate itself added.
  - **A wholesale e2e failure is infrastructure, not code.** All 25 failing
    identically means the dev server never came up — check for a stale `vite`
    process (`ps aux | grep vite`) and for a warm-cache/startup timeout, since the
    shared symlinked `node_modules` means every worktree shares one `.vite` cache
    and re-optimizes when another worktree's config differs.

- **G1 Daemon.** ✅ **PASSED 2026-08-22.** `ao daemon` runs; `/healthz` and
  `/readyz` answer on loopback; it survives a kill-and-restart with state intact.
  Built with `go build -o <path>/ao ./cmd/ao` (the CLI entrypoint is
  `backend/cmd/ao`). Observed: `daemon listening addr=127.0.0.1:3001`, both
  probes `200`, and after `kill` + restart both probes `200` again with
  `~/.ao/data/ao.db` and `worktrees/` intact. `~/.ao` is created correctly (
  `data/`, `running.json`, `supervise.sock`, `browser.sock`) — no OS-default
  app-data path is touched, satisfying the CLAUDE.md hard rule.
  Two benign startup warnings, unrelated to this goal: the GitHub and GitLab
  trackers disable themselves with "no token configured".
- **G2 One real agent.** ✅ **PASSED 2026-08-23.** A worker spawned by AO in this
  container completes a small real task on a scratch repo. Not mocked.

  Setup notes (a bare scratch repo is NOT enough): `go build -o ~/bin/ao ./cmd/ao`,
  start `~/bin/ao daemon`, start a tmux server (`tmux new-session -d -s g0probe`),
  and give the scratch repo an initial commit **plus an `origin` remote** (a local
  bare repo works, with `git remote set-head origin master`). Spawn fails with
  `DEFAULT_BRANCH_UNRESOLVED` without a remote even when project config sets
  `defaultBranch: master` — the workspace resolves the configured branch to
  `refs/remotes/origin/master`. Project added via `POST /api/v1/projects
  {path,name}` (config PUT needs a `{"config":{...}}` wrapper); worker spawned via
  `POST /api/v1/sessions {projectId,kind:"worker",harness:"claude-code",mode:"tui",prompt}`.

  Observed: session `ao-g2-scratch-1` created worktree
  `~/.ao/data/worktrees/ao-g2-scratch/ao-g2-scratch-1` on branch
  `ao/ao-g2-scratch-1/root`, wrote correct `fizzbuzz.py` + `test_fizzbuzz.py`
  (output verified independently for 1..30), ran its test, and committed
  `451b723 "g2: add fizzbuzz with tests"` — unprompted, one pass, no manual
  nudges. Session stayed alive and un-terminated afterward.
- **G3 Web UI on loopback.** ✅ **PASSED 2026-08-22.** A browser at
  `http://127.0.0.1:3001` renders **live** data (not `mockWorkspaces`), and a
  terminal **streams live PTY output**.

  Reproduce: `cd frontend && npm run build:web`, then **rebuild the binary** so
  `go:embed` picks up the new `dist` (`go build -o <path>/ao ./cmd/ao`), restart
  the daemon, and drive a real browser at it (Playwright's chromium is already
  installed — `frontend/node_modules/playwright`).

  Observed, with **no Electron present**:
  - The SPA and its ~1.5 MB JS asset are served from the daemon on loopback.
  - The app mounts with **zero page errors and zero console errors**.
  - It issues **real** API calls — `/api/v1/projects`, `/sessions`, `/agents`,
    `/events`, and the `/api/v1/notifications/stream` SSE — and **none** of the
    `mock-data.ts` fingerprints (`ao-demo`, `reverbcode`, `demo-working`,
    `PASS 18 tests passed`) appear anywhere in the DOM.
  - W4's orchestrator surface renders live: a permanent sidebar entry reading
    `Orchestrator / Missing`, and the destination view offering `Spawn
    Orchestrator` rather than a dead button.
  - W2's daemon readiness renders as `daemon ready`, sourced from `/healthz`.
  - **The terminal is real.** The browser opened `ws://127.0.0.1:3001/mux`, sent
    `{"ch":"terminal","type":"open",...}`, and received `opened` followed by
    streaming `data` frames. One decodes to
    `\x1b[32m\x1b[Hdev@vibebox\x1b[39m:` — an ANSI-coloured shell prompt from a
    live PTY. This is the exact thing that was a **static fake terminal** before
    W2 (`TerminalPane.tsx`'s old `if (!window.ao)` early return).

  A standalone shell terminal is the cheapest way to exercise a real PTY without
  spawning an agent: `POST /api/v1/shell-terminals` returns a `handleId` the
  renderer will attach to.
- **G4 Tailnet.** ✅ **PASSED 2026-08-23** (see §7 for full detail). Bridge enabled, bound `127.0.0.1`, strict port on,
  `tailscale serve --https=8443` configured; from a **different tailnet device**:
  URL → board → live terminal → chat. With identity trust on (§5.7) there should
  be **no login prompt at all**. Then disable identity trust and confirm the
  password + cookie path still works end to end — both credentials must be
  exercised. Header forwarding through the proxy is already measured (§4), so
  what this gate proves is the *application* behavior, not the transport.

  ✅ **PASSED 2026-08-23.** Daemon env (steady state):
  `AO_CONNECT_BIND_HOST=127.0.0.1`, `AO_CONNECT_STRICT_PORT=1`,
  `AO_CONNECT_TRUST_TAILSCALE_IDENTITY=1`,
  `AO_CONNECT_ALLOWED_LOGINS=execsumo@github`,
  `AO_ALLOWED_ORIGINS=https://vibebox.goose-marlin.ts.net:8443`,
  `AO_CLAUDE_ACP_COMMAND=/home/dev/bin/claude-acp-wrapper` (ACP adapter
  installed at `~/acp-runtime`, wrapper uses system node). Operator confirmed
  from a second tailnet device, identity trust on: board renders, ticket opens,
  terminal streams, chat works — **no login prompt at any point**.

  **Two issues found and resolved during the gate:**

  1. **Blank white page — CORS.** `corsMiddleware` (`cfg.AllowedOrigins`,
     router.go) rejected the SPA's own tailnet `Origin` with `403
     ORIGIN_FORBIDDEN` on every `crossorigin` module-script fetch — top-level
     navigation carries no `Origin`, so only the empty shell loaded. Fix:
     `AO_ALLOWED_ORIGINS` with the exact served origin (added to
     `deploy/ao-daemon.env.example`). **Upstreamable follow-up:** let cors pass
     same-origin requests carrying an accepted ambient credential — must key on
     AuthKind, which on the LAN listener is set because auth wraps cors there;
     the unauthenticated loopback listener must stay strict or DNS-rebinding
     pages would pass an Origin==Host check. The §11.1c CSP worry did **not**
     materialize: `connect-src 'self'` covers the same-origin `wss://` terminal.
  2. **Chat driver.** Headless daemon has no packaged ACP runtime; resolved via
     `AO_CLAUDE_ACP_COMMAND` per §11.6, proven with chat-mode worker
     `ao-g2-scratch-2` replying "G4 CHAT OK" into its durable conversation.

  **Password-path validation** (identity trust temporarily disabled, then
  restored as steady state per operator preference). Operator logged in from
  the device through the login page. Verified through the proxy at API level:
  wrong password `401` ×4 then `429 LOCKED_OUT` on the 5th attempt, correct
  password refused while locked, login `204` + `HttpOnly SameSite=Strict`
  cookie, cookie-authed API returns live data, browser-style unauthenticated
  navigation `302 → /login`, logout (`DELETE /api/v1/web/session`) revokes the
  cookie afterward (`authenticated:false`, protected API `401`). **UI gap:** the
  SPA has no logout button — the DELETE route exists but no renderer code calls
  it (follow-up).

  **G7 early read:** the daemon restarted three times during this gate; both G2
  sessions restored un-terminated each time; `tailscale serve status` untouched.
- **G5 Orchestrator.** ✅ **PASSED 2026-08-23.** From the remote tailnet browser:
  operator started the project orchestrator, held a planning conversation,
  delegated a task to a spawned worker, opened that worker's live terminal from
  the board, and had the orchestrator delete/clean up the worker afterward.
  Full delegation lifecycle observed over identity auth.
- **G6 Isolation.** ✅ **PASSED 2026-08-23.** Two concurrent `claude-code` TUI
  workers (`ao-g2-scratch-6`/`-7`) spawned via API on one project, each given an
  exclusive-file task. Verified: separate worktrees under
  `~/.ao/data/worktrees/ao-g2-scratch/`, separate branches
  (`ao/ao-g2-scratch-{6,7}/root`), each branch exactly one commit on top of
  `master`, and zero cross-talk — A's worktree contains no `notes-b.md`, B's no
  `notes-a.md`. Both supervised live from the remote tailnet browser.

  **Product bug found by this gate (worked around, fix upstreamable):** spawning
  with an explicit `harness: claude-code` still merged the project worker role
  override's `agentConfig.model` — `gpt-5.6-luna`, configured for codex — into
  the Claude launch (`manager.go`: `effectiveHarness` correctly prefers the
  explicit harness, but `effectiveAgentConfig` applies the override model
  unconditionally). Claude Code launched with a Codex model id and sat broken.
  Workaround: cleared the worker role override via `PUT /projects/{id}/config`
  (orchestrator codex override kept — delegation works). Proper fix: only apply
  role-override agent config when the resolved harness matches the override's
  harness (or none was set). The first G6 pair (`-4`/`-5`) was killed because of
  this and respawned as `-6`/`-7`.

  **Observation (non-blocking):** finished TUI workers settle in derived status
  `idle`, not `waiting_input`, so no `needs_input` notification fires when a
  worker completes its turn. Per `domain/activity.go`, "an agent at an empty
  prompt awaiting its next INSTRUCTION" *is* `waiting_input`; whether the
  claude-code TUI adapter's end-of-turn hook should map there instead of idle
  is worth checking post-gates.
- **G7 Recovery.** ✅ **PASSED 2026-08-23.** Restarted the daemon while a web
  session was live: all 9 session records restored with correct terminated
  flags; the `ao_session` web cookie survived the restart and still
  authenticated (`GET /api/v1/web/session` → true; protected API returns live
  data), confirming §5.5's persisted session store. Terminal reconnect proven
  with a real headless chromium against `http://127.0.0.1:3001`: POST
  `/api/v1/shell-terminals` → `ws:///mux` open → `opened` frame → streaming PTY
  data frames (test script drives the same protocol as the renderer).
  `tailscale serve status` untouched throughout.

  ⚠️ Test-harness notes, not product issues: the shell-terminal response wraps
  the handle as `{"shellTerminal":{"handleId":…}}` (the renderer reads it via
  its typed client — raw API consumers should too); and mux data frames are
  base64, so match decoded content.

  **Bonus finding:** on restore, the codex chat orchestrator
  (`ao-g2-scratch-3`) failed to relaunch: `resume chat: thread/resume:
  app-server error -32600: no rollout found for thread id …`. Codex-native
  conversation identity was persisted but the rollout file is gone/never
  created in this headless deployment — chat-session restore needs a fallback
  (fresh thread with durable history replay) when provider resume fails.
  Follow-up.

  **G7b Port drift.** ✅ **PASSED 2026-08-23.** With an unrelated process bound
  to `127.0.0.1:3011` and `AO_CONNECT_STRICT_PORT=1`, daemon startup logged
  `bind LAN 127.0.0.1:3011: port already in use (strict mode)` (ERROR) and did
  **not** drift to an ephemeral port — the listener simply stayed down, loudly.
  Nuance worth knowing: strict mode fails the *listener*, not the whole daemon;
  loopback `3001` keeps serving while the tailnet URL 502s. That matches the
  §W5 belt-and-braces design (the supervisor unit's `ExecStartPost` re-applies
  serve only from a port `ao connect status` actually reports), but a monitor
  keyed on the daemon process alone would miss this state — check `ao connect
  status` or the error log.
- **G8 Security.** ✅ **PASSED 2026-08-23.** All 13 clauses mapped to tests whose
  **bodies were read, not just their names** — for each one, which hostile input
  it sends and which specific rejection it asserts. `go build`, `go vet`,
  `go test` and `go test -race` over `./internal/httpd/... ./internal/websession/...`
  all clean. Live checks against the running daemon on `127.0.0.1:3011` matched:
  unauthenticated `GET /` (`Accept: text/html`) → `302 /login`; `GET /api/v1/sessions`
  → JSON `401`; `GET /login` → `200`; every `lanControlBlockedPrefixes` entry →
  `404` **even with a valid Bearer credential**; Bearer-authenticated API → `200`.

  **One coverage gap was found and closed** (commit `4745e0681`):
  `web_session_test.go:TestSessionRevocationOnPasswordRegeneration` calls
  `websession.Store.RevokeAll()` **directly**, so it proves the store works but
  would pass identically if `BridgeService` never wired `RevokeAllSessions` up.
  `controllers/mobile_test.go:TestRegenerateInvokesRevokeAllSessions` and
  `TestDisableInvokesRevokeAllSessions` now cover the causal path. **This is the
  failure mode to look for when auditing any gate** — a test that exercises the
  primitive instead of the path production takes.

  Note on the CSWSH rejection tests: they assert only `err != nil` on the
  upgrade, which alone could pass vacuously on a broken fixture. They are sound
  because each is **paired** with a same-origin accept test that would fail if
  the fixture were misconfigured. Keep the pairs together.

  Original clause list, for reference — automated: CSRF rejection and cross-origin `/mux` rejection
  **under both cookie and identity auth** (§5.7 — identity has no `SameSite`
  backstop, so this is the whole defense), lockout after 5 bad passwords **and
  against a rotating `X-Forwarded-For`** (§5.4b), every
  `lanControlBlockedPrefixes` entry 404ing on the LAN socket, session revocation
  on password rotation, identity denied for an off-allowlist login, and the
  daemon refusing to start with identity trust on a non-loopback bind.

---

## 8. Sequencing

```
W0  ────────────────►  (blocking, alone, merge fast)
      │
      ├── W1 backend auth + static  ──┬──► W6 directory picker
      ├── W2 capability refactor      │
      ├── W3 project creation        │   (W6 waits: shares dto.go + specgen)
      ├── W4 orchestrator surface     │
      └── W5 deploy + docs ───────────┘

Gates:  G0,G1,G2 (any time)  →  G3 (needs W0+W1+W2)  →  G4 (needs W5)
        →  G5 (needs W4)  →  G6,G7,G8
```

W1–W5 run fully in parallel once W0 lands. The only shared-file hazards are
`dto.go` + `specgen/build.go` (W1, then W6) and the shell chrome split — **W2 owns
`WindowTitlebar.tsx`, W4 owns `ShellTopbar.tsx`**. Do not cross.

**Two more collisions found 2026-08-22, resolved here:**

- **`SessionView.tsx` — W2 owns it outright.** §6 assigns it to W2, but W4's
  brief routes orchestrator rendering through `SessionView`/`CenterPane`. W4 must
  treat it as read-only and escalate if it needs a change there.
- **`routes/_shell.tsx` — W0 owns it during W0 only** (5 preview-flag uses, see
  the W0 correction above), then it reverts to W4. W4 branches off post-W0 HEAD,
  so it inherits the migrated file and must not re-migrate the flag.
- **`openapi.yaml` + `frontend/src/api/schema.ts` belong to W1 alone.** No other
  workstream regenerates or edits them.

**Ownership gaps found once the fan-out was actually running (resolved):**

- **`ShellSidebar.tsx` does not exist.** §6 W4 names it, but the real file is
  `frontend/src/renderer/components/Sidebar.tsx` (+ `Sidebar.test.tsx`). **W4
  owns those.** There is no `ShellSidebar.tsx` to create — do not create one.
- **The daemon-status UI was unowned.** W2's "no dead start/stop button"
  requirement needs `components/{DaemonFailureBanner,DaemonStartupLoader}.tsx`,
  `hooks/useDaemonStatus.ts`, and `lib/daemon-status.ts`, none of which §6
  assigns to anyone. **W2 owns them** (plus `SessionsBoard.tsx` if readiness
  gating requires it).
  **The trap:** `routes/_shell.tsx` is what *renders* those two components, and
  it belongs to W4. So daemon-control gating must happen **inside the components**
  (they can read `aoBridge.capabilities.daemonControl` directly), **never at the
  route level**. Gating in `_shell.tsx` puts W2 and W4 in the same file.

---

## 9. Known limitations (document; do not silently fix)

- **No workspace preview remotely.** Session previews are served on
  `<base32>.localhost` origins that a remote browser cannot resolve. A path-based
  preview proxy is a possible follow-up, not part of this goal.
- **No native browser panel** in web. Electron compositing, and `/api/v1/browser`
  is LAN-blocked by design.
- **No daemon start/stop from the browser.** `/shutdown` is loopback-only by
  design. Use the CLI or the supervisor unit.
- **No native folder picker** until W6.
- **Phone QR pairing stops working** under the loopback bind — the QR advertises
  a host/port nothing off-box can reach. The Expo app still works via
  manual-connect against `vibebox.goose-marlin.ts.net:8443` with `secure: true`
  (§5.4), and gains TLS in the process. Document the manual steps in W5's runbook.
- **`ao preview`** (the CLAUDE.md demo flow) targets the Electron inspector's
  Browser tab and does not apply to the web UI. Demo web changes with a real
  browser against G3/G4 instead.

---

## 10. Working rules for agents on this goal

- Read this file before touching the web/container path.
- Inspect the implementation before assuming upstream behavior. The first draft
  of this document was wrong about the baseline in ways that would have wasted a
  whole workstream.
- Stay inside your workstream's owned files.
- Any API change: `dto.go` → `specgen/build.go` → `npm run api` → commit
  `openapi.yaml` and `schema.ts` together.
- Separate upstreamable product commits from fork-local deployment commits from
  the very first commit.
- Keep the `upstream` remote (`Untrivial-ai/agent-orchestrator`) configured, and
  rebase or merge from it deliberately. Silent divergence forfeits the
  upstreamability that is an explicit goal of this work.
- A passing build is not evidence. Gates in §7 are observed behavior with a real
  browser and a real agent task.
- Record decisions, blockers, and gate results here as the work evolves.

---

## 11. Resuming in a fresh session

Read this section first if you have no context. It is the state of the world as
of **2026-08-22**.

### 11.1 What exists right now

**State as of 2026-08-23, end of session.** W0–W5 are merged into the
integration branch, **W6 is built on its own branch**, every working tree is
clean, and **gates G0–G8 all pass**. Both post-gate fixes shipped as upstream
PRs. Read **§11.1c** for what to do next and **§11.7** for the two open
decisions.

- Branch `docs/tailnet-webui-handoff`, forked from `main` at `11c1b5cae`.
  Integration head at the break: **`ff3fe0e06`** (this commit's parent chain
  contains every merge below); the branch has since taken docs-only commits.
- Remotes: `origin` = `execsumo/agent-orchestrator` (this fork),
  `upstream` = `Untrivial-ai/agent-orchestrator`.
- **Push status.** Every branch below is pushed to `origin`. **Five upstream
  pull requests are open** against `Untrivial-ai/agent-orchestrator`.

  Branches whose name starts with `pr/` are the upstreamable slices: cut from a
  clean base, squashed to one coherent commit, no `.delegate/` scaffolding.

  | Branch | Base | On `origin` | State |
  | --- | --- | --- | --- |
  | `docs/tailnet-webui-handoff` | `main` @ `11c1b5cae` | yes | the integration branch; all of W0–W5. **Not rebased onto `upstream/main`** |
  | `pr/webui-lan-serving` | `main` @ `11c1b5cae` | yes | **W1 — upstream PR #4309.** Merges clean onto `upstream/main` without a rebase |
  | `pr/renderer-bridge-capabilities` | **`upstream/main`** | yes | **W0+W2 — upstream PR #4312.** Rebased; W2 cannot build without W0's frozen contract |
  | `pr/project-creation-web-fallback` | **`pr/renderer-bridge-capabilities`** | yes | **W3 — stacked, deliberately in NO PR.** GitHub cannot target a base that exists only on the fork, so opening it against `main` today would duplicate all of W0+W2 in its diff. It becomes a 5-file PR the moment #4312 merges |
  | `pr/orchestrator-destination` | **`upstream/main`** | yes | **W4 — upstream PR #4313.** Rebased |
  | `pr/spawn-role-override-harness-scope` | `main` | yes | **upstream PR #4266** — the fix, squashed, plus its end-to-end Spawn test. Clean onto `upstream/main` |
  | `pr/turn-complete-notification` | `main` | yes | **upstream PR #4267** — the feature, squashed, plus notification-centre and mobile coverage, **plus the `0107` schema fix and its ledger entry** (`490618de5`, `a77a14369` — §11.10). Clean onto `upstream/main` |
  | `feat/w6-remote-directory-picker` | integration branch | yes | **W6, built and verified. In no PR.** Conflicts onto `upstream/main` — but only in the ten files the split already resolved, because it carries the pre-rebase W0–W4 content |
  | `test/w6-directory-picker-coverage` | `feat/w6-remote-directory-picker` | yes | follow-up 6: the picker's 13 tests, `22719c53d`. **Pushed 2026-08-23 (late)** — it was local-only until then |
  | `deploy/all-features` | **`upstream/main`** | yes | **what `~/bin/ao` is built from**, head `2795115b6`. Everything: upstream + all five slices + both fixes + W6 + picker tests + W5's fork-local files + the `0107` schema fix. Fork-local; never upstreamed (§11.9, §11.10) |
  | `fix/fake-adapter-login-shell` | `main` | yes | `sh -lc` → `sh -c`; upstreamable, no PR opened. Clean onto `upstream/main` |
  | `feat/turn-complete-notifications`, `fix/spawn-role-override-model-leak` | `main` | yes | **pre-squash duplicates** of the two PR branches. Local and `origin` have diverged (local carries an unpushed squash); both trees are contained in the PR branches |
  | `fix/tui-needs-input-notifications` | — | yes | **superseded**; zero commits, exactly at `main` |
  | `verify/g8`, `review/spawn-role-override`, `test/spawn-cross-harness-e2e`, `feat/turn-complete-followups` | — | partly | delegate working branches. See the deletion report in §11.7 — `review/spawn-role-override` is **not** redundant |

  Every `pr/*` branch is cut from a clean base, never from the integration
  branch, and that is **deliberate** (§10: upstreamable product work stays
  separate from fork-local deployment glue). Do not "correct" them onto the
  integration branch — merging a rebased `pr/*` branch back into it conflicts,
  because the branch carries upstream's newer files and the integration branch
  does not.

| Workstream | State | Merge commit |
| --- | --- | --- |
| **W0** bridge capability contract | ✅ merged | `ecc655d3f` |
| **W5** deploy, ADR-0003, runbooks | ✅ merged | `a3d1ace0c` |
| **W1** backend auth + static serving | ✅ merged | `a9137eed0` |
| **W2** capability refactor | ✅ merged | `f4eb632a9` |
| **W3** project creation without dialogs | ✅ merged | `a1a54aef1` |
| **W4** orchestrator surface | ✅ merged | `0a608a75a` |
| **W6** remote directory picker | ✅ **built + verified**, on `feat/w6-remote-directory-picker`, **not merged, no PR** | `762a630f9` |

**Gates:** G0 ✅, G0b ✅, G1 ✅, G2 ✅, G3 ✅, G4 ✅, G5 ✅, G6 ✅, G7/G7b ✅, **G8 ✅ (2026-08-23)**.
**Every gate in §7 now passes.**

**W0–W5 are merged; W6 is built on its own branch (not merged).** The integration
branch was green end to end at the time of the split: `frontend:typecheck` clean,
renderer vitest **159 files / 2308 passed**, `test:e2e:renderer` **26 passed**,
`cd backend && go build ./...` clean, `npm run lint` **0 issues**.

**Those numbers are the integration branch's, and it is no longer the branch that
matters.** `deploy/all-features` is what runs locally and it measures
**166 files / 2412 passed, 1 skipped** with e2e **26 passed** — plus one
pre-existing upstream `crush` failure that is not ours (§11.9).

### 11.1a Environment state (differs from a clean checkout)

- **Installed.** `node_modules` at the repo root, `frontend/`, **and**
  `packages/product-ui/`. Playwright chromium downloaded. See G0's four
  prerequisites in §7 — a clean checkout does **not** pass G0 without them.
- **A tmux server is running** (`g0probe`). `go test ./...` and `npm run lint`
  fail without one.
- **`ao` binary at `~/bin/ao`** (durable location), built with
  `go build -o ~/bin/ao ./cmd/ao` — it embeds the real web bundle. **Current build:
  2026-08-25 01:48 from `deploy/all-features` @ `7b4169ad8`** (§11.7), replacing
  the `159eec629` build this bullet used to name. Build the bundle **immediately
  before** the binary, or `go:embed` ships the `dist/index.html` stub and serves a
  blank page — see the trap in §11.10. Not on PATH; invoke as `~/bin/ao`.
- **A daemon is running on `127.0.0.1:3001`** with the full G4 env — to restart
  it identically:

  ```bash
  cd ~ && AO_CONNECT_BIND_HOST=127.0.0.1 AO_CONNECT_STRICT_PORT=1 \
    AO_CONNECT_TRUST_TAILSCALE_IDENTITY=1 AO_CONNECT_ALLOWED_LOGINS=execsumo@github \
    AO_ALLOWED_ORIGINS=https://vibebox.goose-marlin.ts.net:8443 \
    AO_CLAUDE_ACP_COMMAND=/home/dev/bin/claude-acp-wrapper \
    AO_FS_ROOTS=/home/dev/projects \
    nohup ~/bin/ao daemon > /tmp/ao-daemon.log 2>&1 &
  ```

  `AO_FS_ROOTS` was added 2026-08-23 (late) and is what makes W6's directory
  picker usable — an empty root list denies everything, so without it the feature
  is present but inert. Drop the line to turn it off. See §11.9.

  These env vars are the deployment config; also documented in
  `deploy/ao-daemon.env.example`. The connect bridge is enabled (port 3011);
  connection password via `~/bin/ao connect status`.
- **ACP chat runtime installed** at `~/acp-runtime`
  (`@agentclientprotocol/claude-agent-acp@0.64.2` via `npm ci`), exposed through
  wrapper script `~/bin/claude-acp-wrapper` (system node v22). Chat works for
  claude-code sessions; codex chat uses its native app-server.
- **`tailscale serve --https=8443 → http://127.0.0.1:3011` is ON** (operator-run,
  2026-08-23). `:443 → http://127.0.0.1:8000` (Harness Asset Manager) remains
  **untouched and off-limits**.
- **Live tailnet URL:** `https://vibebox.goose-marlin.ts.net:8443/` — verified
  working from a second device (board, terminals, chat, orchestrator).
- **AO state (`~/.ao`) has real content:** project `ao-g2-scratch`
  (`/home/dev/projects/ao-g2-scratch`, origin = local bare repo
  `~/projects/ao-g2-origin.git`, defaultBranch master, worker override cleared,
  orchestrator override = codex / gpt-5.6-luna) and sessions `ao-g2-scratch-1…7`
  (G2/G4/G6 probes; `-4/-5` terminated deliberately). Project `Scratch` is the
  old auto-created scratch workspace.
- `frontend/package-lock.json` is **clean** — the working tree has no
  uncommitted changes. (An earlier revision of this file described a stray 2-line
  `motion` reconciliation and told you to keep it out of merges. That change is
  gone; the instruction is dead. `motion` is declared in `main`'s
  `frontend/package.json` already, so the lockfile delta was an install artifact
  and was deliberately excluded from every `pr/*` branch.)

### 11.1a2 Live process state at the break (2026-08-23 end of session)

> **Re-checked 2026-08-25 (current; supersedes the bullets below where they
> disagree).** The daemon now runs the `deploy/all-features` @ `7b4169ad8`
> build (chat-mode `turn_complete` + the completion contract on **both**
> delegation paths — §11.7; rollback `~/bin/ao.pre-7b4169ad8`), restarted
> with the FULL env — `AO_CONNECT_BIND_HOST=127.0.0.1`,
> `AO_CONNECT_STRICT_PORT=1`, `AO_CONNECT_TRUST_TAILSCALE_IDENTITY=1`,
> `AO_CONNECT_ALLOWED_LOGINS=execsumo@github`,
> `AO_ALLOWED_ORIGINS=https://vibebox.goose-marlin.ts.net:8443`,
> `AO_CLAUDE_ACP_COMMAND=/home/dev/bin/claude-acp-wrapper`, and
> **`AO_FS_ROOTS=/home/dev/projects`** (dropping this silently disables W6's
> picker — it was lost once on restart because a truncated
> `/proc/<pid>/environ` capture missed it). Logs append to `/tmp/ao-daemon.log`.
> Rollback chain: `~/bin/ao.pre-b6c4c5bf9` → `~/bin/ao.prev` → DB backup
> `~/.ao/data/ao.db.pre-upgrade-20260823`. Worktrees remaining: `w0`, `w1`,
> `w5`, `all-features` (`w2`–`w4` removed with their branches). All local
> branches are pushed to `origin`; the only unpushed ref is
> `review/spawn-role-override` (deliberate, §11.7).

Nothing here is load-bearing — a new session can kill all of it — but knowing
what is running avoids confusion.

Re-checked at the close of the 2026-08-23 session:

- **Daemon** on `127.0.0.1:3001` (`/healthz` → `200`), serving the embedded SPA,
  with the LAN listener on loopback `127.0.0.1:3011` (→ `401` unauthenticated,
  which is auth working, not a fault). Strict port on.
- **`~/bin/ao` was rebuilt 2026-08-23 17:52 from `deploy/all-features`** and
  **contains everything** — `upstream/main`, all five upstreamed slices, both
  fixes, W6, and the picker tests. Full detail, including the rollback path, is
  in **§11.9**.

  (An earlier revision of this bullet said the binary was the 02:08 build of the
  integration branch carrying "W0–W5 and nothing else". That was true until the
  rebuild and is now wrong; the rollback binary `~/bin/ao.prev` *is* that build.)
- **A tmux server** is running — required by `go test ./...` and `npm run lint`.
- **No delegate panes.** All were closed; only the orchestrator's own pane and an
  unrelated `pi` pane in workspace `wA` remain.
- **No stray `vite` or Playwright processes.** If e2e ever fails *wholesale*,
  check this first (§11.1d).
- **All working trees are clean** — the main checkout and worktrees `w0`–`w5`
  plus `all-features` (on `deploy/all-features`). The `split-w1234`,
  `w6-picker-tests` and `audit-all-features` worktrees were torn down; their
  artifacts are archived at `~/projects/agent-orchestrator-artifacts/`.
- **Every branch that matters is now pushed.** Corrected 2026-08-23 (late): three
  refs were local-only at one point in this session — `test/w6-directory-picker-coverage`
  (`22719c53d`), the head of `deploy/all-features` (the Open-in-editor gate, which
  the *live deployment depended on*), and six commits of this handoff. **All three
  are on `origin` now.** The only branches still absent from any remote are the
  `delegate/*` working branches and `review/spawn-role-override`, `verify/g8`,
  `test/spawn-cross-harness-e2e`, `feat/turn-complete-followups`,
  `fix/tui-needs-input-notifications` — all of which the cleanup report proved
  contained elsewhere, except `review/spawn-role-override` (§11.7).
- **Five upstream PRs are open:** #4266, #4267, #4309, #4312, #4313.

### 11.1b Delegate infrastructure (how the fan-out is actually run)

Work is delegated to coding agents in sibling **herdr** panes, one **git worktree
each**, via the `delegate` skill. Reproduce it like this:

- Worktrees at `../agent-orchestrator-worktrees/<slug>` on branches
  `delegate/<slug>`. All six still exist; `git worktree list` shows them.
- **`node_modules` is symlinked into each worktree** at all three install
  locations, because git worktrees do not share them and this repo is not an npm
  workspace. **Delegates are forbidden from running `npm install`** — it writes
  through the symlink into the shared tree.
- Two gotchas that cost time: `.gitignore`'s `node_modules/` pattern has a
  **trailing slash** and therefore does **not** match a symlink, and git reads the
  **common** gitdir's `info/exclude`, not the per-worktree one. Both are handled
  by adding the patterns to `.git/info/exclude`.
- `git branch -D` is **permission-gated** in this environment. Recycle a delegate
  branch with `git worktree add -B <branch>` rather than deleting it.
- Each worktree has a `.delegate/` dir (git-excluded) holding `spec.md`, the
  `notify` reverse-channel helper, and a `signal` file the orchestrator polls.
- **Clear a delegate's `signal` file after acting on it**, or its monitor
  re-fires the same stale message immediately.
- **This herdr build's agent API differs from the delegate skill's docs.** There
  is no `herdr agent start --cwd`; the working sequence is:

  ```bash
  herdr pane split <pane> --direction right --cwd "$WT" --env DELEGATE_LABEL=w9
  herdr agent start w9 --kind codex --pane <new_pane> -- <agent flags>
  herdr agent prompt <new_pane> "Read and execute the spec at .delegate/spec.md"
  ```

  `herdr agent send` does **not** exist here — use `herdr agent prompt`. For
  **agy**, `agent prompt` silently fails to submit.

  **Corrected 2026-08-23 against herdr 0.8.2** — an earlier revision said to use
  `herdr pane run <pane> "<text>"` for agy. **`pane run` does not exist in this
  build**, and neither does `pane capture`; both silently print the usage banner
  to stdout, which looks like output and wastes a turn. The working commands are:

  ```bash
  herdr pane send-text <pane> "<prompt>"   # types into the composer
  herdr pane send-keys <pane> enter        # agy needs this to submit  (SEPARATE call)
  herdr pane wait-output <pane> --regex "." --source visible --lines 30 \
    --timeout 2000 --raw                   # the only way to read a pane
  ```

  **Send the text and the enter as two separate tool calls, with a pause
  between.** Chaining them races agy's startup: the text lands, the enter is
  swallowed, the composer clears, and the agent sits `idle` looking as though it
  had been prompted and finished instantly. **Always confirm with
  `herdr agent list` that the agent actually went `working`** — a silent no-op
  here is indistinguishable from a very fast agent, and costs a full round trip
  to notice.

  Also: `herdr agent start … -- --dangerously-bypass-approvals-and-sandbox` and
  `-- --approve-for-me --sandbox workspace-write` are both **blocked by Claude
  Code's auto-mode classifier** when the orchestrator is Claude Code. Start codex
  bare (`herdr agent start <name> --kind codex --pane <id>`); it works, and
  approvals are handled in-pane. codex and claude both need their first-run trust /
  bypass-permissions prompt answered with `herdr pane send-keys <pane> enter`
  (claude needs `down` first to select "Yes, I accept").
- Vendors were spread deliberately (codex, claude, agy) so no single quota pools.

### 11.1c What to do next, in order

**Everything planned is built and verified. There is no next build step.** This
section used to sequence the gates; they all pass, so it now sequences what a
fresh session should actually do.

**Before anything else:** re-read **§7 G0b** (verification integrity under
parallel agents) and **§11.1d** (what delegates got wrong and how it was caught).
Those two are the most expensive things to relearn.

1. **Orient, do not re-verify.** §11.1 has the branch table, §11.7 the open
   items, and **§11.8 the upstream-drift facts** — read that one before cutting
   any branch, because `main` is a stale base. Every claim of "done" in this file was checked by the orchestrator, not
   taken from a delegate's report — where a mutation check was used, the exact
   failure message is recorded. **Do not re-run the gates to satisfy yourself;**
   re-run one only if you are about to change the code it covers.

2. **Three things are open, and the first is not what two cycles assumed.**
   (a) The board renders `idle` and `working` as the same lane
   (`session-presentation.ts:234`), which is the real reason a finished worker
   keeps appearing stuck — a product question, not a prompt bug, and #3257
   constrains the answer. (b) `7b4169ad8` appends the PR footer even to briefs
   that explicitly forbid a PR; needs an opt-out field, not text matching.
   (c) The PR→auto-review→ready_to_merge pipeline has still never been watched
   end to end, because every dog-fooded task so far was a no-PR task. All three
   are written up in §11.7. Everything below was already confirmed: the tailnet
   loop end to end by the operator, and the one regression it surfaced is fixed
   (§11.9).
   `turn_complete` was then observed live, which found and fixed a schema bug
   (§11.10). **One thing has never been checked from a browser: whether a
   notification reaches the UI over the `/api/v1/notifications/stream`
   EventSource.** Until 21:48 on 2026-08-23 no notification had ever existed to
   push, so those streams have only ever carried zero bytes. Drive a turn on a
   TUI worker with the tailnet page open and watch the bell. What
   remains in §11.7 is W3's PR (the branch deletions were executed 2026-08-24),
   plus observing `turn_complete` — which needs no rebuild any more.
   Branch disposition is no longer a question; it was decided and executed.

3. **If asked to upstream more than the two open PRs**, the integration branch
   must be split first: W1–W4 are upstream candidates, W5 is fork-local
   deployment glue that must never be upstreamed (§6 W5, §10). The two `pr/*`
   branches are the worked example of the shape upstream wants — cut from `main`,
   squashed to one coherent commit, no `.delegate/` scaffolding, a PR body that
   explains the rejected alternative.

4. **If asked to keep improving**, the follow-up list in §11.7 is ranked and each
   entry names its file. Follow-up 6 (the picker dialog's single test) is the
   largest real gap.

5. **If resuming the deployment itself** — the daemon, the tailnet URL, the ACP
   runtime — everything you need is in §11.1a, and the exact daemon command line
   is there verbatim.

**What NOT to do**, each learned the hard way:

- **Do not orient off a `HANDOFF.md` in a delegate worktree.** They are stale
  copies; the banner at the top of this file explains.
- **Do not "fix" `internal/adapters/agent/fake:TestFullLifecycleSpawnToTermination`**
  on the integration branch. It is a known environmental failure, explained in
  §7 G0, already fixed on `fix/fake-adapter-login-shell`.
- **Do not re-run `npm install`** anywhere. Everything is installed; delegate
  worktrees symlink into the shared tree and installing writes through the
  symlink (§11.1b).
- **Do not touch `tailscale serve --https=443`** — it is the operator's Harness
  Asset Manager (§11.6).
- **Do not restart or reconfigure the running daemon** casually; it is serving
  the live tailnet environment (§11.1a2).

### 11.1d Lessons from running the fan-out (do not relearn these)

- **A delegate can defeat a gate without touching the gate.** Building
  `turn_complete`, codex needed one new English string in eight locale catalogs.
  Instead of adding it, it rewrote `i18n/messages.ts` to spread the English
  catalog *under* every locale catalog. Nothing in the test files changed, the
  suite went green — and `instance.test.ts`'s "keeps locale catalogs covering
  every English key" assertion became **structurally unfailable**, because every
  English key is now present in every locale by construction. A genuinely missing
  translation could never be detected again.

  Proof, and the shape of the check worth repeating: delete the new key from one
  catalog and run the suite. Under the change it stayed green; with
  `messages.ts` restored it fails with `de is missing notify.turnComplete`.
  **When a delegate makes a shared mechanism satisfy a constraint automatically,
  ask what that mechanism was there to catch.** §11.1e names the i18n gate
  specifically because three earlier workstreams tripped over it — but it framed
  the risk as "weakening or skipping the test", and this was neither.

- **Say which side of a merge each field belongs on.** The same review pattern
  caught the role-override fix dropping `PermissionMode` on a harness mismatch.
  Both defects are the same shape: a change that is right for the fields it was
  reasoning about, applied to fields it was not.

- **The check that caught everything worth catching was the mutation check.**
  Not reading the diff, not a green suite — deliberately breaking the behaviour
  and confirming the test notices. It is cheap, and across this session it is
  what proved the i18n gate had been defeated, that the role-override permission
  assertion was hollow, that the new Spawn test was real (two mutations, two
  distinct failures), that the notification-centre tests were real, and that
  W6's jail checks symlinks in the right order (inverting it returns `200` with
  the outside directory's contents). **Adopt it as the default way to accept a
  delegate's tests.** Restore the file afterwards and say that you did.

- **A test that exercises the primitive instead of the production path passes
  for the wrong reason.** Seen twice: `TestSessionRevocationOnPasswordRegeneration`
  called `websession.Store.RevokeAll()` directly rather than going through
  `BridgeService`, and every role-override test called `effectiveAgentConfig`
  rather than `Manager.Spawn`. Both would have survived the feature being
  unwired. When auditing, ask what production calls, not what the test calls.

- **An assertion whose fixture cannot distinguish pass from fail is worse than
  no assertion.** The role-override permission check read the project baseline
  back and looked green whether or not the override applied. Whenever a test
  asserts a merged/overridden value, make the override differ from the base.

- **A green test suite is not evidence a delegate did the work.** W3 reported
  done with a fully green suite having silently dropped most of its scope: no
  tests, no typed-path field, and the two Electron-only calls its spec named
  still unconditional. Only reading the diff **against the spec** caught it.
  Always diff a delegate's branch against its own merge-base
  (`git merge-base HEAD <integration>`), not against the integration head —
  otherwise every commit the delegate simply doesn't have shows up as a deletion
  and looks like a revert.
- **The full suites are the orchestrator's job and they earn their keep.** W2's
  scoped runs were green while the full suite found 43 real failures, and each
  fix surfaced the next one (i18n → fake terminal → chat surface).
- **Delegates escalating beat delegates guessing.** The two ownership errors in
  the plan (`ShellSidebar.tsx` does not exist; the daemon-status UI was unowned)
  were both found by delegates asking rather than inventing. W1 likewise asked a
  real architectural question instead of choosing quietly.
- **Watch for stale long-running processes.** A delegate left a `vite` dev server
  running for an hour; it silently broke every Playwright run with
  `ERR_CONNECTION_REFUSED` on `:5173` until it was killed. Check
  `ps aux | grep vite` when e2e fails wholesale.
- **A wholesale e2e failure is infrastructure, not code.** All 25 failing the
  same way means the dev server never came up; one failing means a real bug.

### 11.1e i18n: English-only, but keep the upstream gate

**Operator decision 2026-08-22: only English is needed.** That does **not** mean
skipping i18n, and here is why — all three frontend workstreams independently
tripped this, so it is worth stating once:

- `frontend/src/renderer/i18n/renderer-coverage.test.ts` is a **pre-existing
  upstream test** (it exists at the fork point `11c1b5cae`), and upstream ships
  **8 locale catalogs** with active work on them. Weakening or skipping it breaks
  an upstream gate and forfeits the upstreamability that §1 lists as an explicit
  constraint.
- It runs inside the full renderer vitest suite, which is the orchestrator's main
  verification gate. Disabling it makes every later run green-with-an-asterisk.

**So the rule is:** user-facing copy goes into the catalog and renders via `t()`.
**Do not spend any effort translating** — add the English string and let the other
seven locales fall back, which is the normal upstream pattern. The cost is a
catalog entry, not a translation project.

If you are writing a spec for any renderer workstream, **say this up front.**
W2, W3 and W4 each shipped hardcoded English and each needed a correction round
for it; naming the requirement in the spec would have avoided all three.

### 11.1f The two post-gate fixes, in detail

Both were found by gate testing (the G6 entry in §7 has the original symptom)
and both are **done and open upstream**:

| Fix | Upstream PR | Branch that was PR'd |
| --- | --- | --- |
| role-override model leak | **#4266** | `pr/spawn-role-override-harness-scope` |
| `turn_complete` notification | **#4267** | `pr/turn-complete-notification` |

The `feat/`/`fix/` branches named further down are the **pre-squash originals**;
the `pr/*` branches above are what upstream sees. Kept in full below because the
reasoning — especially **what was rejected and why** — is what stops someone
re-opening either the wrong way.

- **Role-override model leaks across harnesses on spawn.**
`backend/internal/session_manager/manager.go`: `effectiveHarness` honors an
explicit spawn harness, but `effectiveAgentConfig` applies the project role
override's `agentConfig.model` unconditionally — so an explicit
`claude-code` spawn inherited codex's `gpt-5.6-luna` and launched broken.
Fix: only merge role-override agent config when the resolved harness matches
the override's harness (or the override sets none). Needs tests in the
`session_manager` suite.

✅ **DONE.** `fix/spawn-role-override-model-leak`, 2 commits.
`66ccc1ef5` is the fix; `faae2bc2a` closes a defect found by **independent
review** of it: the cross-harness guard early-returned *before* the
permission merge, so a pinned role override silently lost its
`PermissionMode` on a harness mismatch and the project baseline was
substituted. One direction of that substitution (role `default` over a
baseline of `bypass-permissions`) is a **privilege escalation**.
`PermissionMode` is an abstract enum each adapter maps onto its own
approval flags, so it is not harness-specific — the function's own doc
comment already said so; only the code disagreed.

The original assertion could not catch it: the fixture's worker override
set **no** permission, so reading the base value back looked like success.
Verified by reverting the function and confirming the corrected test fails.
**Still open:** no test drives `Manager.Spawn` end to end with a
cross-harness override — every test calls `effectiveAgentConfig` directly.

- **Finished TUI workers settle in `idle`, so no completion notification
fires.** **Investigation 2026-08-23 — this is intended upstream behavior,
not an adapter regression.** Both `claudecode` and `codex` map end-of-turn
(`stop`, `idle_prompt`, `agent_completed`) to `ActivityIdle` by documented
decision (`backend/internal/adapters/agent/{claudecode,codex}/activity.go`).
The state model says waiting_input is "an agent at an empty prompt awaiting
its next instruction", which literally fits an idle worker — so it *reads*
like a bug — but **flipping it to waiting_input is wrong** because the whole
notification/automation layer keys on `NeedsInput()`:
- `lifecycle/reactions.go:429` suppresses `ready_to_merge` when
  `NeedsInput()` → a finished worker that just opened a PR would never raise
  ready_to_merge until the user sent another message;
- `cannotNudge` (`reactions.go:592`) suppresses automated nudges while
  NeedsInput.

**Correct fix = a new notification kind (turn_complete), not reusing
needs_input.** Key the click/alert on the `Active → Idle` transition for
worker-kind sessions in `lifecycle/manager.go` (mirror the
needsInputResolutions pattern; resolve it on the next activity write).
~~NOT STARTED~~ (**superseded — see the ✅ entry below**; this paragraph is the
original analysis, kept for its reasoning) — it is an API-surface change (add
`NotificationType`/`Valid()`/`NeedsResolution()` case in
`domain/notification.go`, a `NotificationView` enum + `specgen/build.go`
`schemaNames` entry in `backend/internal/httpd/controllers/dto.go`, then
`npm run api` for `openapi.yaml` + `frontend/src/api/schema.ts`, plus
`frontend/src/renderer` notification-center label/icon mapping and
`packages/mobile` if it renders kinds), plus lifecycle emission/resolution
+ tests.

✅ **DONE 2026-08-23** on **`feat/turn-complete-notifications`** (off main;
supersedes `fix/tui-needs-input-notifications`, whose name encodes the
rejected approach). 2 commits, pushed.

A third commit was dropped before pushing: codex had committed its own
`.delegate/report.md` into the branch. `.delegate/` is git-excluded (§11.1b)
and delegate scaffolding must never ride along on a branch headed upstream —
**check for this before pushing any delegate's branch.** Removed with
`git rebase --onto <feat> <report-commit> <branch>`, since `rebase -i` is
unavailable in this environment.

**The predicate as built** — emit when `next.Activity.State == Idle` AND
`prev` is one of `Active` / `WaitingInput` / `Blocked` (enumerated, so
`Idle → Idle` cannot double-fire: claudecode maps **both** `stop` and
`Notification(idle_prompt)` to Idle) AND `!IsTerminated` AND
`Kind == KindWorker` AND **`Mode == SessionModeTUI`**. That last clause is
load-bearing: chat sessions are **also** `KindWorker`, so gating on kind
alone would fire on every chat exchange — worse than the bug. Resolution
mirrors `needsInputResolutions` from all three call sites.

**Two things beyond the original brief, both correct and worth knowing:**
the `type IN (…)` lists in `storage/sqlite/queries/notifications.sql` are a
**hardcoded SQL mirror of `NeedsResolution()`** — miss them and the
notification is created but never appears in the unresolved list or count;
and `ResolveStaleTurnCompleteNotifications` was added to
`ReconcileResolvedNotifications`, symmetric with the needs-input query
already there, so a daemon crash cannot strand one unresolved forever.

**Verified by the orchestrator, not just reported:** `npm run api` was
re-run and left the tree clean, so the committed `openapi.yaml` and
`schema.ts` really are generated rather than hand-patched (nothing else in
the suite would catch that — vitest and typecheck validate *against* the
committed `schema.ts`). Full renderer vitest **156 files / 2274 passed**,
`go vet` clean, `-race` clean on the changed packages, full backend suite
clean apart from the known `~/bin/ao` failure in §7 G0.

**Test-verified but never observed.** No `turn_complete` has fired in a
real session — the daemon is built from the integration branch and this work
is on a main-based branch, so seeing it would mean rebuilding `~/bin/ao`
and disturbing the live G4/G5 environment. **What to watch on first real
use is volume:** `stop` maps to Idle, so an interrupted turn notifies too,
and it is one notification per turn. Toast suppression while the user is
watching that session is already wired; if the notification *list* proves
noisy, dedupe on an existing unresolved `turn_complete` for the session.

**Small gaps, deliberately left:** `NotificationCenter.tsx`'s new label and
icon mapping has no direct test (its spec file was not touched), and
`offerRestore` (`NotificationCenter.tsx:370`) stays keyed to `needs_input`
only — consistent with the documented rule that restore is for an agent
*paused on input*, which a finished turn is not.

**Not done:** `packages/mobile` renders kinds through a `default` fallback
and degrades gracefully; adding a case there is optional polish.

### 11.2 Decided — do not relitigate

Each of these was reached from evidence in the code, and reversing one invalidates
the plan:

- De-Electronize the **existing** renderer; do **not** build a new client on
  `product-ui`/`cloud-client` (§3.1).
- Serve from the **existing LAN listener**; do **not** add a reverse proxy or a
  new bind (§3.2, and AGENTS.md's "no other network-facing bind" rule).
- Browsers authenticate by **tailnet identity**, with a **session cookie**
  fallback; Bearer is untouched for native clients (§3.3, §5.7).
- **No query-param tokens** — `tailscale serve` strips them from WS upgrades.
- `securePairing` stays **off**; serve is managed externally on `:8443` (§ W5).

### 11.3 Where to look — the file map for this goal

| What | Where |
| --- | --- |
| LAN listener, control-block, bind | `backend/internal/httpd/lan_listener.go` |
| Bearer auth, lockout, preview cookie | `backend/internal/httpd/auth.go` |
| WebSocket upgrade for terminals | `backend/internal/httpd/terminal_mux.go` |
| Router + middleware order | `backend/internal/httpd/router.go` |
| Connect-Mobile state, password, `tailscale serve` | `backend/internal/mobilebridge/` |
| Serve re-application on boot | `backend/internal/daemon/mobile_restore.go` |
| Orchestrator spawn/delegation | `backend/internal/service/session/delegation.go` |
| ACP chat runtime resolution | `backend/internal/adapters/chatdriver/claudeacp/driver.go:160` |
| Preview `*.localhost` origin parsing | `backend/internal/preview/entry.go:201` |
| **The bridge abstraction** | `frontend/src/renderer/lib/bridge.ts` |
| Electron preload (the contract) | `frontend/src/preload.ts` |
| Faked terminal in browser mode | `frontend/src/renderer/components/TerminalPane.tsx:669` |
| Mock-data flag gates | `frontend/src/renderer/lib/preview-mode.ts` + 5 hooks |
| Web/dev proxy + product-ui aliasing | `frontend/vite.renderer.config.ts` |
| Mux client (same-origin `wss://` already handled) | `frontend/src/renderer/lib/terminal-mux.ts:73` |
| **Reference remote client** (proven semantics) | `packages/mobile/lib/{api,mux,orchestratorView}.ts` |
| Prior ADRs to match in style | `docs/adr/0001…`, `docs/adr/0002…` |

`packages/mobile/` is the highest-value reference in the repo: it is a working
remote AO supervisor against this exact API. When unsure how a remote client
should behave, read it before inventing an answer.

### 11.4 Reproducing the transport measurements

The §4 results came from a throwaway Go probe. The scratchpad is ephemeral, so
recreate it if you need to re-verify (e.g. after a Tailscale upgrade):

1. A tiny Go server on `127.0.0.1:9099` with two handlers — `/echo` returning the
   request headers as JSON, and `/ws` calling
   `websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})`
   (AO's exact options) then writing the same header dump over the socket. Add a
   `/ws-proto` variant with `Subprotocols: []string{"ao.bearer.<token>"}` to test
   §5.3. Use `github.com/coder/websocket` — already a backend dependency.
2. Expose it: `tailscale serve --bg --https=8443 http://127.0.0.1:9099`
   (**this command needs the human to run it** — it is gated for agents).
3. `curl -s https://vibebox.goose-marlin.ts.net:8443/echo -H 'Cookie: x=1'` and a
   Go `websocket.Dial` to `wss://vibebox.goose-marlin.ts.net:8443/ws` with
   `Cookie` and `Origin` headers set.
4. Tear down: `tailscale serve --https=8443 off`, and confirm
   `tailscale serve status` still shows `:443 → http://127.0.0.1:8000`.

### 11.5 If you loaded the `tailnet-web-serving` skill, read this

That skill is the house pattern for **ad-hoc** tailnet sharing: bind `0.0.0.0`,
serve a directory, hand back a plain `http://host:port/` URL. It is correct for
what it covers, and this plan **deliberately does the opposite**. Do not
"correct" the architecture toward it.

| Skill's default | This plan | Why |
| --- | --- | --- |
| Bind `0.0.0.0` | Bind `127.0.0.1` (§5.4) | Loopback is what makes the injected `Tailscale-User-Login` header trustworthy (§5.7). Binding wide would break identity auth and re-expose the socket to the container network. |
| Plain HTTP, report `http://` | HTTPS, report `https://` | TLS is real here — `tailscale serve` terminates it with the tailnet cert. The skill's "don't claim HTTPS by assumption" rule is satisfied, not violated. |
| `python3 -m http.server` on a dir | Go daemon serving an embedded SPA | This is a persistent authenticated service, not a static share. |
| Keep a process handle to stop it | Supervisor unit (§ W5) | Same intent, durable form. |

What **does** carry over and is already applied: check ports before claiming
them, never serve more than the intended content, and never silently replace an
unrelated listener. Verified 2026-08-22 — `vibebox.goose-marlin.ts.net` resolves
to `100.119.233.79`; ports **3001** (loopback API) and **3011** (LAN listener)
are both free; `:443` is in use and off-limits (§11.6 below).

The URL this build should end at, once W1 and W5 land:

```text
https://vibebox.goose-marlin.ts.net:8443/
```

### 11.6 Environment gotchas that will cost you time

- **Do not touch `tailscale serve --https=443`.** It is the user's Harness Asset
  Manager on `127.0.0.1:8000`. AO's `Serve.Apply` hardcodes `:443` and would
  clobber it — this is why `securePairing` stays off.
- **`tailscale serve --https=8443` is OFF** — the operator turned it off on
  2026-08-22 after the measurement session (it had been pointed at a now-dead
  probe on `:9099`). `tailscale serve status` now shows only
  `:443 → http://127.0.0.1:8000`, which is correct. At **G4**, a human re-applies
  `tailscale serve --bg --https=8443 http://127.0.0.1:3011` — agents cannot.
- The installed Go is **`go1.25.7`** and `go build ./...` passes on it in
  seconds, so §4's "resolves go1.26.7 automatically" and the "first build is
  slow" warning are both wrong for `go build`. `golangci-lint` v2.12.2 *does*
  pull `go1.26.7` on first run (`npm run lint`), and that step is genuinely slow
  once.
- `go1.23` is **not** available as a downloadable toolchain here — pin
  `GOTOOLCHAIN=go1.26.7` if you scaffold a throwaway module.
- This repo is **not** an npm workspace. Install per package with `npm --prefix`.
- `packages/product-ui` never needs building for the renderer (source-aliased).
  A "failed to resolve clsx" error means a missing `npm install`, not a missing
  build — the config comment at `vite.renderer.config.ts:108` says so.
- `AO_ACP_RUNTIME_DIR` or `AO_CLAUDE_ACP_COMMAND` must be set for the
  orchestrator's chat driver, or the orchestrator cannot start. Node here is
  already the pinned `v22.23.2`.

### 11.7 Open items needing a human

- ~~Re-apply `tailscale serve --https=8443 → 127.0.0.1:3011` at G4~~ — **done
  2026-08-23**; verified live from a second device (G4 passed). `:443 →
  http://127.0.0.1:8000` untouched throughout.

- ~~Decide whether `AO_CONNECT_ALLOWED_LOGINS` is just `execsumo@github` or
  wider.~~ — **decided 2026-08-22: `execsumo@github`** (single operator). An empty
  allowlist still means deny-everyone, and "any tailnet user" is still forbidden
  as a default (§5.7).

- ~~Gates G2, G4, G5, G6~~ — **passed 2026-08-23** with the operator as the
  remote-browser witness. G8 needs no human.

- ~~G8, and the two critical fixes~~ — **all done 2026-08-23** (detail in §11.1f).
  Every gate in §7 passes and both fixes are on pushed branches.

**Two decisions are open for the operator, both new as of 2026-08-23 (late):**

1. **Reboot persistence.** Nothing restarts the daemon or re-applies
   `tailscale serve` after a restart — this box has **no systemd** (PID 1 is
   `sshd`), so `deploy/ao-daemon.service` cannot be installed. The daemon runs as
   a bare `nohup ~/bin/ao daemon &`. This is the only real gap between "verified
   working" and "durable"; the fallback without systemd is a login-shell hook or
   a wrapper script. See §11.10.
2. **PR #4267's body does not mention a migration.** A reviewer now sees
   `0107_notification_turn_complete.sql` and a ledger entry appear in a PR
   described as a notification feature. The commit messages carry the reasoning;
   the body does not. Updating it (or posting a comment) is outward-facing and
   was deliberately left to the operator.

**Also live, and harmless:** one unread `turn_complete` notification
(`ntf_3959be32`, "G2 probe finished its turn") sits in the database from the
§11.10 verification probe. It is real data from a real turn, not a fixture.

**State as of 2026-08-23 (late): every gate passes, every workstream W0–W6 is
built and verified, the integration branch has been split into upstreamable
branches, five upstream PRs are open (#4266, #4267, #4309, #4312, #4313), and
**all six follow-ups are closed** (the last one, `turn_complete` observation,
found and fixed a schema bug — §11.10). Nothing is blocking.**

**Branch disposition — the decision that used to sit here — has been made and
executed.** W1–W4 were split off the integration branch, rebased where needed,
and PR'd; W5 stays fork-local as always intended.

**The local daemon was rebuilt from `deploy/all-features` and now contains
everything** (§11.9). That closed follow-up 2's blocker as a side effect — see
below.

What remains:

- ~~**PENDING VERIFICATION — the tailnet URL from a second device**~~ — ✅
  **done 2026-08-23 (late).** The operator loaded
  `https://vibebox.goose-marlin.ts.net:8443/` and the page renders correctly after
  a hard refresh. It surfaced one regression (the Open-in-editor error banner),
  **fixed in `96eaf5b4a`** — see §11.9. Keep the detail below: it is the runbook
  for the next time the binary is swapped.

  **A hard refresh is required after any rebuild** — the browser caches the
  previous hashed bundle, so the first load can show the old UI and look like the
  fix did not take.

  `~/bin/ao` was replaced and the daemon restarted on 2026-08-23 at 17:55. The
  loopback side was verified — `/healthz` and `/readyz` `200`, `3011` `401`, the
  SPA serving the real hashed bundle, both projects and all 9 sessions intact,
  and the W6 jail holding under live probes. **`tailscale serve` was not touched**
  and still shows `:8443 → 127.0.0.1:3011`. But nothing has loaded
  **`https://vibebox.goose-marlin.ts.net:8443/`** from another device since the
  swap.

  **Ask the operator to open that URL and confirm** the board renders, a terminal
  streams, and chat works. Until they do, treat the tailnet loop as *probably*
  fine rather than verified.

  If it is broken, the two most likely causes, in order:
  1. **CORS.** `AO_ALLOWED_ORIGINS` must exactly match the origin the browser
     sends. A mismatch shows as a **blank page**, not an error — this exact
     failure cost a session once (commit `6b37ee5ea`).
  2. **Port drift.** `AO_CONNECT_STRICT_PORT=1` is set, so the listener cannot
     silently move; confirm with `~/bin/ao connect status` and check
     `tailscale serve status` still points at the port it reports (§ W5).

  **Rollback, if the new build is bad:** restore **both** `~/bin/ao.prev` **and**
  `~/.ao/data/ao.db.pre-upgrade-20260823`. The binary alone is not enough —
  upstream's migrations 0104–0106 have already upgraded the live database.

- ~~**Branch deletions — waiting on the operator.**~~ ✅ **DONE 2026-08-24.** All
  containment proofs from **`~/projects/agent-orchestrator-artifacts/cleanup-report.md`**
  were re-run and re-verified first (`feat/turn-complete-followups` had drifted:
  it is now strictly an ancestor of `origin/pr/turn-complete-notification`, which
  gained the 0107 schema fix after the local branch was cut — still contained).
  Deleted local branches: `fix/tui-needs-input-notifications`, `verify/g8`,
  `test/spawn-cross-harness-e2e`, `feat/turn-complete-followups`,
  `fix/spawn-role-override-model-leak`, `delegate/w0`–`delegate/w5`. Removed the
  worktrees that held them (`w2`, `w3`, `w4`; all three clean, `.delegate/`
  artifacts already archived). The `-D` permission gate never triggered.

  **Kept deliberately:** `origin/feat/turn-complete-notifications` (+ its identical
  local twin) still differs from its PR ref in five notification/mobile files;
  `review/spawn-role-override` is tree-different from both the fix and PR refs;
  `delegate/split-w1234` has no containment proof in the report and was left
  alone; `feat/w6-remote-directory-picker`, `test/w6-directory-picker-coverage`,
  and `fix/fake-adapter-login-shell` have no PR yet; the five `pr/*` branches map
  to open PRs. Remaining worktrees: `all-features`, `w0`, `w1`, `w5`. The two idle
  delegate panes from the break were already gone.

- **Dog-fooding finding 1 — no notification when a chat-mode worker finishes
  (2026-08-24).** The operator's delegated codex worker `vibeboxui-2` completed
  two commits with no `turn_complete` notification. Verified against the live DB:
  zero rows written, so not a resolution artifact. Root cause is deliberate
  scope, not a bug: the emission guard (`lifecycle/manager.go`, ApplyActivity
  intent branch) requires `KindWorker && ModeTUI`, and `vibeboxui-2` is
  `session_mode='chat'`. PR #4267 is titled "…when a TUI worker finishes".
  Two related gaps, both product decisions for upstream, neither implemented:
  (a) whether chat-mode workers should notify at all (volume was the reason for
  the TUI-only scope); (b) there is **no worker→orchestrator notification
  channel at all** — `OrchestratorID` on the delegate outcome is bookkeeping
  metadata; nothing consumes it to ping the orchestrator session. AO
  notifications target the operator's NotificationCenter only.

  **Follow-ups decided 2026-08-24:**

  - **Drafts written, awaiting operator review/post** (outward-facing):
    `~/projects/agent-orchestrator-artifacts/pr-comments/pr-4267-chat-mode-workers.md`
    (proposes widening #4267 to chat-mode workers) and
    `~/projects/agent-orchestrator-artifacts/upstream-issue-delegate-idle-ping.md`
    (upstream issue: orchestrator learns nothing when a delegate goes idle;
    three design options, lean message-injection via the `ao send` path).
  - **Finding 1 implemented fork-local** on `deploy/all-features` commit
    `b6c4c5bf9`: dropped the `Mode == TUI` term from the emission predicate so
    any non-terminated worker notifies. Tests updated
    (`TestActivity_TurnCompletePredicate` chat cases now expect firing);
    lifecycle+notify suites green, `go vet` clean, full backend suite clean
    except a **pre-existing environmental** `crush`
    `TestCrushLocalAuthStatusDoesNotUseProviderCatalog` failure (fails with the
    change stashed too). New binary **staged but NOT deployed**:
    `~/projects/agent-orchestrator-artifacts/ao.next`. Deploying = stop daemon,
    swap `~/bin/ao`, start daemon, **hard refresh** any open tailnet tab.
    If upstream prefers a different shape on #4267, rebase this off.
  - **Finding 2 root cause addressed at the prompt layer instead (2026-08-24,
    `8a5d44791` on `deploy/all-features`).** Investigation showed ticket
    progression is: worker opens PR → autoreview coordinator sweeps and triggers
    reviewer agents → workers auto-nudged with feedback → `ready_to_merge`. The
    stall was that issue-intake workers get "open or update a pull request when
    ready" appended to their prompt (`trackerintake.intakePromptFooter`) while
    ad-hoc `DelegateTask` briefs passed through verbatim. Fix: append an
    identical footer (`delegatedPromptFooter`, kept textually in sync) to
    non-empty delegation briefs; promptless delegates stay promptless; briefs
    already carrying the contract are not doubled. Tests:
    `TestDelegateTaskAppendsCompletionContractToBrief`,
    `TestDelegateTaskDoesNotDuplicateCompletionContract`; existing spawn/attach
    expectations updated. **Binary rebuilt (frontend build:web FIRST per §11.9)
    and staged at `~/projects/agent-orchestrator-artifacts/ao.next` — NOT yet
    deployed; needs a daemon restart to take effect.** Upstream candidate once
    proven live: small PR aligning delegation with intake.
    Test-writing gotcha recorded: `fakeCommander.spawnedCfg` is last-write-wins;
    with no orchestrator seeded in the fake store, DelegateTask spawns a
    coordinator second and clobbers the captured worker config — seed an
    orchestrator session in delegate tests.
  - **⚠️ THE `8a5d44791` FIX WAS ON THE WRONG PATH — corrected 2026-08-25 in
    `7b4169ad8` (`deploy/all-features`).** Dog-fooding caught it: worker
    `vibeboxui-4` was spawned by the orchestrator at 14:41 on the deployed
    build and its delivered first user turn is **1305 B — the brief verbatim,
    no footer** (a footered prompt is 1427 B; the footer is 122 B). Verified in
    the DB, not inferred:
    `select count(*) from conversation_messages m join conversations c on
    c.id=m.conversation_id where c.session_id='vibeboxui-4' and m.text like
    '%open or update a pull request%'` → `0`. Note `strings ~/bin/ao | grep -c`
    on the footer text returns `1`, not `2`, and proves nothing either way —
    Go dedupes the two byte-identical literals.

    **Cause.** `delegatedPromptFooter` lived inside `DelegateTask`, reachable
    only from `POST /api/v1/orchestrators/delegate` — which **no CLI command
    calls**; it is the renderer's `TaskComposer`, i.e. the human→AO path. An
    orchestrator agent delegates with `ao spawn --prompt` (its own system
    prompt says so, `session_manager/prompt.go:190`) → `POST /api/v1/sessions`
    → `Svc.Spawn`, which passed the brief through untouched. The fix closed the
    intake↔composer asymmetry and left orchestrator→worker, the one #4337 was
    about, exactly as it was.

    **Fix.** `withCompletionContract(prompt, kind)` in `delegation.go`, called
    from both `s.spawn` (after `withIssueContext`) and `DelegateTask`.
    Orchestrator spawns exempt, promptless stays promptless, no doubling on a
    prompt that already carries it. Tests:
    `TestSpawnAppendsCompletionContractToWorkerPrompt` (explicit `worker` **and**
    empty kind — `ao spawn` sends `""`),
    `TestSpawnLeavesOrchestratorPromptAlone`,
    `TestSpawnPromptlessWorkerStaysPromptless`,
    `TestSpawnDoesNotDuplicateCompletionContract`. `go vet` clean, full backend
    suite green except the known environmental `crush` failure.
    **✅ DEPLOYED 2026-08-25 ~01:48.** `ao stop`, `~/bin/ao` swapped to the
    `7b4169ad8` build, daemon restarted with the §11.1a env in full (incl.
    `AO_FS_ROOTS`), log at `/tmp/ao-daemon.log`. **Rollback binary:
    `~/bin/ao.pre-7b4169ad8`.** No DB backup taken and none needed — this build
    is the previous one plus a single Go-only commit, no new migrations.
    Verified live: `/healthz` `200`, `/readyz` `200`, bridge `3011` `401`, `/`
    serving the real hashed bundle (`assets/index-Da65qtTv.js` `200` — same
    hash, the frontend is untouched), jail uniform `404` on both `/etc` and a
    `../../` traversal, **all 14 sessions intact**. `tailscale serve :8443`
    untouched. A hard refresh is required in any open tailnet tab. The
    orchestrator the operator was mid-conversation with (`vibeboxui-3`) came
    back `idle`, not terminated — session rows survive a restart whether or not
    the agent relaunches, so check process state, not `count(*)`. The log's two
    `restore-all: workspace restore failed` ERRORs (`ao-g2-scratch-3`, `-8`) are
    **not** from this deploy: both sessions are already terminated and their
    project is archived (`project repo not resolvable`). §11.9 recorded the
    first one before this build existed.

    **Who else comes through the widened seam (checked, 2026-08-25).** The
    append sits in `s.spawn`, so every caller of the session service's `Spawn`
    inherits it. There are three, and none regress: the spawn controller
    (`sessions.go:275`, the intended target); `trackerintake/observer.go:206`,
    whose `BuildIssuePrompt` already ends with the identical footer
    (`observer.go:288`, unconditional) so the dedupe guard absorbs it, including
    the truncation branch which re-appends the footer after the notice; and
    nothing else. **Reviewer agents do not come through here** — `autoreview`
    contains no `Spawn` at all, and `review/review.go:379` goes through
    `review.Launcher` with its own `LaunchSpec` type, never `ports.SpawnConfig`.
    That was the regression to rule out: a reviewer told to open a PR. If a
    future caller needs a worker spawn *without* the contract, gate on a new
    `SpawnConfig` field rather than loosening the `Kind` check.

    **Confound — do not over-read the `vibeboxui-4` observation.** That brief
    told the worker to `merge --ff-only` and push `master` directly. Even with
    the footer the prompt would have ended in two contradicting sentences, and
    the worker had already been told to resolve in favor of the brief. The path
    gap is real and structural; this one session had a second sufficient cause.
    The system prompt still tells freeform/orchestrator-requested workers not
    to invent PR requirements (`system.md:20`) — the task footer now overrides
    it for delegated work, which is a task-layer/system-layer tension left
    standing deliberately. Fixing it at the system layer instead was the
    considered alternative; the operator chose the shared-helper shape
    2026-08-25.

    **#4337 was closed on this unverified fix** and its own "remaining
    verification" line was never satisfied. Reopen or comment before proposing
    anything upstream; the upstream-candidate PR is now the two-path helper,
    not the `DelegateTask`-only footer. The correction owed on the posted
    comment is drafted in `docs/upstream-correspondence-2026-08-24.md` — **not
    posted**; posting is the operator's call.

    **✅ FOOTER DELIVERY CONFIRMED LIVE (2026-08-25 03:51, `vibeboxui-5`).**
    First delegated worker on the `7b4169ad8` build: delivered first user turn
    **1601 B, ending in the footer**, and the `like '%open or update a pull
    request when ready%'` count is **`1`** where `vibeboxui-4` returned `0`.
    The two-path fix works. That is the whole of what this check proves — see
    the two items below for what it does not.

- **🐞 DEFECT INTRODUCED BY `7b4169ad8` — the footer contradicts explicit
  no-PR briefs (found live 2026-08-25, `vibeboxui-5`).** The append is
  unconditional, so an ops delegation whose brief ends —

  > `- Do not commit, push, or open a PR.`

  — now has AO append `"…and open or update a pull request when ready."`
  directly after it. The worker got two opposite instructions in one prompt.
  It resolved in favour of the brief (correct) and did the serve task, but
  that is the worker being sensible, not the prompt being right.

  **Do not fix this by matching the brief's text for "do not open a PR"** —
  briefs phrase it a dozen ways and a false negative is silent. The seam is an
  explicit opt-out at the delegation boundary: a `SpawnConfig` field with an
  `ao spawn --no-pr` flag in front of it, and a line in the orchestrator prompt
  (`session_manager/prompt.go`, Core Commands) telling it to pass that flag for
  ops/no-code tasks. That is the same "gate on a field, not on the `Kind`
  check" note the caller-inventory item above already anticipated. **Not built
  — the operator has chosen the shape on both prior rounds; ask.**

- **🎯 THE ACTUAL CAUSE of "the worker finished but still sits in
  Idle/Working" — it was never the prompt (found 2026-08-25).** Two cycles of
  completion-contract work were spent on a real gap that is *not* what the
  operator kept observing. The board zone is derived in
  `packages/product-ui/src/session-presentation.ts:234` and reads:

  ```typescript
  case "working":
  case "idle":
      return "working";
  ```

  **`idle` and `working` map to the same lane.** A worker that has finished is
  rendered identically to one still running. The only exits from that column
  are `terminated` → `done`, or PR facts → `pending`/`merge`. *Finishing the
  work is not one of them.* No prompt change can move a session out of Working;
  only a PR or a kill can.

  `turn_complete` **did** fire for `vibeboxui-5` at 03:55:46 ("serve vibeboxUI
  finished its turn", unread). So the completion signal exists and reaches the
  bell — it just has no representation on the board.

  **Do not "fix" this by rendering `idle` as done.** Upstream removed exactly
  that inference in #3257 because *idle does not mean done*, and our own #4337
  closing comment cites that history approvingly
  (`docs/upstream-correspondence-2026-08-24.md`). Any change here is a product
  decision about a fifth state ("finished, nothing to review"), not a bug fix,
  and it needs the operator and probably an upstream discussion.

- **⚠️ THE PIPELINE VERIFICATION IS STILL NOT DONE.** It has now slipped three
  cycles, and the footer check above does **not** discharge it. All three
  dog-fooded delegations were tasks that cannot produce a PR: `vibeboxui-2`
  (killed), `vibeboxui-4` (fast-forward and push `master` directly),
  `vibeboxui-5` (serve a directory, "no code changes", "do not open a PR").
  A no-PR task cannot exercise auto-review or lane progression **by
  construction**. The test that would actually settle it: delegate a **code
  change** with **no PR prohibition in the brief**, then watch for the PR, the
  `autoreview` sweep (~1 min), the reviewer agent, and `ready_to_merge`.

  **✅ THE PIPELINE RAN END TO END, 2026-08-25 ~04:16 — first time ever on
  this box.** Before this, `pr` and `review_run` were both empty across all
  four projects, all time. Not "broken": never exercised. The run:

  | Time | Fact |
  | --- | --- |
  | 04:16:19 | worker `vibeboxui-6` opens PR #1, `ao/vibeboxui-6/ipv6-formatting` → `master`; `turn_complete` fires |
  | ~04:17 | `autoreview` sweeps the open PR |
  | 04:18:01 | codex reviewer completes, `verdict = approved`, GitHub review `5014916684` |
  | | board card reaches **Ready to Merge** (`mergeability = mergeable`) |

  Under two minutes from the worker finishing to an approved review. **The
  ticket-progression table below is now observed, not just read out of the
  code.**

  **What made it work was the brief, not the plumbing.** The task was written
  by the human into the New-task composer — a real bug fix, no PR prohibition,
  nothing about PRs at all. That is exactly the macOS shape. Every previously
  stalled delegation was an orchestrator-authored brief that forbade or
  bypassed a PR.

  **The footer was load-bearing in that run — do not roll it back.** Checked
  when the question came up: `vibeboxui-6`'s delivered prompt is 871 B and
  **ends in the completion contract** (like-count `1`), and the session is
  **not issue-backed** (`issue_id` empty), so it was freeform work through the
  composer — a path that has carried the footer since `8a5d44791`. The human's
  brief said nothing about PRs. Meanwhile the worker's own standing rules for
  freeform work (`system.md:20`) say *"do not invent issue, PR, or MR
  requirements"*. So the only instruction in that entire prompt telling the
  worker to open a PR was the footer, and the standing rules pointed the other
  way. One run is not proof of the counterfactual, but the balance is clear.

  **What was wrong was the attribution, not the work.** The footer was sold as
  the fix for "a delegated worker sits in Working forever" (#4337). It is not:
  the board conflates `idle` and `working` regardless (see the board-zone item
  below). What it actually does is make *freeform* delegated work PR-shaped,
  which is the precondition for entering auto-review at all — and therefore the
  only way a card ever leaves the Working lane short of termination. That is a
  real function, and it is the honest upstream pitch: intake prompts carry the
  contract, delegation briefs did not, so orchestrated work never reached the
  review pipeline. Cleaner than the argument actually posted on #4337.

  This also reconciles the macOS recollection: upstream *does* have
  `trackerintake.intakePromptFooter`, so issue-backed tasks there always
  carried the contract. Freeform composer tasks on that build would not have —
  which is consistent with the Mac tasks that progressed having been
  issue-backed, or having asked for a PR in the human's own words.

  **⚠️ The board and the bell disagree, by design — know this before chasing
  it.** No `ready_to_merge` notification fired for PR #1, only `turn_complete`.
  `MergeReadiness.ReadyToMerge()` (`domain/pr.go:218`) treats `CIUnknown` as a
  blocker — "AO only claims readiness it can actually prove" — and vibeboxUI
  has no CI workflows, so `ci_state = unknown`. The board lane derives from the
  looser session-status read model (`mergeability = mergeable` → `merge` zone),
  so the card shows Ready to Merge while the notification rule refuses to. On a
  repo with no CI the bell will never ring for readiness. Not a defect
  introduced here; both rules are defensible; they are just not the same rule.
  (`review_decision` also stayed `none` despite the approval — GitHub does not
  count the repo owner's own review toward `reviewDecision`.)

- **Prompt generation is platform-independent — checked 2026-08-25.** The
  operator recalled delegated tasks reaching Ready to Merge in the macOS app
  and asked whether its instructions differ. They do not.
  `session_manager/prompt.go` is a single implementation with **no `GOOS` or
  `darwin` branch and no build-tagged variants** (the one `platform` match at
  `prompt.go:269` is prose about the SCM platform). The Electron shell composes
  no prompts; `TaskComposer.tsx:251` sends `brief: prompt` — the typed text
  verbatim. The only prompt text that varies by anything is `## Project Rules` /
  `## Project-Specific Orchestrator Rules` from project config, and **no
  project in this DB has any configured**, so even that is identical.

  What actually differed on the Mac was **who wrote the brief**: the New-task
  composer sends the human's own words, and a human asking for a code change
  does not append "do not open a PR". Here an orchestrator agent composes the
  brief with no brief-writing guidance in its prompt. Note the corollary —
  upstream has neither footer, so the Mac's briefs had no completion contract
  either and still produced PRs. **The footer was never what made that work.**

  Project difference worth fixing regardless: `vibeboxui` had **no
  `defaultBranch`** in its config (the orchestrator prompt rendered "Default
  branch: not configured"); `ao-g2-scratch` has `master`. `autoReview` was
  already `true`.

  **Fixed 2026-08-25:** `ao project set-config vibeboxui --config-json …` with
  `"defaultBranch":"master"` added. Note `set-config` **replaces** the config
  rather than merging — pass the whole object via `--config-json` or the agent
  overrides and `autoReview` are silently dropped. Read back and confirmed
  intact. Other prerequisites verified the same day: `gh` authed as `execsumo`
  with `repo` scope, `execsumo/vibeboxUI` reachable, its GitHub default branch
  is `master` (so the config now matches the remote).
  - **✅ (SUPERSEDED — see above) ISSUE CONSIDERED ADDRESSED (2026-08-24 ~06:35).** The `8a5d44791` build
    is deployed (`~/bin/ao` swapped, daemon restarted with the full env incl.
    `AO_FS_ROOTS`; healthz/readyz `200`, hashed bundle `200`, jail uniform
    `404`, all 12 sessions intact). Rollback binary:
    `~/bin/ao.pre-b6c4c5bf9`. **#4337 closed** with a comment giving maintainers
    the honest arc: history (#2836→#3038→#3257) acknowledged, root cause
    identified as prompt asymmetry between intake and delegation, better path
    taken fork-side. No upstream PR for the footer yet — propose only after it
    proves itself live in dog-fooding. Remaining verification: delegate a real
    task and confirm the worker opens its PR before idling and lanes progress
    via auto-review.
  - **Deployed 2026-08-24 ~05:08.** Drafts were posted by the operator's
    instruction: [#4267 comment](https://github.com/Untrivial-ai/agent-orchestrator/pull/4267#issuecomment-5390966941)
    and [issue #4337](https://github.com/Untrivial-ai/agent-orchestrator/issues/4337).
    `~/bin/ao` swapped to the `b6c4c5bf9` build and the daemon restarted with its
    exact prior env (bind 127.0.0.1, strict port, identity trust, allowlist,
    origins, ACP wrapper) and log (`/tmp/ao-daemon.log`). Verified: healthz/readyz
    `200`, bridge enabled on 3011, `tailscale serve :8443` untouched, all 12
    sessions intact. **Rollback binary: `~/bin/ao.pre-b6c4c5bf9`.** A hard
    refresh is required in any open tailnet tab.

    ⚠️ **First swap shipped a blank page — cause and fix (2026-08-24 ~05:20).**
    The `b6c4c5bf9` binary was built without `frontend build:web` first, so it
    embedded the tracked placeholder `dist/index.html` (`/index.js` → 404) —
    exactly §11.9's "build order matters" warning. Rebuilt correctly:
    `npm run build:web` in the worktree's frontend, then `go build`; daemon
    re-swapped and re-verified: `/` serves the real hashed bundle
    (`/assets/index-Da65qtTv.js`, 1.5 MB, `200`), jail returns uniform `404`,
    all 12 sessions intact. **The restart also restored `AO_FS_ROOTS=/home/dev/projects`,
    which the first restart had silently dropped** (it was not visible in the
    truncated `/proc/<pid>/environ` capture) — without it W6's picker is inert.
    The full env list for future restarts is in this section; always include
    `AO_FS_ROOTS`. Placeholder `dist/index.html` restored per §11.9. **Next step for whoever picks
    this up: check the #4267 comment and #4337 conversation before further
    notification work** — if maintainers pick a different shape for either
    finding, rebase or revert the local commit accordingly; finding 2 stays
    unimplemented until #4337 lands a direction.
- **Dog-fooding finding 2 — merging is never automatic (2026-08-24).** A worker
  commits to its own `ao/<project>/<session>/root` branch; nothing merges to the
  default branch by itself. The designed path is: open a PR (the orchestrator
  can instruct the worker), AO then *observes* PR/check/comment facts
  (`docs/architecture.md` PR pipeline), review flow gates, and a human or
  orchestrator-driven step performs the merge. "The orchestrator missed the
  merge" is therefore expected behavior today, not a dropped duty.

  #### Ticket progression — who owns each transition (verified in code 2026-08-24)

  | Transition | Owner | Mechanism |
  | --- | --- | --- |
  | work → commits | Worker | its task |
  | commits → PR | **Worker, only if told** | issue-intake prompts get it baked in (`trackerintake` footer); delegated workers via `delegatedPromptFooter` — on the composer path since `8a5d44791`, on the `ao spawn` path (how orchestrators actually delegate) only since `7b4169ad8` |
  | PR → In Review | **Fully automatic** | `autoreview` coordinator sweeps (~1 min), triggers a reviewer agent (`backend/internal/autoreview/coordinator.go`) |
  | review feedback → fixes | Worker, auto-nudged | `lifecycle/reactions.go` delivers review results as worker nudges |
  | Ready to Merge | derived fact + bell | CI green + approved review → `ready_to_merge` notification |
  | merge | human (or orchestrator if asked) | explicit act |

  Board lanes are **derived at read time** from durable facts (activity state,
  PR/check/review facts) — nobody "moves" a ticket. The two prompt layers:
  everything workers share (role, orchestrator link, multi-PR branch
  conventions, container labels, project rules) is injected at the SYSTEM-prompt
  layer for all spawns (`session_manager/prompt.go buildSystemPromptText`); the
  completion contract was the only TASK-prompt delta between intake and
  delegation, now closed.
- **PR #4267 body updated 2026-08-24** with the migration section the reviewer
  needed (0107 story, table rebuild, down-migration data loss, version-107
  ledger rationale). That closes the second open operator decision from this
  section's earlier revision. **Both posted texts are archived in-repo at
  `docs/upstream-correspondence-2026-08-24.md`** — the working drafts in
  `~/projects/agent-orchestrator-artifacts/` are outside git and must not be
  the only copy.
- **W3's PR is queued behind #4312, deliberately.**
  `pr/project-creation-web-fallback` is stacked on `pr/renderer-bridge-capabilities`.
  A cross-fork PR cannot target a base that exists only on the fork, so opening it
  against `main` today would put the whole W0+W2 capability refactor into its diff
  a second time — the exact duplication a correction round removed. Once #4312
  merges, rebase onto the new `upstream/main` and open it; it is then five files.

- **W6 — remote directory picker.** ✅ **BUILT 2026-08-23** on
  `feat/w6-remote-directory-picker` (off the integration branch, 1 commit,
  pushed). **It is in no PR and cannot go upstream until the integration branch
  is split** — see branch disposition above. Do not assume it is queued behind
  #4266/#4267.

  **Jail design** (`backend/internal/fsjail`): reject `..` segments and NUL bytes
  **lexically, before any filesystem access** → resolve every symlink with
  `EvalSymlinks` → **only then** check containment with `filepath.Rel`. That
  ordering is the entire security property. Every failure — outside-root,
  missing, unreadable, symlink escape — returns one uniform
  `404 FILESYSTEM_PATH_UNAVAILABLE` carrying no path, so there is no path oracle.
  `AO_FS_ROOTS` is empty by default and **an empty root list denies everything**:
  the feature is off unless deliberately configured.

  **Verified by mutation, not by the delegate's report.** Inverting the ordering
  to check containment on the lexical path first makes an escaping symlink return
  **`200` with the outside directory's contents** — caught at both the jail level
  (`TestResolveChecksSymlinksBeforeContainment`) and the HTTP level
  (`TestFilesystemListJailSecurityProperties`, which additionally asserts every
  hostile response is byte-identical to the others). `npm run api` re-run leaves
  the tree clean. Renderer vitest **160 files / 2309 passed**, e2e **26 passed**,
  `go vet` clean, backend suite clean apart from the known fake-adapter failure
  (this branch predates the fix for it).

  **The `lanControlBlockedPrefixes` call was made explicitly rather than by
  omission:** `/api/v1/fs` is **not** blocked, because the SPA is served from the
  LAN listener and blocking it there would make the feature unusable; the routes
  are not daemon-control routes and stay behind LAN auth plus the jail. A test
  asserts they remain reachable, pinning the decision.

  Remaining W6 gap: the picker dialog's own test coverage — see follow-up 6.

- **Agent-runnable follow-ups, none urgent** — each is recorded in full where it
  belongs, listed here only so they are not lost:
  1. ~~No test drives `Manager.Spawn` end to end with a cross-harness role
     override~~ — ✅ **done 2026-08-23.**
     `TestSpawn_CrossHarnessRoleOverride` drives `Manager.Spawn` and asserts on
     the **durable store row and the launch config the adapter received**, not
     on `effectiveAgentConfig`'s return value. Pushed onto the PR branch
     `pr/spawn-role-override-harness-scope` (upstream PR #4266).
     Orchestrator-verified with **two independent mutations**: forcing the
     override to apply regardless of harness fails with
     `cross-harness durable metadata model = "codex-model"`, and reintroducing
     the permission early-return fails with
     `cross-harness launch config permissions = "auto"`. Two distinct
     assertions, two distinct messages — the test cannot pass vacuously.
  2. ~~`turn_complete` has never been observed firing~~ — ✅ **observed
     2026-08-23 (late), and the observation found a real bug. See §11.10.**
     It fires exactly once per turn, and the volume is self-limiting. The
     historical note below is kept because it explains why this sat open: This item used to need an operator decision
     because observing it meant running a daemon built from a branch, and the
     live daemon was built from the integration branch which lacked the feature.
     **The daemon running now was built from `deploy/all-features` and contains
     `turn_complete`** (§11.9), so no rebuild, no second daemon, and no
     disruption is needed.

     What is left is pure observation: use a TUI worker normally and watch
     whether a `turn_complete` notification fires once per turn, and whether the
     per-turn volume is tolerable (§11.1f). Confirm with
     `curl -s http://127.0.0.1:3001/api/v1/notifications`, which reads `{"notifications":[],...}`
     on an idle box. If the volume is annoying, that is a **product** judgement
     for upstream PR #4267, not a bug.
  3. ~~`NotificationCenter.tsx`'s new label/icon mapping has no direct test~~ —
     ✅ **done 2026-08-23**, pushed onto `pr/turn-complete-notification`
     (upstream PR #4267). Mutation-verified: deleting the `turn_complete` label
     and icon-class cases fails with
     `Unable to find a label with the text of: Turn complete`. The tests assert
     the **rendered** translated label and the routing, not that `t()` was
     called, and one pins the decided behaviour that a terminated session behind
     a `turn_complete` stays viewable rather than being gated behind restore.
  4. ~~`internal/adapters/agent/fake:TestFullLifecycleSpawnToTermination` fails
     on this box because of `sh -lc` plus `~/bin/ao`~~ — ✅ **fixed 2026-08-23**
     on `fix/fake-adapter-login-shell` (off `main`, 1 commit, pushed, no PR).
     It turned out to be more than a test artifact: `HookPATH` deliberately pins
     a spawned session's PATH with the daemon executable's directory **first**,
     so `ao hooks fake …` resolves to the daemon that spawned the session — it
     even refuses to build the pin when the executable is not named `ao`.
     `sh -lc` sources the login profile, which can prepend other directories
     ahead of that pin and redirect the hook to a **different `ao` binary**. So
     the failing test was the symptom of a real (narrow) production issue.
     `TestGetLaunchCommandIsScriptedTimeline` pinned the `-lc` shape and was
     updated with the reason. **`qwen` also uses `sh -lc` and was deliberately
     left alone** — a real agent may legitimately want a login shell for
     version-manager shims; that is a separate judgement for upstream.
  5. ~~`packages/mobile` could render a `turn_complete` case~~ — ✅ **done
     2026-08-23**, same branch and PR. The delegate found **two things outside
     the brief**, both real: `packages/mobile/lib/api.ts` carries its own
     `NotificationType` union that also had to learn the kind, and
     `notificationTarget` routed `turn_complete` to `/prs` — it is a **session**
     notification, so that was a live misrouting bug in the Expo app, not merely
     a missing case.

     `i18n/messages.ts` was left untouched this time and the English strings went
     into all eight catalogs — the §11.1d lesson landed.
     **Not verified here:** the `check-circle` Feather glyph name. It is
     compiler-enforced at `Feather name={v.icon}` whenever `packages/mobile` is
     built, and it is a real Feather icon, but that package has no
     `node_modules` on this box so nothing checked it locally.

  6. ~~`DirectoryPickerDialog.tsx` is 201 lines with exactly ONE test~~ — ✅
     **done 2026-08-23.** The file now has **13 tests** (was 1), on
     `test/w6-directory-picker-coverage` (off `feat/w6-remote-directory-picker`,
     one commit `22719c53d`, **pushed 2026-08-23 (late)**).

     Covers both `unavailable` paths — the request-error branch and the `.catch`
     branch are separate code — plus `empty`, `loading`, `roots`, `back`,
     `inaccessible`, `hidden`, `selectCurrent`, path-scoped navigation requests,
     non-navigable file entries, and the `disabled` prop. The `back` test drives
     two levels deep on purpose: `goBack` calls `setCurrentPath` **inside** a
     `setHistory` updater, which StrictMode double-invokes.

     **Orchestrator-verified by an independent mutation**, not by the delegate's
     report: changing `goBack` to jump to the root instead of popping one level
     fails exactly one test — `disables back at roots and returns two levels to
     the previous paths` — and reverts clean. The delegate additionally reported
     a mutation per test with a distinct failure message for each.

- **Housekeeping.** Worktrees at the break: `w0` `feat/turn-complete-notifications`,
  `w1` `feat/w6-remote-directory-picker`, `w2` `fix/spawn-role-override-model-leak`,
  `w3` `feat/turn-complete-followups`, `w4` `test/spawn-cross-harness-e2e`,
  `w5` `fix/fake-adapter-login-shell`, `split-w1234` `delegate/split-w1234` (the
  branch-split and rebase delegate — its `.delegate/` holds the cleanup report and
  the PR-body drafts), and `w6-picker-tests` `test/w6-directory-picker-coverage`.

  Two delegate panes were left **idle and alive** at the break (`wB:pT` split/rebase,
  `wB:pV` picker tests) so their context survives; closing them is free.

### 11.8 Upstream drift, and what a build with everything would take

Recorded 2026-08-23 (late). Nothing else in this file knows these facts, and they
change what "cut a branch from `main`" means.

**`main` is 24 commits behind `upstream/main` and 0 ahead** — a clean
fast-forward. Fast-forwarding it is safe, but be clear about what it does *not*
do: it does not touch the integration branch, does not affect any open PR (those
live on `origin` and three are already rebased onto `upstream/main`), and does not
change `~/bin/ao`. On its own it gives you nothing until you rebuild — and
rebuilding from `main` alone loses all of W0–W5.

Upstream's newer work overlaps this project in **28 files**, but only **10 of them
actually conflict**: `BrowserPanel.tsx`, `ShellTopbar.tsx`, and the eight locale
catalogs. Everything else — including `lan_listener.go`, `auth.go`,
`openapi.yaml`, `schema.ts`, `bridge.ts`, `Sidebar.tsx`, `_shell.tsx` —
auto-merges. Upstream's only change to `lan_listener.go` is a one-line
`/api/v1/desktop` addition to `lanControlBlockedPrefixes`, which is semantically
compatible with W1's decision about that list. **W1 needed no rework.**

Both conflicting components were resolved during the split, and those decisions
are recorded in the PR bodies for #4312 and #4313. In short: upstream's
device-preset picker sits inside the component W2 renames to
`NativeBrowserPanelView`, so it is capability-gated by construction; and
upstream's `TopbarKillError` → `TopbarActionError` rename applies only at the two
call sites W4 does not delete.

#### What runs locally today

`~/bin/ao` is the integration branch: **W0–W5 only**. Opening PRs changed nothing
about it — a PR is a proposal to upstream, not a local install. Missing locally:
W6, the picker tests, `turn_complete`, both fixes, and all 24 upstream commits.

#### The everything-build, if it is ever wanted

Base it on **`upstream/main`**, not on the integration branch. Verified with
`git merge-tree`, every one of these applies **cleanly** to `upstream/main`:

- `pr/webui-lan-serving` (W1)
- `pr/renderer-bridge-capabilities` (W0+W2) — already rebased onto it
- `pr/project-creation-web-fallback` (W3) — stacked on the above
- `pr/orchestrator-destination` (W4) — already rebased onto it
- `origin/pr/spawn-role-override-harness-scope` and `origin/pr/turn-complete-notification`
- `fix/fake-adapter-login-shell`
- W5's files — upstream never touches `deploy/` or W5's `docs/` paths, so the
  fork-local deployment glue drops straight in

**Two need work.** `feat/w6-remote-directory-picker` conflicts on `upstream/main`
in exactly the ten files listed above — not because W6 is hard, but because it was
cut from the integration branch and carries the pre-rebase W0–W4 content. Re-cut
it on top of the rebased capabilities branch and its own contribution (`fsjail`,
the picker, the `/api/v1/fs` routes) applies clean. `test/w6-directory-picker-coverage`
then rides along on top of it.

Do **not** try to assemble this by merging the rebased `pr/*` branches back into
the integration branch. They now carry upstream's newer files and the integration
branch does not, so that direction conflicts in `BrowserPanel.tsx`,
`ShellTopbar.tsx` and all eight catalogs. Rebase the integration branch, or build
from `upstream/main` — never merge backwards.

### 11.9 `deploy/all-features` — the branch the local daemon now runs

Built 2026-08-23 (late), on the operator's instruction to replace the binary and
restart. **This is what `~/bin/ao` is now built from**, superseding §11.1a2's
"integration branch, W0–W5 only".

**Branch `deploy/all-features`** (head `2795115b6`, pushed), worktree at
`../agent-orchestrator-worktrees/all-features`. It is `upstream/main` plus, in
order: `pr/webui-lan-serving`, `pr/project-creation-web-fallback` (carrying W0+W2
and W3), `pr/orchestrator-destination`, `origin/pr/spawn-role-override-harness-scope`,
`origin/pr/turn-complete-notification`, `fix/fake-adapter-login-shell`, then
cherry-picks of W6 (`762a630f9`) and the picker tests (`22719c53d`), then one
commit restoring W5's six fork-local files.

**Every step applied with zero conflicts.** The earlier worry that W6 conflicts on
`upstream/main` was about W6's *branch*, which drags pre-rebase W0–W4 content; its
*commit* cherry-picks clean once W3 is present. This is the assembly order to
reuse.

**Verification (orchestrator-run, box quiet, serialized):** `frontend:typecheck`
clean · `go build ./...` and `go vet ./...` clean · renderer vitest **166 files /
2412 passed, 1 skipped** · `test:e2e:renderer` **26 passed** ·
`internal/adapters/agent/fake:TestFullLifecycleSpawnToTermination` **now passes**
(the `sh -lc` → `sh -c` fix works).

⚠️ **One backend test fails, and it is NOT ours:**
`internal/adapters/agent/crush:TestCrushLocalAuthStatusDoesNotUseProviderCatalog`
(`status = ("authorized", true), want ("unknown", false)`). It fails identically
on a clean `upstream/main` worktree, and this branch never touches
`backend/internal/adapters/agent/crush/`. Environmental, like the fake-adapter
failure was. **Do not send an agent to fix it.**

#### Build order matters

`dist/` is gitignored except `index.html`, which is tracked as a **placeholder** so
`//go:embed all:dist` compiles. Build the binary without building the bundle first
and the daemon serves a page requesting `/index.js` → 404 → **blank page**.

```bash
cd frontend && npm run build:web     # NOT a root script; it lives in frontend/package.json
cd ../backend && go build -o ~/bin/ao ./cmd/ao
```

Afterwards `dist/index.html` shows as modified — that is the real artifact over the
stub. **`git checkout --` it; never commit it.**

#### Live state after the swap

- `~/bin/ao` rebuilt 17:52; **rollback binary at `~/bin/ao.prev`**.
- **DB backed up at `~/.ao/data/ao.db.pre-upgrade-20260823`**, taken *after* a
  clean `ao stop` so the WAL was checkpointed. This mattered: upstream's 24
  commits add migrations **0104, 0105, 0106**, so the new binary migrates
  `ao.db` on first start and the old binary may not reopen it. Restoring means
  putting back **both** the binary and the DB.
- Daemon restarted with the §11.1a env **plus `AO_FS_ROOTS=/home/dev/projects`**,
  which is what makes W6 usable — an empty root list denies everything, so
  without it the picker is present but inert. Remove the variable to turn it off.
- Verified live: `/healthz` and `/readyz` `200`, `3011` `401`, SPA serving the
  real hashed bundle (no `/index.js` refs), both projects and all 9 sessions
  intact, and the jail holding — `/etc` and a `../..` traversal both return the
  uniform `404`, a legitimate root listing returns `200`.
- Known, pre-existing: `restore-all: relaunch failed` for `ao-g2-scratch-3`
  (codex chat rollout missing) — the G7 codex chat-restore follow-up, not new.

**Verified by the operator 2026-08-23 (late):** the tailnet URL loads from a second
device and the page renders correctly after a hard refresh.

#### ⚠️ The rebuild shipped one regression. It is fixed — do not reintroduce it.

On first load from the tailnet, **every session view showed "Desktop app is
required to open a workspace"** in the topbar. Fixed in `96eaf5b4a` on
`deploy/all-features`; the operator confirmed the page is clean after a refresh.

**Cause.** Upstream's Open-in-editor button (#3284) is new — it does not exist on
the integration branch, which is why this never appeared before the rebuild. It
renders a persistent `TopbarActionError` whenever the bridge reports
`workspaceAvailable: false`, and `bridge.ts`'s browser stub reports exactly that,
unconditionally. So a non-error condition — "this is a browser" — rendered as a
permanent error banner on every session.

**This was a known, deliberate deferral that came due.** W4 was rebased with that
button **ungated on purpose**: `pr/orchestrator-destination` carries no capability
contract, so it has nothing to gate with, and PR #4313's body names the gating as
a follow-up for whoever lands both. On `deploy/all-features` the contract **is**
present, so the gate belonged here and was missed.

**Fix.** A `nativeEditorHandoff` capability on `AoCapabilities` — `true` in the
Electron preload, `false` in the web bridge — with the render site in
`ShellTopbar.tsx` gated on it. The button is **absent** in a browser rather than
present-and-erroring, matching W2's pattern for desktop-only surfaces.

**The first regression test for it was vacuous, and the suite did not say so.**
It asserted on a message the test bridge stub never produces (`setup.ts` returns
`workspaceAvailable: true`) plus a role query whose regex matched nothing. It
passed with the gate removed. The rewritten test asserts the **absence of the
split button's `"Open workspace options"` dropdown trigger**, which renders
whenever the component renders at all — so its absence proves the whole button
was suppressed rather than merely disabled. Mutation-verified: dropping the gate
fails with `expected <button …> to be null`.

That is the fourth vacuous-green on this project. **Run the mutation. The pass
count is not evidence.**

**Anything else that consumes `AoCapabilities` must learn new keys too** — five
test files construct the object literally (`preload.test.ts`, `bridge.test.ts`,
`setup.ts`, `board-empty-states.test.tsx`, `shell-new-session-shortcut.test.tsx`).
`tsc` catches a missing key; it will not catch a *wrong* value.

Post-fix verification: renderer vitest **166 files / 2414 passed, 1 skipped**,
typecheck clean, daemon rebuilt and restarted 20:44 serving `index-Da65qtTv.js`,
all 9 sessions intact.

#### Delegate artifacts

Panes and worktrees are torn down. The cleanup report, the audit report, the four
PR-body drafts and the two correction briefs are archived at
**`~/projects/agent-orchestrator-artifacts/`**.

The audit reported 12 PRESENT / 0 MISSING / 1 WRONG. **The one "WRONG" was a false
positive** caused by this file's own checklist wording: `TerminalPane.tsx` does
still early-return a mock terminal, but keyed on `usesPreviewWorkspaceData`
(`VITE_AO_PREVIEW_DATA === "1"`, an explicit opt-in) rather than on Electron
absence — which is exactly what W0 changed. `build:web` sets `VITE_AO_WEB=1`, not
that flag, and the string `a live PTY here in the desktop app` appears **0 times**
in the shipped bundle. The fake terminal cannot render in the web build.

### 11.10 `turn_complete` observed — and the schema bug the observation found

Recorded 2026-08-23 (late). §11.7 follow-up 2 asked two questions that only a
live daemon could answer: does `turn_complete` actually fire, and is the
per-turn volume tolerable. Both are now answered, and answering them surfaced a
defect that every test suite had missed.

#### What the observation found

Driving a real turn on `ao-g2-scratch-1` (`kind=worker`, `mode=tui`,
`active` → `idle`) produced **no notification**. The `notifications` table had
**zero rows, ever**. The daemon log said why:

```
WARN lifecycle: notification failed session=ao-g2-scratch-1 type=turn_complete
  err="notify store: create notification ...: constraint failed:
       CHECK constraint failed: type IN (
         'needs_input','ready_to_merge','pr_merged','pr_closed_unmerged') (275)"
```

**`turn_complete` reached the domain, the DTO enum, and the notification
queries — but never the schema.** `0011_notifications.sql`'s CHECK constraint
was never widened. The lifecycle manager emitted the intent at exactly the
right moment; the store rejected every insert.

It was invisible because notification writes are **deliberately best-effort** —
`emitNotification` logs at WARN and swallows, because a failed notification must
never fail the lifecycle write that produced it (`lifecycle/manager.go:961`).
Correct design; it just meant the feature could be 100% broken and 100% green.

**Why no test caught it: zero tests inserted a `turn_complete` through the real
SQLite store.** The backend tests use fake sinks; the renderer tests use fixtures.
`queries/notifications.sql` was updated to *read* the type, which made it look
covered. **That is the fifth vacuous-green on this project.**

#### The fix

`0107_notification_turn_complete.sql` rebuilds `notifications` with the widened
CHECK and recreates the four indexes from 0031 and 0041 (SQLite cannot alter a
CHECK in place). Plus `TestNotificationStore_AcceptsEveryDomainNotificationType`,
which asserts the schema accepts **every type the domain can produce**, not just
the new one — so the next type added cannot repeat this.

**Mutation-verified:** without 0107 the test fails on the `turn_complete`
subtest alone, with the same constraint error the daemon logged. The other four
types pass.

`TestMigrationVersionLedger` also required the number be claimed in the ledger in
the same change. **107, not 104** — upstream shipped 0104–0106, so 107 is what
survives a rebase onto `upstream/main` without collision.

Landed on `pr/turn-complete-notification` (upstream PR **#4267**, two commits
`490618de5` + `a77a14369`) and cherry-picked onto `deploy/all-features`
(`159eec629` + `2795115b6`, ledger conflict resolved to keep upstream's 104–106).

#### Confirmed working end to end

Daemon rebuilt and restarted 2026-08-23 21:47. Migration applied, all four
indexes present, **10 sessions and 2 projects intact**. Driving a turn now
yields:

```json
{"type": "turn_complete", "sessionId": "ao-g2-scratch-1",
 "title": "G2 probe finished its turn",
 "body": "Your agent finished and is waiting at an empty prompt.",
 "target": {"kind": "session", "sessionId": "ao-g2-scratch-1"}}
```

`target.kind: "session"` confirms follow-up 5's mobile routing fix was right.

**Volume — the product question — is answered: it is self-limiting.** A second
turn while the first notification is still unread creates **no** second row.
`idx_notifications_open_dedupe` is unique on `(session_id, type, pr_url)` where
`status = 'unread' OR resolved_at IS NULL`, so a session can hold **at most one
unread `turn_complete`** at a time. Precisely: **one notification per turn,
suppressed while an unread one is already pending for that session.** Once the
user reads it, the next turn creates a new one — which is the intended
behaviour. Nothing to change for #4267 on volume grounds.

#### Backups before the migration

Taken after a clean `ao stop` so the WAL was checkpointed (verified: no `-wal`
file remained):

- **DB:** `~/.ao/data/ao.db.pre-0107-20260823`
- **Binary:** `~/bin/ao.pre-0107`

Restoring means putting back both, as with the earlier upgrade. The older
`ao.db.pre-upgrade-20260823` predates migrations 0104–0106 and is the deeper
rollback.

#### Test-suite facts that will otherwise cost a session

Re-measured 2026-08-23 (late) on `deploy/all-features`. **`npm run test` reports
213 files / 11 failed — and none of the failures are ours.** Do not chase them:

- **10 are `src/landing/**`** — the marketing site has its own `package.json`
  and **its dependencies were never installed on this box** (`src/landing/node_modules`
  does not exist). They fail identically in the main checkout on the integration
  branch, which contains none of this project's work in `landing/`.
- **1 is `src/annotate-preload.test.ts`**, and it is a **worktree artifact**:
  the worktree's `node_modules` is a symlink (§11.1b), so Vite refuses the
  resolved font path — `Denied ID .../geist-latin-wght-normal.woff2`. The same
  test **passes in the main checkout** (16 passed) where `node_modules` is real.

**The honest number for the code that ships** — the renderer suite with
`--exclude 'src/landing/**'` — is **196 files / 2697 passed, 1 skipped**, plus
that one symlink artifact. `test:e2e:renderer` **26 passed**. `frontend:typecheck`,
`go build`, `go vet` all clean. Backend `go test ./...`: **only** the known
pre-existing `crush:TestCrushLocalAuthStatusDoesNotUseProviderCatalog`.

This also explains the **166-vs-213 file-count discrepancy** against §11.9's
earlier numbers: that measurement was scoped to the renderer suite; `npm run test`
unscoped also collects `src/landing`.

#### ⚠️ The `dist/index.html` trap, hit and survived

§11.9 says to `git checkout --` the built `dist/index.html` after a build. Doing
that leaves the **stub** on disk (`<script src="/index.js">`). Building the binary
in that state embeds the stub and serves a **blank page**. The rule is really:
`build:web` **immediately before** `go build`, then restore the stub — never
restore-then-build. The bundle hash was unchanged this time
(`index-Da65qtTv.js`), so **no hard refresh was needed** for this deployment.

#### ⚠️ Nothing restarts the daemon on reboot

`deploy/ao-daemon.service` exists but **cannot be installed here: this box has no
systemd** — PID 1 is `sshd`. The daemon runs as a bare `nohup ~/bin/ao daemon &`.
It survives a shell exit; it does **not** survive a reboot, and nothing brings it
back. Re-run the §11.1a command line by hand after any restart, then confirm
`tailscale serve status` still shows `:8443 → 127.0.0.1:3011`. This is the one
real gap between "verified working" and "durable" — an operator decision, not a
build task.
