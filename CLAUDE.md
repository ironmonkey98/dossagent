# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run with hot reload (tsx)
npm run build        # Compile TypeScript
npm run test         # Run all tests (vitest)
npm run test:watch   # Watch mode
npm run typecheck    # Type-check without emit
npm run lint         # ESLint
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run format:check # Prettier check (CI)
./container/build.sh # Rebuild agent container image
```

Run a single test file: `npx vitest run src/group-queue.test.ts`

Service management:
```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Linux
systemctl --user restart nanoclaw
```

## Architecture

Single Node.js process. Message flow:

```
Channel (WA/TG/Slack/…) → src/index.ts (orchestrator)
  → GroupQueue (per-chat FIFO)
    → container-runner.ts (spawns Linux container)
      → Claude Agent SDK inside container
        → IPC file drop → ipc.ts picks up → back to orchestrator
```

**Channel system** (`src/channels/`): Each channel is a skill that calls `registerChannel()` on import. `src/channels/index.ts` is the barrel that imports active channels — adding a channel means adding an import here. Channels implement the `Channel` interface (`src/types.ts`): `connect`, `sendMessage`, `ownsJid`, `isConnected`.

**API channel** (`src/api-server.ts`): Always-on HTTP channel (port `3080`, env `API_PORT`). Exposes `/api/message` (blocking) and `/api/stream` (SSE streaming) for the built-in web frontend (port `9080`, env `FRONTEND_PORT`). `/api/health` for health checks. Optionally protected by `NANOCLAW_API_KEY` Bearer token. Also proxies an external LLM via `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars.

**Container runner** (`src/container-runner.ts`): Each agent invocation spawns a fresh container with group folder, IPC path, and readonly skill mounts. Uses sentinel markers (`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`) to parse stdout. Credentials injected at request time via OneCLI SDK — never passed directly.

**IPC** (`src/ipc.ts`): Containers drop JSON files into `data/ipc/` to trigger side-effects (register group, create task, send message, `ask_user` breakpoint interaction). Polled by `startIpcWatcher`.

**Message formatting** (`src/router.ts`): Outbound text is XML-formatted with sender/time attributes. `<internal>…</internal>` blocks are stripped before delivery.

**Groups**: Each chat maps to a folder under `groups/{name}/`. The folder contains an isolated `CLAUDE.md` (per-group memory) and is mounted read-write into the container. `groups/main/` and `groups/global/` are tracked in git; `groups/api/` is the virtual API group; all others are gitignored.

**Container skills** (`container/skills/`): Markdown/script bundles mounted read-only into every container at runtime. Current skills: `agent-browser`, `capabilities`, `doss-auth`, `doss-camera`, `doss-fly`, `doss-mission`, `doss-monitor`, `doss-route`, `doss-status`, `doss-vision`, `slack-formatting`, `status`.

**Task scheduler** (`src/task-scheduler.ts`): Polls `scheduled_tasks` in SQLite every `SCHEDULER_POLL_INTERVAL` ms. Supports `once`, `interval`, and `cron` schedule types (cron parsed via `cron-parser`, timezone-aware). Next-run times are anchored to the scheduled time to prevent cumulative drift.

**Persistence** (`src/db.ts`): SQLite via `better-sqlite3`. Tables: `chats`, `messages`, `scheduled_tasks`, `task_run_logs`, `audit_logs`. DB migrations run automatically on startup via `src/db-migration.ts`.

**Remote control** (`src/remote-control.ts`): Starts a Claude Code session from within a chat, captures the share URL, and tracks the PID in `data/remote-control.json`. One session at a time.

**Sender allowlist** (`src/sender-allowlist.ts`): Per-chat access control read from `~/.config/nanoclaw/sender-allowlist.json` (outside project root, tamper-proof). Config shape: `{ default, chats, logDenied }` where each entry has `allow: '*' | string[]` and `mode: 'trigger' | 'drop'`.

