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

**API channel** (`src/api-server.ts`): Always-on HTTP channel (port `3080`, env `API_PORT`). Exposes `/api/chat` for the built-in web frontend (port `9080`, env `FRONTEND_PORT`). Uses a FIFO queue to pair HTTP requests with agent responses. Also proxies an external LLM via `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars.

**Container runner** (`src/container-runner.ts`): Each agent invocation spawns a fresh container with group folder, IPC path, and readonly skill mounts. Uses sentinel markers (`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`) to parse stdout. Credentials injected at request time via OneCLI SDK — never passed directly.

**IPC** (`src/ipc.ts`): Containers drop JSON files into `data/ipc/` to trigger side-effects (register group, create task, send message). Polled by `startIpcWatcher`.

**Message formatting** (`src/router.ts`): Outbound text is XML-formatted with sender/time attributes. `<internal>…</internal>` blocks are stripped before delivery.

**Groups**: Each chat maps to a folder under `groups/{name}/`. The folder contains an isolated `CLAUDE.md` (per-group memory) and is mounted read-write into the container. `groups/main/` and `groups/global/` are tracked in git; all others are gitignored.

**Container skills** (`container/skills/`): Markdown/script bundles mounted read-only into every container at runtime. Current skills: `agent-browser`, `capabilities`, `doss-auth`, `doss-camera`, `doss-fly`, `doss-mission`, `doss-monitor`, `doss-status`, `slack-formatting`, `status`.

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
