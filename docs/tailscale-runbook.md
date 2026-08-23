# Tailscale Runbook

This runbook covers configuring Tailscale serve for the Agent Orchestrator Web UI in a tailnet-only deployment.

**Important Note:** The daemon's `securePairing` stays **OFF** for this deployment. The daemon's internal `Serve.Apply` hardcodes `--https=443`, which would clobber the user's Harness Asset Manager that is already bound there. We must manage Tailscale serve externally and idempotently.

## 1. Apply Tailscale Serve

Apply the tailscale serve configuration externally. The UI will be served on HTTPS port 8443, proxying to the local LAN listener on loopback port 3011.

> **Note:** The following `tailscale serve` commands require a human operator.

```bash
# [HUMAN REQUIRED] Apply the tailscale serve configuration
tailscale serve --bg --https=8443 http://127.0.0.1:3011
```

After running this, the web UI will be accessible at: `https://vibebox.goose-marlin.ts.net:8443`

## 2. Verify Serve Status

It is critical to check the serve status before and after applying changes to ensure the Harness Asset Manager is untouched.

```bash
# [HUMAN REQUIRED] Check serve status
tailscale serve status
```

**Before and after applying the proxy, ensure you still see:**
`/ → http://127.0.0.1:8000` on `:443`

## 3. The Serve-Reconciliation Gap

Because `securePairing` is off, Agent Orchestrator's own serve reconciliation (which normally runs `Serve.Target()` on boot) **never runs**. 

To cover this gap:
1. `AO_CONNECT_STRICT_PORT=1` is set in the daemon's environment to ensure port conflicts fail loudly instead of silently drifting to an ephemeral port.
2. The supervisor unit is configured to automatically re-apply the serve target from the port `ao connect status` actually reports.

**Warning:** This serve-reconciliation gap is the one failure mode that looks perfectly healthy when checking `tailscale serve status` while the target URL returns a `502 Bad Gateway`. If `ao daemon` bound to an ephemeral port (e.g. if strict port was disabled), `tailscale serve` would still point to `:3011` and the web UI would fail.
