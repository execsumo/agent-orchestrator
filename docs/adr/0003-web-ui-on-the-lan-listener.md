# 3. Web UI on the LAN listener

Date: 2026-08-22
Status: Accepted

## Context

The daemon already ships with a network-facing authenticated listener ("Connect Mobile"), Bearer-password auth with per-source lockout, Tailnet-only TLS via `tailscale serve`, MagicDNS hostname discovery, control-route blocking at the socket, and PTY terminals served by the daemon.

However, it lacks a browser client and the existing renderer has Electron-only assumptions. Additionally, browser transports cannot carry a Bearer header. The agent workspace preview panel (a session's own dev server) is served on isolated `<base32>.localhost` origins which a remote browser cannot resolve (a known remote limitation).

We want to supervise coding agents running inside this container from a web browser on any device on the user's Tailscale tailnet — no Electron, no desktop GUI, nothing exposed to the public internet.

## Decision

Serve the existing renderer, built for a browser target, as static assets from the daemon's existing LAN listener, authenticated by a session cookie, reached over `tailscale serve` on a non-conflicting HTTPS port.

**3.1 De-Electronize the existing renderer — do not build a new web client.**
`frontend/src/renderer/lib/bridge.ts` is already a single, complete, typed abstraction over every Electron capability, with a working browser fallback and a `nativeCompositionEnabled: false` flag already in it.
*Rejected alternative:* A thin client on `packages/product-ui` + `packages/cloud-client` was rejected. `cloud-client` targets the AO Cloud API, not the daemon, and `product-ui` carries leaf components only, meaning re-implementing the entire product UI instead of leveraging existing work.

**3.2 Serve from the LAN listener — not from a reverse proxy in front of loopback.**
Reusing the LAN listener inherits auth, lockout, and the control-block list for free. It also makes the SPA same-origin with the API, removing CORS from the design entirely. This adds no new listener. Note that AGENTS.md's LAN-listener rule ("no other network-facing bind") should be amended to say the LAN listener may also serve the web UI, following the same amendment pattern ADR-0001 used for the loopback rule.
*Rejected alternative:* A Caddy/nginx proxy fronting `127.0.0.1:3001` needing zero Go changes was rejected. The loopback listener is unauthenticated by design, with protections enforced at the socket. A proxy would have to re-implement that blocklist correctly and forever.

**3.3 Browsers authenticate by tailnet identity, with a session cookie as the universal fallback — Bearer stays for native clients.**
A browser cannot attach `Authorization` to a WebSocket or an `EventSource`. Identity is the primary path here — no password to type or rotate, revocation via Tailscale ACLs — with the cookie as the fallback for any deployment not behind `tailscale serve`. Precedence and the loopback-bind invariant make identity trustworthy.
*Rejected alternatives:* 
- Query-param token: `tailscale serve` strips query parameters from WebSocket upgrade requests, making it broken on the transport we need.
- Broadening the existing `ao_conn` cookie: It is deliberately path-scoped to `/preview/files/` and must stay that way.

## Consequences

- The LAN listener gains an unauthenticated surface: exactly one self-contained login page. Everything else stays behind auth.
- Cookie auth is ambient, so CSRF and CSWSH become live risks that did not exist before. Mitigations in §5 are mandatory, not optional.
- Binding the LAN listener to `127.0.0.1` means the plaintext hop is loopback-only and TLS terminates at `tailscaled`. This retires ADR-0001's accepted "plaintext on the LAN" limitation for this deployment, and with it the concern that the connection password is stored in plaintext in `~/.ao/mobile/config.json` for a home-LAN threat model.
- The agent workspace preview panel (a session's own dev server) is served on isolated `<base32>.localhost` origins. A remote browser cannot resolve those. Preview is a known remote limitation.
