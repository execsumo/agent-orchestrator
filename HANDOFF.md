# Agent Orchestrator: Tailnet Web Supervision

**Status:** **all six workstreams (W0–W5) are built, verified and merged.** W6
has not started. Gates **G0, G0b, G1 and G3 pass** — a browser on loopback
renders live data and a real streaming PTY, with no Electron. What remains is
gate verification: **G2**, then **G4** (tailnet, needs a human for `tailscale
serve`), then G5–G8.

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
- **G2 One real agent.** A worker spawned by AO in this container completes a
  small real task on a scratch repo. Not mocked.
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
- **G4 Tailnet.** Bridge enabled, bound `127.0.0.1`, strict port on,
  `tailscale serve --https=8443` configured; from a **different tailnet device**:
  URL → board → live terminal → chat. With identity trust on (§5.7) there should
  be **no login prompt at all**. Then disable identity trust and confirm the
  password + cookie path still works end to end — both credentials must be
  exercised. Header forwarding through the proxy is already measured (§4), so
  what this gate proves is the *application* behavior, not the transport.
- **G5 Orchestrator.** From that remote browser: start the orchestrator, plan,
  delegate a task, land on the spawned worker.
- **G6 Isolation.** Two concurrent workers on separate branches/worktrees, both
  supervised from the browser, no cross-talk.
- **G7 Recovery.** Restart the daemon while logged in: sessions restore, the web
  session survives (§5.5), terminals reconnect. Then `tailscale serve status`
  still shows `:443 → 127.0.0.1:8000` untouched.
  **G7b Port drift.** Occupy port 3011 with an unrelated process, restart the
  daemon, and confirm the tailnet URL either still works or fails **loudly**.
  A daemon that quietly binds an ephemeral port and leaves the URL 502ing is a
  failed gate (§5.4).
- **G8 Security.** Automated: CSRF rejection and cross-origin `/mux` rejection
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

**State as of 2026-08-22, end of session.** All six workstreams are merged and
the working tree is clean.

- Branch `docs/tailnet-webui-handoff`, forked from `main` at `11c1b5cae`.
  Integration head at the break: **`ff3fe0e06`** (this commit's parent chain
  contains every merge below).
- Remotes: `origin` = `execsumo/agent-orchestrator` (this fork),
  `upstream` = `Untrivial-ai/agent-orchestrator`. **Nothing has been pushed.**

| Workstream | State | Merge commit |
| --- | --- | --- |
| **W0** bridge capability contract | ✅ merged | `ecc655d3f` |
| **W5** deploy, ADR-0003, runbooks | ✅ merged | `a3d1ace0c` |
| **W1** backend auth + static serving | ✅ merged | `a9137eed0` |
| **W2** capability refactor | ✅ merged | `f4eb632a9` |
| **W3** project creation without dialogs | ✅ merged | `a1a54aef1` |
| **W4** orchestrator surface | ✅ merged | `0a608a75a` |
| **W6** remote directory picker | not started (W1 has merged, so it is now unblocked) | — |

**Gates:** G0 ✅, G0b ✅, G1 ✅, **G3 ✅**. G2 and G4–G8 not yet run.

**All six workstreams (W0–W5) are merged.** W6 has not started. The integration
branch is green end to end: `frontend:typecheck` clean, renderer vitest
**159 files / 2308 passed**, `test:e2e:renderer` **26 passed**,
`cd backend && go build ./...` clean, `npm run lint` **0 issues**.

### 11.1a Environment state (differs from a clean checkout)

- **Installed.** `node_modules` at the repo root, `frontend/`, **and**
  `packages/product-ui/`. Playwright chromium downloaded. See G0's four
  prerequisites in §7 — a clean checkout does **not** pass G0 without them.
- **A tmux server is running** (`tmux new-session -d -s g0probe`). `go test ./...`
  and `npm run lint` fail without one.
- **A daemon is running on `127.0.0.1:3001`** (pid recorded in
  `~/.ao/running.json`), built from the **current integration head** with
  `go build -o <tmp>/bin/ao ./cmd/ao`, so it **embeds the real web bundle** — this
  is the daemon G3 was proven against. `~/.ao` holds real state (`data/ao.db`,
  `worktrees/`) and one auto-created project, `Scratch`.
  - If you need port 3001, stop it first (`kill` the pid in `running.json`).
  - **The binary lives in a scratch dir that does not survive a job cleanup.** If
    it is gone, rebuild it — and remember to rebuild **after** any `build:web`, or
    `go:embed` keeps serving the previous bundle.
  - **`ao` is not on `PATH`.** Every invocation in this document assumes a
    locally-built binary.
- **`tailscale serve --https=8443` is OFF** (operator turned it off 2026-08-22).
  `:443 → http://127.0.0.1:8000` (Harness Asset Manager) is **untouched and
  off-limits**. Re-apply `:8443 → 127.0.0.1:3011` only at G4, and only a human
  can run it.