**Mount security** (`src/mount-security.ts`): Additional container mounts validated against `~/.config/nanoclaw/mount-allowlist.json`. This allowlist is never mounted into containers. Non-main groups can be restricted to read-only mounts via `nonMainReadOnly`.

**Guard system** (`src/output-guard.ts`, `src/ipc-guard.ts`, `src/input-sanitize.ts`): Three-layer security pipeline. Output Guard scans container output for secrets (API keys, tokens, passwords) and strips zero-width unicode + internal paths. IPC Guard classifies actions by risk level (safe/risky/dangerous) and blocks oversized or malicious payloads. Input Sanitize strips zero-width characters and ANSI escapes from inbound messages. All guard decisions are logged to the `audit_logs` SQLite table. Configurable via `~/.config/nanoclaw/guard-config.json`.

**Audit log** (`src/audit-log.ts`): All guard decisions (pass/blocked/redacted/approved) are recorded to the `audit_logs` table with source group, action type, risk level, and detail. Query via `queryAuditLogs(db, { verdict: 'blocked' })`.

**Container runtime abstraction** (`src/container-runtime.ts`): Detects and wraps Docker/Podman/nerdctl differences. Provides `CONTAINER_RUNTIME_BIN`, `hostGatewayArgs`, `readonlyMountArgs`, and `stopContainer`.

## Configuration (.env)

Key environment variables (read via `src/env.ts` — intentionally NOT loaded into `process.env` to prevent leaking to child processes):

| Variable | Default | Description |
|---|---|---|
| `ASSISTANT_NAME` | `Andy` | Agent name, used in triggers and CLAUDE.md templates |
| `TZ` | system TZ | IANA timezone for scheduler and message formatting |
| `CONTAINER_IMAGE` | `nanoclaw-agent:latest` | Container image to run |
| `CONTAINER_TIMEOUT` | `1800000` | Max container lifetime in ms |
| `IDLE_TIMEOUT` | `1800000` | Close container stdin after idle (ms) |
| `MAX_MESSAGES_PER_PROMPT` | `10` | Max messages fed to agent per turn |
| `MAX_CONCURRENT_CONTAINERS` | `5` | Concurrency limit |
| `API_PORT` | `3080` | API HTTP port |
| `FRONTEND_PORT` | `9080` | Static frontend port |
| `NANOCLAW_API_KEY` | _(none)_ | Bearer token for `/api/*` endpoints (skipped if unset) |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | _(none)_ | External LLM proxy via API channel |
| `ONECLI_URL` / `ONECLI_API_KEY` | _(none)_ | OneCLI credential gateway |
| `CONTAINER_MEMORY_LIMIT` | `512m` | Container memory cap |
| `CONTAINER_CPU_LIMIT` | `1.0` | Container CPU cap |
| `CONTAINER_PIDS_LIMIT` | `256` | Container PID cap |

## Secrets / Credentials

Managed by OneCLI gateway (`@onecli-sh/sdk`). No keys passed to containers directly. Run `onecli --help`. Env vars read from `.env` via `src/env.ts`.

## Skills (Claude Code skills, not container skills)

Four types — see [CONTRIBUTING.md](CONTRIBUTING.md) for full taxonomy and PR requirements.

- **Feature skills** — `skill/*` branches (e.g. `/add-telegram`, `/add-whatsapp`)
- **Utility skills** — ship code files + SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only, on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation and auth |
| `/customize` | Adding channels or integrations |
| `/debug` | Container issues, logs |
| `/update-nanoclaw` | Merge upstream updates into a customized install |
| `/init-onecli` | Install OneCLI and migrate `.env` credentials |

## Troubleshooting

**WhatsApp not connecting after upgrade:** Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`).

**Container build cache stale:** `--no-cache` alone does NOT invalidate COPY steps. Prune the builder first, then re-run `./container/build.sh`.

**Stale session error (`no conversation found`):** Orchestrator auto-clears the session ID so the next retry starts fresh. No manual intervention needed.
