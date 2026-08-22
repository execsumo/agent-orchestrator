# Known Limitations

The Web UI deployment of Agent Orchestrator has the following known limitations by design:

- **No workspace preview remotely:** Session previews are served on `<base32>.localhost` origins. A remote browser cannot resolve these origins. A path-based preview proxy is a possible future follow-up, but is not part of this deployment.
- **No native browser panel in web:** The Inspector's Browser tab requires Electron compositing. Furthermore, `/api/v1/browser` is LAN-blocked by design.
- **No OS file dialogs (native folder picker):** In a browser environment, there is no native OS folder picker. Project creation relies on cloning from a URL or typing an absolute path. (A network filesystem-enumeration API is deliberately deferred).
- **No daemon start/stop from the browser:** The `/shutdown` route is loopback-only by design and will return a 404 on the LAN listener. Use the CLI (`ao daemon`) or the Systemd supervisor unit to start, stop, or restart the daemon.
- **No QR pairing for the mobile app:** Under a loopback bind, the QR code advertises a host/port that nothing off-box can reach. Phone setup is manual-connect only. See the Operations Runbook for the manual connect steps.
