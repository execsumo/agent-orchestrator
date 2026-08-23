# Operations Runbook

This runbook describes common operations for managing the Agent Orchestrator Web UI deployment.

## Starting, Stopping, and Restarting the Daemon

The daemon is managed by a Systemd supervisor unit located at `deploy/ao-daemon.service`.

**Start the daemon:**
```bash
sudo systemctl start ao-daemon
```

**Stop the daemon:**
```bash
sudo systemctl stop ao-daemon
```

**Restart the daemon:**
```bash
sudo systemctl restart ao-daemon
```

## Rotating the Connection Password

If you need to rotate the mobile/web connection password, use the `ao` CLI against the running daemon.

```bash
ao connect password --regenerate
```

**Note:** Rotating the password will automatically **revoke all active sessions**.

## Revoking Sessions

Sessions are revoked globally by regenerating the connection password, or by disabling the bridge. Individual web sessions can also be revoked via the web UI. To revoke all sessions across all devices:

```bash
ao connect password --regenerate
# or
ao connect disable && ao connect enable
```

## Recovering from a Crashed Daemon

If the daemon crashes, the Systemd supervisor (`Restart=always`) will automatically restart it. 
To investigate a crash:
```bash
sudo journalctl -u ao-daemon -f
```

Web sessions persist across daemon restarts (they are stored atomically in `~/.ao/web/sessions.json`), so logged-in users will not be logged out by a crash or restart.

## Recovering from a Stale Serve Config / Port Drift

If the daemon restarts and port `3011` is occupied by another process, `AO_CONNECT_STRICT_PORT=1` will cause the daemon to fail loudly. However, if the daemon were to bind an ephemeral port, `tailscale serve` would still be pointing to the old port (`3011`), causing a `502 Bad Gateway` despite `tailscale serve status` looking healthy.

**To recover from a stale serve config:**
1. Check the actual bound port using the CLI:
   ```bash
   ao connect status
   ```
2. Re-apply the `tailscale serve` configuration to proxy to the actual port reported above:
   ```bash
   # [HUMAN REQUIRED]
   PORT=$(ao connect status | grep -Eo "127\.0\.0\.1:[0-9]+" | cut -d: -f2)
   tailscale serve --bg --https=8443 http://127.0.0.1:$PORT
   ```
*(Note: the supervisor unit's `ExecStartPost` automatically performs this re-application on boot).*

## Manual-Connect Steps for the Expo Phone App

Because the daemon binds to the loopback interface (`127.0.0.1`), the standard **QR pairing stops working** (the QR code advertises a host/port that nothing off-box can reach). 

The Expo phone app must be connected manually:

1. Open the Agent Orchestrator mobile app.
2. Choose **Manual Connect**.
3. For the URL, enter the tailnet proxy address with `secure: true`:
   - **Host:** `vibebox.goose-marlin.ts.net`
   - **Port:** `8443`
   - **Secure / HTTPS:** Enabled (Yes)
4. For the Password, enter the current connection password (which can be viewed by running `ao connect status`).

This provides the phone app with a strict upgrade: it gets full TLS over the tailnet instead of a plaintext LAN hop.