- A scratch repo for G2 exists at `/home/dev/projects/ao-g2-scratch` (git-init'd,
  otherwise empty).
- `frontend/package-lock.json` has a benign uncommitted 2-line change (it gained
  `motion`, reconciling with `packages/product-ui`'s package.json during install).
  `git checkout` of it is permission-gated here; leave it out of merges.

### 11.1a2 Live process state at the break (2026-08-22 end of session)

Nothing here is load-bearing — a new session can kill all of it — but knowing
what is running avoids confusion:

- **Daemon** on `127.0.0.1:3001`, healthy, serving the embedded SPA.
- **No stray `vite` or Playwright processes.** Confirmed zero. If e2e ever fails
  *wholesale*, re-check this first (§11.1d).
- **A tmux server** (`g0probe`) — required by `go test ./...` and `npm run lint`.
- **Four idle herdr delegate panes** (`w1`–`w4`) in workspace `wB`, each in its
  worktree with its work already merged. They are **finished**; close them with
  `herdr pane close <id>` (highest id first — ids compact on close). Their
  worktrees and `delegate/*` branches can stay; they cost nothing and `git
  branch -D` is permission-gated here anyway.
- **Working tree clean**, everything committed on `docs/tailnet-webui-handoff`.
  **Nothing has been pushed** to `origin`.

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
  **agy**, `agent prompt` silently fails to submit; use `herdr pane run <pane>
  "<text>"` instead. codex and claude both need their first-run trust /
  bypass-permissions prompt answered with `herdr pane send-keys <pane> enter`
  (claude needs `down` first to select "Yes, I accept").
- Vendors were spread deliberately (codex, claude, agy) so no single quota pools.

### 11.1c What to do next, in order

Build and integration work is **done**. What remains is gate verification.

1. **G2 — one real agent.** A worker spawned by AO completes a small real task on
   a scratch repo, not mocked. A git-init'd scratch repo already exists at
   `/home/dev/projects/ao-g2-scratch`. Independent of everything else; do it
   first because it validates the environment, not the new code.

2. **G4 — tailnet.** The big one, and the first test of anything this work has
   *not* already proven. Sequence:
   - Set `AO_CONNECT_BIND_HOST=127.0.0.1` and `AO_CONNECT_STRICT_PORT` (see
     `deploy/ao-daemon.env.example`), enable the connect bridge (`ao connect
     enable`), and confirm the LAN listener is on **3011**.
   - Ask the **human** to run
     `tailscale serve --bg --https=8443 http://127.0.0.1:3011` — agents cannot run
     `tailscale`. Then confirm `tailscale serve status` still shows
     `:443 → http://127.0.0.1:8000` untouched.
   - From a second tailnet device: URL → board → live terminal → chat. With
     identity trust on (`AO_CONNECT_TRUST_TAILSCALE_IDENTITY=1`,
     `AO_CONNECT_ALLOWED_LOGINS=execsumo@github`) there should be **no login
     prompt at all**. Then disable identity trust and confirm the password +
     cookie path still works. Both credentials must be exercised.

   ⚠️ **Most likely thing to break, and it is untested:** the built `index.html`
   ships a CSP whose `connect-src` is
   `'self' http://127.0.0.1:* ws://127.0.0.1:*`. Over
   `https://vibebox.goose-marlin.ts.net:8443` the terminal needs a **same-origin
   `wss://`**, which *should* be covered by `'self'` — but that assumption has not
   been verified in a browser. If terminals fail at G4 while the board works,
   **look at the CSP first** (`frontend/index.html`), not at the auth code.

3. **G5** (orchestrator from a remote browser), **G6** (two concurrent isolated
   workers), **G7/G7b** (restart recovery and port drift), **G8** (the automated
   security suite — much of it already exists as Go tests from W1; G8 is about
   running them plus the live checks).

4. **W6** (remote directory picker) is unblocked now that W1 has merged, but it is
   deliberately second-wave. Gates matter more.

**Before doing any of the above, re-read §7 G0b.** The verification protocol is
the thing most likely to be forgotten and most costly to relearn.

### 11.1d Lessons from running the fan-out (do not relearn these)

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

- ~~Turn the `:8443` probe serve off (or repoint it)~~ — **decided 2026-08-22:
  turn it OFF now**, and re-apply it at G4 once a daemon is actually listening on
  `3011`. Agents cannot run `tailscale serve`, so the operator runs:

  ```bash
  tailscale serve --https=8443 off
  tailscale serve status   # confirm :443 → http://127.0.0.1:8000 is untouched
  ```

- ~~Decide whether `AO_CONNECT_ALLOWED_LOGINS` is just `execsumo@github` or
  wider.~~ — **decided 2026-08-22: `execsumo@github`** (single operator). An empty
  allowlist still means deny-everyone, and "any tailnet user" is still forbidden
  as a default (§5.7).
- Gates G2, G4, G5, G6 need a real repo, a real agent run, and a second tailnet
  device.
