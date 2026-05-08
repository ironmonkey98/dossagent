# Safety Guard System - 审核与安全控制增强 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 dossagent 的容器输出和 IPC 通道中增加审核过滤层，防止敏感信息泄露、危险操作直接执行、和 prompt 注入攻击。

**Architecture:** 在现有 3 个关键拦截点插入 Guard：① 容器 stdout 输出解析后（container-runner.ts）过滤敏感信息；② IPC 文件处理前（ipc.ts）进行 action 分级与审批；③ 出站消息发送前（index.ts）最终审核。所有审核记录写入 SQLite 审计表。采用 Fail-Closed 原则——不确定时拦截。

**Tech Stack:** TypeScript, better-sqlite3 (已有), vitest (已有)

---

## Task 1: 审计日志表 + DB Migration

**Files:**
- Modify: `src/db.ts:17-85` (createSchema 中增加 audit_logs 表)
- Modify: `src/types.ts` (增加 AuditEntry 类型)
- Create: `src/audit-log.ts` (审计写入函数)
- Create: `src/audit-log.test.ts`

**Step 1: Write the failing test**

```typescript
// src/audit-log.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeAuditLog, queryAuditLogs, AuditEntry } from './audit-log.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      source_group TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('safe', 'risky', 'dangerous')),
      verdict TEXT NOT NULL CHECK(verdict IN ('pass', 'blocked', 'redacted', 'approved')),
      payload TEXT,
      approver TEXT,
      detail TEXT
    );
  `);
});

