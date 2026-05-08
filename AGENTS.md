# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript/Node.js runtime for DOSSAgent. Core application code lives in `src/`; tests are colocated as `src/*.test.ts` and `src/channels/*.test.ts`. Runtime entry points include `src/index.ts`, `src/api-server.ts`, `src/router.ts`, `src/container-runner.ts`, and `src/db.ts`.

Agent container assets live under `container/`, including `container/agent-runner/` and skill definitions in `container/skills/`. Static web assets are in `frontend/`, images in `assets/`, docs in `docs/`, and examples in `config-examples/`. Build output goes to `dist/`; do not edit it by hand.

## Build, Test, and Development Commands

- `npm install`: install dependencies. Requires Node.js 20+.
- `npm run dev`: run the local TypeScript entry point with `tsx`.
- `npm run build`: compile TypeScript into `dist/`.
- `npm start`: run the compiled application from `dist/index.js`.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run lint`: lint `src/` with ESLint.
- `npm run format:check`: verify Prettier formatting.

## Coding Style & Naming Conventions

Use ES modules and strict TypeScript. Keep modules focused on one responsibility and prefer small, explicit functions. Follow existing file naming: lowercase kebab-case for modules such as `group-queue.ts`, with matching tests named `group-queue.test.ts`.

Prettier is configured with single quotes. ESLint enforces unused-variable rules, allows intentionally unused identifiers prefixed with `_`, warns on `any`, and discourages catch-all error handling. Keep comments in the same language and style as nearby code.

## Testing Guidelines

Vitest is the test framework. Add or update colocated `*.test.ts` files for behavior changes, especially routing, IPC, database, scheduling, container runtime, and security-sensitive path handling. Prefer deterministic tests with temporary paths or in-memory setup. Run `npm test`, `npm run typecheck`, and `npm run lint` before handing off code.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style messages, for example `feat: add SSE streaming endpoint` and `chore: organize project files`. Use `feat:`, `fix:`, `chore:`, or similar prefixes with an imperative summary.

Pull requests should include a problem statement, implementation summary, test evidence, and screenshots or logs for UI/runtime behavior when relevant. Link issues or design docs from `docs/` when the change implements planned work.

## Security & Configuration Tips

Do not commit credentials, DOSS account data, generated session state, or local logs. Treat `data/`, `groups/`, and `logs/` as runtime state. High-risk drone actions, production API calls, and destructive data changes require explicit operator confirmation.
