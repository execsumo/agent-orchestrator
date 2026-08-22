# Agent Orchestrator: Tailnet Web Supervision

## Goal

Adapt Agent Orchestrator so it can supervise coding agents running inside this
container through a browser over the user's private Tailnet, while preserving as
much of the upstream project as possible and keeping useful changes suitable for
sharing back with the upstream project.

The target is a practical self-hosted operator workspace: the user opens a
Tailnet-reachable URL, sees projects and agent workers, starts and supervises
work, reads agent output, interacts with terminals/chat where supported, and
tracks the work through completion without needing a local desktop GUI.

## Why this fork exists

Agent Orchestrator's workflow and UI make it substantially easier to turn ideas
into parallel, isolated coding tasks. The upstream product is currently
Electron-first. This fork exists to evaluate and, if necessary, implement the
smallest reliable web-hosted path for the container environment rather than
abandoning that workflow.

## Current baseline

- Upstream project: `https://github.com/Untrivial-ai/agent-orchestrator`
- This fork: `https://github.com/execsumo/agent-orchestrator`
- Upstream's frontend is Electron + React.
- The repository has a `frontend` `dev:web` mode for running the renderer in a
  normal browser, but that mode is documented as renderer-only development.
- The Go daemon currently uses a loopback listener by design.
- The container is the execution host for the coding agents, worktrees, and
  project state.

## Objectives

1. Establish a repeatable development and launch workflow in this container.
2. Run the AO web renderer in a browser without requiring Electron.
3. Connect that renderer to the container's AO daemon and agent processes.
4. Make the browser UI reachable over Tailnet without exposing it publicly.
5. Preserve isolation between projects, workers, branches, and worktrees.
6. Retain the useful AO lifecycle: task -> agent session -> changes -> PR/CI/
   review feedback -> completion.
7. Keep security, credentials, and agent terminal access appropriate for a
   private operator interface.
8. Prefer small, well-tested, upstreamable changes. Keep local deployment
   adaptations separate when they are specific to this environment.
9. Document setup, operation, recovery, and known limitations so another agent
   can continue without reconstructing the project history.

## Definition of Done

This goal is complete when all of the following are true:

### Runtime

- [ ] AO's daemon runs reliably in the container and survives the intended
      restart/recovery paths.
- [ ] At least one supported coding agent can be launched by AO inside the
      container and completes a small real task.
- [ ] The browser UI runs without Electron, either through an upstream-supported
      web mode or a documented fork implementation.
- [ ] The browser UI can create, inspect, supervise, and stop agent workers.
- [ ] Agent output and terminal/chat interaction needed for normal supervision
      work from the browser.
- [ ] Project/worktree/branch isolation is demonstrated with at least two
      concurrent workers or an equivalent repeatable test.

### Network and security

- [ ] The service is reachable from an authorized Tailnet client using a stable
      URL or hostname.
- [ ] The service is not publicly exposed by default.
- [ ] Authentication/authorization and any reverse-proxy/TLS requirements are
      explicit, tested, and documented.
- [ ] No agent credentials, GitHub tokens, or private project data are committed
      to the repository or exposed in client-side configuration.
- [ ] A clear stop/recovery procedure exists for the daemon, frontend, and
      reverse proxy.

### Engineering quality

- [ ] The chosen architecture and its tradeoffs are documented.
- [ ] Automated tests cover the new web/container behavior and important failure
      paths.
- [ ] The relevant backend, frontend, typecheck, and build checks pass.
- [ ] The setup can be reproduced from a clean checkout using the documented
      commands.
- [ ] Changes that are generally useful to AO are isolated into reviewable
      commits and are candidates for upstream pull requests.
- [ ] Environment-specific deployment files, secrets, and operational state are
      kept out of the upstream-facing change set.

## Non-goals

- Building a multi-tenant hosted SaaS product.
- Replacing AO's agent/worktree lifecycle with a separate orchestration system.
- Exposing the daemon or terminal service directly to the public internet.
- Committing credentials, Tailnet identity, reverse-proxy secrets, or local
  machine state.
- Making broad architectural changes before a minimal browser workflow works.

## Working rules for future sessions and agents

- Read this file before changing the web/container path.
- Inspect the current implementation before assuming upstream behavior; this
  document states the goal, not proof that a feature already works.
- Keep the upstream remote available and rebase or merge deliberately rather
  than silently diverging.
- Separate generally useful product changes from container-specific deployment
  changes.
- Verify external behavior with a real browser request and a real agent task;
  a successful build alone is not completion.
- Record meaningful architectural decisions and blockers here as the work
  evolves.

## Suggested sequence

1. Make the required toolchain reproducible in the container.
2. Run the existing renderer-only web mode against a local daemon.
3. Identify Electron-only assumptions and the minimum compatibility layer.
4. Add the smallest secure Tailnet deployment path.
5. Exercise one agent end to end, then parallel workers and recovery.
6. Harden, test, document, and split upstreamable changes from local deployment
   changes.