describe('writeAuditLog', () => {
  it('should insert an audit entry', () => {
    const entry: AuditEntry = {
      sourceGroup: 'main',
      action: 'ipc_message',
      riskLevel: 'safe',
      verdict: 'pass',
      payload: '{"type":"message","text":"hello"}',
    };
    writeAuditLog(db, entry);
    const rows = queryAuditLogs(db, { sourceGroup: 'main' });
    expect(rows).toHaveLength(1);
    expect(rows[0].source_group).toBe('main');
    expect(rows[0].action).toBe('ipc_message');
    expect(rows[0].risk_level).toBe('safe');
    expect(rows[0].verdict).toBe('pass');
  });

  it('should query by verdict', () => {
    writeAuditLog(db, { sourceGroup: 'main', action: 'ipc_message', riskLevel: 'safe', verdict: 'pass' });
    writeAuditLog(db, { sourceGroup: 'api', action: 'ipc_task', riskLevel: 'risky', verdict: 'blocked' });
    const blocked = queryAuditLogs(db, { verdict: 'blocked' });
    expect(blocked).toHaveLength(1);
    expect(blocked[0].source_group).toBe('api');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/audit-log.test.ts`
Expected: FAIL — `audit-log.ts` 不存在

**Step 3: Add AuditEntry type**

在 `src/types.ts` 末尾追加：

```typescript
// --- Audit Log ---
export type RiskLevel = 'safe' | 'risky' | 'dangerous';
export type AuditVerdict = 'pass' | 'blocked' | 'redacted' | 'approved';

export interface AuditEntry {
  sourceGroup: string;
  action: string;
  riskLevel: RiskLevel;
  verdict: AuditVerdict;
  payload?: string;
  approver?: string;
  detail?: string;
}
```

**Step 4: Write minimal implementation**

```typescript
// src/audit-log.ts
import Database from 'better-sqlite3';
import { AuditEntry } from './types.js';

const INSERT_SQL = `
  INSERT INTO audit_logs (source_group, action, risk_level, verdict, payload, approver, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export function writeAuditLog(db: Database.Database, entry: AuditEntry): void {
  db.prepare(INSERT_SQL).run(
    entry.sourceGroup,
    entry.action,
    entry.riskLevel,
    entry.verdict,
    entry.payload ?? null,
    entry.approver ?? null,
    entry.detail ?? null,
  );
}

export interface AuditQueryFilter {
  sourceGroup?: string;
  action?: string;
  riskLevel?: string;
  verdict?: string;
  limit?: number;
}

export function queryAuditLogs(
  db: Database.Database,
  filter: AuditQueryFilter = {},
): Record<string, unknown>[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.sourceGroup) { clauses.push('source_group = ?'); params.push(filter.sourceGroup); }
  if (filter.action) { clauses.push('action = ?'); params.push(filter.action); }
  if (filter.riskLevel) { clauses.push('risk_level = ?'); params.push(filter.riskLevel); }
  if (filter.verdict) { clauses.push('verdict = ?'); params.push(filter.verdict); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;
  const sql = `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ${limit}`;

  return db.prepare(sql).all(...params);
}
```

**Step 5: Add migration in db.ts**

在 `src/db.ts` 的 `createSchema` 函数中，`registered_groups` 表之后、第一个 `ALTER TABLE` 之前，增加：

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  source_group TEXT NOT NULL,
  action TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('safe', 'risky', 'dangerous')),
  verdict TEXT NOT NULL CHECK(verdict IN ('pass', 'blocked', 'redacted', 'approved')),
  payload TEXT,
  approver TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_verdict ON audit_logs(verdict);
```

**Step 6: Run test to verify it passes**

Run: `npx vitest run src/audit-log.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/types.ts src/audit-log.ts src/audit-log.test.ts src/db.ts
git commit -m "feat: add audit_logs table and writeAuditLog/queryAuditLogs"
```

---

## Task 2: Output Guard — 敏感信息过滤

**Files:**
- Create: `src/output-guard.ts`
- Create: `src/output-guard.test.ts`
- Modify: `src/container-runner.ts:300-310` (onOutput 回调中插入过滤)

**Step 1: Write the failing test**

```typescript
// src/output-guard.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeOutput, scanForSecrets } from './output-guard.js';

describe('scanForSecrets', () => {
  it('should detect API keys', () => {
    const input = 'Here is my key: api_key=sk-abc123def456ghi789jkl012mno345';
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('should detect Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig';
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
  });

  it('should pass clean text', () => {
    const input = 'The drone is flying at 120 meters altitude.';
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(false);
  });

  it('should detect password patterns', () => {
    const input = 'password=MyS3cretP@ss!';
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
  });
});

describe('sanitizeOutput', () => {
  it('should redact API keys', () => {
    const input = 'Use api_key=sk-abc123def456ghi789jkl012mno345 for access';
    const result = sanitizeOutput(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc123');
  });

  it('should strip zero-width characters', () => {
    const input = 'Hello​World‍﻿End';
    const result = sanitizeOutput(input);
    expect(result).toBe('HelloWorldEnd');
  });

  it('should strip container internal paths', () => {
    const input = 'File at /workspace/project/src/index.ts was modified';
    const result = sanitizeOutput(input);
    expect(result).not.toContain('/workspace/project');
  });

  it('should preserve normal flight status text', () => {
    const input = '无人机已起飞，高度120米，正在飞向软件园三期F06栋';
    const result = sanitizeOutput(input);
    expect(result).toBe(input);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/output-guard.test.ts`
Expected: FAIL — `output-guard.ts` 不存在

**Step 3: Write implementation**

```typescript
// src/output-guard.ts
// 敏感信息检测和过滤规则，参考 Claude Code 的 scanForSecrets + sanitizeUnicode

export interface SecretScanResult {
  hasSecrets: boolean;
  matches: { rule: string; match: string }[];
}

// 常见敏感信息模式
const SECRET_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'api_key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([\w-]{20,})["']?/gi },
  { name: 'bearer_token', pattern: /Bearer\s+[\w-._~+/]+=*/gi },
  { name: 'password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[\S]{6,}["']?/gi },
  { name: 'secret_key', pattern: /(?:secret[_-]?key|secret)\s*[:=]\s*["']?([\w-]{16,})["']?/gi },
  { name: 'private_key_block', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g },
];

// 零宽 Unicode 字符（ASCII Smuggling 防御）
const ZERO_WIDTH_CHARS = /[​-‍﻿­⁠⁡⁢⁣⁤]/g;

// 容器内部路径
const INTERNAL_PATHS = /\/workspace\/(project|skills|extra)\/\S+/g;

export function scanForSecrets(text: string): SecretScanResult {
  const matches: { rule: string; match: string }[] = [];

  for (const rule of SECRET_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      matches.push({ rule: rule.name, match: m[0] });
    }
  }

  return { hasSecrets: matches.length > 0, matches };
}

export function sanitizeOutput(text: string): string {
  let result = text;

  // 1. 脱敏：替换敏感值为 [REDACTED]
  for (const rule of SECRET_RULES) {
    const replacement = rule.name === 'bearer_token'
      ? 'Bearer [REDACTED]'
      : rule.name === 'private_key_block'
        ? '[REDACTED PRIVATE KEY]'
        : (match: string) => {
            // 保留键名，只脱敏值部分
            const eqIdx = Math.max(match.indexOf('='), match.indexOf(':'));
            if (eqIdx > -1) {
              return match.substring(0, eqIdx + 1) + ' [REDACTED]';
            }
            return '[REDACTED]';
          };
    result = result.replace(
      new RegExp(rule.pattern.source, rule.pattern.flags),
      typeof replacement === 'function' ? replacement : replacement,
    );
  }

  // 2. 清除零宽字符（ASCII Smuggling 防御）
  result = result.replace(ZERO_WIDTH_CHARS, '');

  // 3. 清除容器内部路径
  result = result.replace(INTERNAL_PATHS, '[internal-path]');

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/output-guard.test.ts`
Expected: PASS

**Step 5: Integrate into container-runner output**

修改 `src/index.ts` 中处理容器输出的回调（约第 300-310 行）：

```typescript
// 在 import 区域增加
import { sanitizeOutput, scanForSecrets } from './output-guard.js';

// 修改 onOutput 回调中 result.result 的处理部分（约第 301-311 行）
// 将：
//   const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
//   const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
// 改为：
const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
const text = sanitizeOutput(raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim());

// 敏感信息检测 — 发现时记录审计但不阻断（Fail-Open 用于输出过滤）
const secretScan = scanForSecrets(raw);
if (secretScan.hasSecrets) {
  logger.warn(
    { group: group.name, secrets: secretScan.matches.map(m => m.rule) },
    'Sensitive information detected in container output (redacted)',
  );
}
```

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/output-guard.ts src/output-guard.test.ts src/index.ts
git commit -m "feat: add Output Guard with secret scanning and unicode sanitization"
```

---

## Task 3: IPC Guard — Action 分级与拦截

**Files:**
- Create: `src/ipc-guard.ts`
- Create: `src/ipc-guard.test.ts`
- Modify: `src/ipc.ts:63-133` (processIpcFiles 中插入 guard)

**Step 1: Write the failing test**

```typescript
// src/ipc-guard.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyAction,
  type IpcAction,
  type GuardVerdict,
} from './ipc-guard.js';

describe('classifyAction', () => {
  it('should classify message IPC as safe', () => {
    const action: IpcAction = { type: 'message', payload: { text: 'hello' } };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('safe');
    expect(result.verdict).toBe('pass');
  });

  it('should classify register_group as safe', () => {
    const action: IpcAction = { type: 'register_group', payload: { jid: 'test@g.us' } };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('safe');
    expect(result.verdict).toBe('pass');
  });

  it('should classify schedule_task as risky', () => {
    const action: IpcAction = { type: 'schedule_task', payload: { prompt: 'check status' } };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.verdict).toBe('pass'); // risky 默认放行但审计
  });

  it('should classify unknown type as risky (fail-closed)', () => {
    const action: IpcAction = { type: 'unknown_action', payload: {} };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
  });

  it('should block IPC with oversized payload', () => {
    const bigPayload = { text: 'x'.repeat(200_001) };
    const action: IpcAction = { type: 'message', payload: bigPayload };
    const result = classifyAction(action);
    expect(result.verdict).toBe('blocked');
    expect(result.detail).toContain('oversized');
  });

  it('should block IPC with script injection patterns', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { text: '<script>alert("xss")</script>' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.detail).toContain('injection');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-guard.test.ts`
Expected: FAIL — `ipc-guard.ts` 不存在

**Step 3: Write implementation**

```typescript
// src/ipc-guard.ts
// IPC Action 分级与拦截，参考 Claude Code 的 checkPermissions 生命周期

import { logger } from './logger.js';

export type RiskLevel = 'safe' | 'risky' | 'dangerous';
export type GuardVerdict = 'pass' | 'blocked' | 'needs_approval';

export interface IpcAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface GuardResult {
  riskLevel: RiskLevel;
  verdict: GuardVerdict;
  detail?: string;
}

// IPC payload 最大尺寸（字节）
const MAX_PAYLOAD_SIZE = 200_000;

// 危险注入模式
const INJECTION_PATTERNS: RegExp[] = [
  /<script[\s>]/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,  // 事件处理器 onerror= 等
];

// Action 分级规则表
interface ActionRule {
  riskLevel: RiskLevel;
  autoApprove: boolean; // risky 但自动放行（只记录审计）
}

const ACTION_RULES: Record<string, ActionRule> = {
  message:          { riskLevel: 'safe',     autoApprove: true },
  ask_user:         { riskLevel: 'safe',     autoApprove: true },
  register_group:   { riskLevel: 'safe',     autoApprove: true },
  schedule_task:    { riskLevel: 'risky',    autoApprove: true },
  delete_task:      { riskLevel: 'risky',    autoApprove: true },
};

const DEFAULT_RULE: ActionRule = { riskLevel: 'risky', autoApprove: true };

function checkPayloadSize(payload: Record<string, unknown>): string | null {
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_SIZE) {
    return `oversized payload: ${serialized.length} bytes (max ${MAX_PAYLOAD_SIZE})`;
  }
  return null;
}

function checkInjection(payload: Record<string, unknown>): string | null {
  const serialized = JSON.stringify(payload);
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(serialized)) {
      return `injection pattern detected: ${pattern.source}`;
    }
  }
  return null;
}

export function classifyAction(action: IpcAction): GuardResult {
  // 1. Payload 尺寸检查
  const sizeError = checkPayloadSize(action.payload);
  if (sizeError) {
    logger.warn({ type: action.type, detail: sizeError }, 'IPC blocked: oversized payload');
    return { riskLevel: 'risky', verdict: 'blocked', detail: sizeError };
  }

  // 2. 注入模式检查
  const injectionError = checkInjection(action.payload);
  if (injectionError) {
    logger.warn({ type: action.type, detail: injectionError }, 'IPC flagged: injection pattern');
    // 注入不直接 block，但提升风险等级
    const rule = ACTION_RULES[action.type] ?? DEFAULT_RULE;
    return {
      riskLevel: 'risky',
      verdict: rule.autoApprove ? 'pass' : 'needs_approval',
      detail: injectionError,
    };
  }

  // 3. 规则表匹配
  const rule = ACTION_RULES[action.type] ?? DEFAULT_RULE;

  return {
    riskLevel: rule.riskLevel,
    verdict: rule.autoApprove ? 'pass' : 'needs_approval',
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/ipc-guard.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ipc-guard.ts src/ipc-guard.test.ts
git commit -m "feat: add IPC Guard with action classification and injection detection"
```

---

## Task 4: IPC Guard 集成到 ipc.ts

**Files:**
- Modify: `src/ipc.ts:63-133` (processIpcFiles 中每条 IPC 处理前插入 guard)
- Modify: `src/ipc.ts:1-28` (import 和 IpcDeps 增加 audit 依赖)
- Create: `src/ipc-guard-integration.test.ts`

**Step 1: Write the integration test**

```typescript
// src/ipc-guard-integration.test.ts
import { describe, it, expect } from 'vitest';
import { classifyAction, type IpcAction } from './ipc-guard.js';

describe('IPC Guard integration scenarios', () => {
  it('should pass normal message flow', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { chatJid: 'test@g.us', text: '无人机已起飞' },
    };
    const result = classifyAction(action);
    expect(result.verdict).toBe('pass');
    expect(result.riskLevel).toBe('safe');
  });

  it('should block oversized message (potential DoS)', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { chatJid: 'test@g.us', text: 'A'.repeat(500_000) },
    };
    const result = classifyAction(action);
    expect(result.verdict).toBe('blocked');
  });

  it('should flag XSS injection in message text', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { chatJid: 'test@g.us', text: '<script>document.cookie</script>' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.detail).toContain('injection');
  });

  it('should classify schedule_task as risky but pass', () => {
    const action: IpcAction = {
      type: 'schedule_task',
      payload: {
        prompt: '每日检查无人机状态',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        targetJid: 'main@g.us',
      },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.verdict).toBe('pass');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/ipc-guard-integration.test.ts`
Expected: PASS（复用已有 ipc-guard 逻辑）

**Step 3: Modify ipc.ts — 增加 import 和 guard 调用**

在 `src/ipc.ts` 顶部增加 import：

```typescript
import { classifyAction, type IpcAction, type GuardResult } from './ipc-guard.js';
```

在 `processIpcFiles` 函数中，处理 message 文件的循环内（约第 78 行 `const data = JSON.parse(...)` 之后），插入 guard 检查：

```typescript
// 在 const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); 之后插入：

// IPC Guard: 对每个 IPC action 进行分级审核
const guardResult = classifyAction({
  type: data.type,
  payload: data,
});
if (guardResult.verdict === 'blocked') {
  logger.warn(
    { sourceGroup, type: data.type, detail: guardResult.detail },
    'IPC blocked by guard',
  );
  fs.unlinkSync(filePath);
  continue;
}
// risky 级别记录审计日志
if (guardResult.riskLevel !== 'safe') {
  logger.info(
    { sourceGroup, type: data.type, riskLevel: guardResult.riskLevel, detail: guardResult.detail },
    'IPC action passed with elevated risk',
  );
}
```

同样对 tasks 目录的 IPC 文件处理（约第 148 行）做相同插入。

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS（已有的 ipc-auth.test.ts 应继续通过）

**Step 5: Commit**

```bash
git add src/ipc.ts src/ipc-guard-integration.test.ts
git commit -m "feat: integrate IPC Guard into ipc watcher pipeline"
```

---

## Task 5: 审计日志集成 — 将 Guard 判定写入 DB

**Files:**
- Modify: `src/ipc.ts` (增加 writeAuditLog 调用)
- Modify: `src/index.ts` (增加 writeAuditLog 调用)
- Modify: `src/ipc.ts:13-27` (IpcDeps 增加 db 引用)

**Step 1: Modify IpcDeps to include audit function**

在 `src/ipc.ts` 的 `IpcDeps` 接口中增加：

```typescript
export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
  storeResumeContext: (chatJid: string, context: string) => void;
  writeAuditLog: (entry: import('./types.js').AuditEntry) => void;
}
```

**Step 2: Wire up writeAuditLog in ipc.ts guard calls**

将 Step 4 中的 `logger.info` / `logger.warn` 替换为同时写入审计：

```typescript
// 在 guard blocked 分支
deps.writeAuditLog({
  sourceGroup,
  action: `ipc_${data.type}`,
  riskLevel: guardResult.riskLevel,
  verdict: 'blocked',
  payload: JSON.stringify(data).substring(0, 1000),
  detail: guardResult.detail,
});

// 在 guard passed 但 risky 分支
deps.writeAuditLog({
  sourceGroup,
  action: `ipc_${data.type}`,
  riskLevel: guardResult.riskLevel,
  verdict: 'pass',
  detail: guardResult.detail,
});
```

**Step 3: Wire up writeAuditLog in index.ts for Output Guard**

在 `src/index.ts` 中 Output Guard 的 secretScan 检测处（Step 5 of Task 2）增加审计写入：

```typescript
if (secretScan.hasSecrets) {
  writeAuditLog({
    sourceGroup: group.folder,
    action: 'container_output',
    riskLevel: 'risky',
    verdict: 'redacted',
    payload: secretScan.matches.map(m => m.rule).join(','),
    detail: 'Sensitive information detected in container output',
  });
}
```

在 `src/index.ts` 的 `startIpcWatcher` 调用处，传入 `writeAuditLog`：

```typescript
// 在 startIpcWatcher(deps) 调用处，确保 deps 包含：
startIpcWatcher({
  // ...已有的 deps...
  writeAuditLog: (entry) => writeAuditLog(db, entry),
});
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/ipc.ts src/index.ts
git commit -m "feat: wire audit logging into IPC guard and output guard"
```

---

## Task 6: Input Sanitize — 入站消息净化

**Files:**
- Create: `src/input-sanitize.ts`
- Create: `src/input-sanitize.test.ts`
- Modify: `src/index.ts` (在消息进入 GroupQueue 前净化)

**Step 1: Write the failing test**

```typescript
// src/input-sanitize.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeInput } from './input-sanitize.js';

describe('sanitizeInput', () => {
  it('should strip zero-width characters from user input', () => {
    const input = '飞到​软件园‍三期';
    expect(sanitizeInput(input)).toBe('飞到软件园三期');
  });

  it('should preserve normal Chinese text', () => {
    const input = '让无人机飞到软件园三期F06栋上空100米';
    expect(sanitizeInput(input)).toBe(input);
  });

  it('should strip ANSI escape sequences', () => {
    const input = '\x1b[31m红色文字\x1b[0m';
    expect(sanitizeInput(input)).toBe('红色文字');
  });

  it('should limit extremely long input', () => {
    const input = 'A'.repeat(100_000);
    const result = sanitizeInput(input);
    expect(result.length).toBeLessThanOrEqual(50_000);
  });

  it('should handle empty/null input gracefully', () => {
    expect(sanitizeInput('')).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/input-sanitize.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/input-sanitize.ts
// 入站消息净化，防御 ASCII Smuggling 和异常输入

const MAX_INPUT_LENGTH = 50_000;

// 零宽字符
const ZERO_WIDTH = /[​-‍﻿­⁠-⁤]/g;

// ANSI 转义序列
const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function sanitizeInput(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. 清除零宽字符
  result = result.replace(ZERO_WIDTH, '');

  // 2. 清除 ANSI 转义序列
  result = result.replace(ANSI_ESCAPE, '');

  // 3. 截断超长输入
  if (result.length > MAX_INPUT_LENGTH) {
    result = result.substring(0, MAX_INPUT_LENGTH);
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/input-sanitize.test.ts`
Expected: PASS

**Step 5: Integrate into index.ts**

在 `src/index.ts` 中处理入站消息的位置（消息进入队列前），对 `content` 字段净化：

```typescript
import { sanitizeInput } from './input-sanitize.js';

// 在将消息内容传入 agent 之前（大约在 formatMessages 调用附近）：
// 将 message.content 传入 sanitizeInput
// 注意：在 formatMessages 构建时净化，不修改原始存储
```

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/input-sanitize.ts src/input-sanitize.test.ts src/index.ts
git commit -m "feat: add input sanitization for zero-width chars and ANSI escape"
```

---

## Task 7: Guard 规则配置文件

**Files:**
- Create: `src/guard-config.ts`
- Create: `src/guard-config.test.ts`
- Modify: `src/config.ts` (增加 GUARD_CONFIG_PATH)

**Step 1: Write the failing test**

```typescript
// src/guard-config.test.ts
import { describe, it, expect } from 'vitest';
import { loadGuardConfig, type GuardConfig } from './guard-config.js';

describe('loadGuardConfig', () => {
  it('should return defaults when file does not exist', () => {
    const config = loadGuardConfig('/nonexistent/path.json');
    expect(config.outputGuard.enabled).toBe(true);
    expect(config.ipcGuard.enabled).toBe(true);
    expect(config.inputSanitize.enabled).toBe(true);
  });

  it('should parse valid config JSON', () => {
    // 临时文件测试
    const fs = require('fs');
    const path = '/tmp/test-guard-config.json';
    fs.writeFileSync(path, JSON.stringify({
      outputGuard: { enabled: false },
      ipcGuard: { enabled: true, maxPayloadSize: 100000 },
    }));
    const config = loadGuardConfig(path);
    expect(config.outputGuard.enabled).toBe(false);
    expect(config.ipcGuard.maxPayloadSize).toBe(100000);
    fs.unlinkSync(path);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/guard-config.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/guard-config.ts
import fs from 'fs';
import { logger } from './logger.js';

export interface GuardConfig {
  outputGuard: {
    enabled: boolean;
    scanSecrets: boolean;
    sanitizeUnicode: boolean;
    scrubInternalPaths: boolean;
  };
  ipcGuard: {
    enabled: boolean;
    maxPayloadSize: number;
    blockInjectionPatterns: boolean;
  };
  inputSanitize: {
    enabled: boolean;
    maxInputLength: number;
    stripZeroWidth: boolean;
    stripAnsi: boolean;
  };
  auditLog: {
    enabled: boolean;
    maxPayloadLogSize: number;
  };
}

const DEFAULT_CONFIG: GuardConfig = {
  outputGuard: {
    enabled: true,
    scanSecrets: true,
    sanitizeUnicode: true,
    scrubInternalPaths: true,
  },
  ipcGuard: {
    enabled: true,
    maxPayloadSize: 200_000,
    blockInjectionPatterns: true,
  },
  inputSanitize: {
    enabled: true,
    maxInputLength: 50_000,
    stripZeroWidth: true,
    stripAnsi: true,
  },
  auditLog: {
    enabled: true,
    maxPayloadLogSize: 1000,
  },
};

export function loadGuardConfig(filePath?: string): GuardConfig {
  if (!filePath) return DEFAULT_CONFIG;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 深度合并：用户配置覆盖默认值
    return {
      outputGuard: { ...DEFAULT_CONFIG.outputGuard, ...parsed.outputGuard },
      ipcGuard: { ...DEFAULT_CONFIG.ipcGuard, ...parsed.ipcGuard },
      inputSanitize: { ...DEFAULT_CONFIG.inputSanitize, ...parsed.inputSanitize },
      auditLog: { ...DEFAULT_CONFIG.auditLog, ...parsed.auditLog },
    };
  } catch (err) {
    logger.debug({ filePath, err }, 'Guard config not found or invalid, using defaults');
    return DEFAULT_CONFIG;
  }
}
```

**Step 4: Add config path**

在 `src/config.ts` 中增加：

```typescript
export const GUARD_CONFIG_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'guard-config.json',
);
```

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/guard-config.ts src/guard-config.test.ts src/config.ts
git commit -m "feat: add guard-config with file-based configuration support"
```

---

## Task 8: 容器资源限制

**Files:**
- Modify: `src/container-runner.ts:280-323` (buildContainerArgs 中增加 cgroup 限制)

**Step 1: Add resource limit args to container spawn**

在 `src/container-runner.ts` 的 `buildContainerArgs` 函数中，`args.push(CONTAINER_IMAGE)` 之前增加：

```typescript
// 资源限制：防止失控 Agent 消耗过多资源
args.push('--memory', '512m');
args.push('--memory-swap', '512m');  // 禁止 swap
args.push('--cpus', '1.0');
args.push('--pids-limit', '256');
```

**Step 2: Add config options**

在 `src/config.ts` 中增加（可配置化）：

```typescript
export const CONTAINER_MEMORY_LIMIT = process.env.CONTAINER_MEMORY_LIMIT || '512m';
export const CONTAINER_CPU_LIMIT = process.env.CONTAINER_CPU_LIMIT || '1.0';
export const CONTAINER_PIDS_LIMIT = parseInt(process.env.CONTAINER_PIDS_LIMIT || '256', 10);
```

然后将硬编码值替换为配置变量。

**Step 3: Run tests**

Run: `npx vitest run src/container-runner.test.ts`
Expected: PASS（已有测试验证 args 构建）

**Step 4: Commit**

```bash
git add src/container-runner.ts src/config.ts
git commit -m "feat: add container resource limits (memory, CPU, pids)"
```

---

## Task 9: 完整集成测试

**Files:**
- Create: `src/guard-e2e.test.ts`

**Step 1: Write end-to-end guard pipeline test**

```typescript
// src/guard-e2e.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeOutput, scanForSecrets } from './output-guard.js';
import { classifyAction, type IpcAction } from './ipc-guard.js';
import { sanitizeInput } from './input-sanitize.js';
import { loadGuardConfig } from './guard-config.js';

describe('Guard Pipeline E2E', () => {
  const config = loadGuardConfig();

  it('should sanitize input → pass through agent → sanitize output', () => {
    // 模拟用户输入带零宽字符
    const userInput = '飞到​软件园三期F06';
    const cleanInput = sanitizeInput(userInput);
    expect(cleanInput).toBe('飞到软件园三期F06');

    // 模拟 Agent 输出带敏感信息
    const agentOutput = `任务完成。api_key=sk-abc123def456ghi789 用于验证`;
    const secrets = scanForSecrets(agentOutput);
    expect(secrets.hasSecrets).toBe(true);

    const cleanOutput = sanitizeOutput(agentOutput);
    expect(cleanOutput).not.toContain('sk-abc123');
    expect(cleanOutput).toContain('[REDACTED]');
  });

  it('should block malicious IPC then audit-log the block', () => {
    const maliciousIpc: IpcAction = {
      type: 'message',
      payload: { text: 'x'.repeat(300_000) },
    };
    const result = classifyAction(maliciousIpc);
    expect(result.verdict).toBe('blocked');
    expect(result.riskLevel).toBe('risky');
  });

  it('should allow normal flight control flow', () => {
    const normalMessage: IpcAction = {
      type: 'message',
      payload: { chatJid: 'main@g.us', text: '无人机已安全返航' },
    };
    const result = classifyAction(normalMessage);
    expect(result.verdict).toBe('pass');
    expect(result.riskLevel).toBe('safe');

    const output = sanitizeOutput('无人机已安全返航，高度0米');
    expect(output).toBe('无人机已安全返航，高度0米');
  });

  it('config should enable all guards by default', () => {
    expect(config.outputGuard.enabled).toBe(true);
    expect(config.ipcGuard.enabled).toBe(true);
    expect(config.inputSanitize.enabled).toBe(true);
    expect(config.auditLog.enabled).toBe(true);
  });
});
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/guard-e2e.test.ts
git commit -m "test: add end-to-end guard pipeline integration test"
```

---

## Task 10: 更新 CLAUDE.md 文档

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add guard system documentation**

在 CLAUDE.md 的 Architecture 部分增加：

```markdown
**Guard system** (`src/output-guard.ts`, `src/ipc-guard.ts`, `src/input-sanitize.ts`): Three-layer security pipeline. Output Guard scans container output for secrets/unicode injection. IPC Guard classifies actions by risk level (safe/risky/dangerous) and blocks oversized or malicious payloads. Input Sanitize strips zero-width characters and ANSI escapes from inbound messages. All guard decisions are logged to the `audit_logs` SQLite table. Configurable via `~/.config/nanoclaw/guard-config.json`.

**Audit log** (`src/audit-log.ts`): All guard decisions (pass/blocked/redacted/approved) are recorded to the `audit_logs` table with source group, action type, risk level, and detail. Query via `queryAuditLogs(db, { verdict: 'blocked' })`.
```

在 Configuration 表格中增加：

```markdown
| `GUARD_CONFIG_PATH` | `~/.config/nanoclaw/guard-config.json` | Guard system configuration file |
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document guard system architecture in CLAUDE.md"
```
