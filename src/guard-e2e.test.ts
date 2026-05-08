// src/guard-e2e.test.ts
// Guard Pipeline 端到端集成测试
// 测试完整流水线：输入净化 → IPC 分级拦截 → 输出脱敏 → 审计日志

import { describe, it, expect } from 'vitest';
import { sanitizeOutput, scanForSecrets } from './output-guard.js';
import { classifyAction, type IpcAction } from './ipc-guard.js';
import { sanitizeInput } from './input-sanitize.js';
import { loadGuardConfig } from './guard-config.js';
import Database from 'better-sqlite3';
import { writeAuditLog, queryAuditLogs } from './audit-log.js';

describe('Guard Pipeline E2E', () => {
  const config = loadGuardConfig();

  it('should sanitize input → pass through agent → sanitize output', () => {
    // 模拟含零宽字符的用户输入
    const userInput = '飞到​软件园三期F06';
    const cleanInput = sanitizeInput(userInput);
    expect(cleanInput).toBe('飞到软件园三期F06');

    // 模拟 agent 输出包含 API key（20+ 字符以触发规则）
    const agentOutput = '任务完成。api_key=sk-abc123def456ghi789xyz0 用于验证';
    const secrets = scanForSecrets(agentOutput);
    expect(secrets.hasSecrets).toBe(true);

    const cleanOutput = sanitizeOutput(agentOutput);
    expect(cleanOutput).not.toContain('sk-abc123');
    expect(cleanOutput).toContain('[REDACTED]');
  });

  it('should block malicious IPC and record in audit log', () => {
    const db = new Database(':memory:');
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

    // 超大 payload 触发 blocked
    const maliciousIpc: IpcAction = {
      type: 'message',
      payload: { text: 'x'.repeat(300_000) },
    };
    const result = classifyAction(maliciousIpc);
    expect(result.verdict).toBe('blocked');

    // 写入审计日志
    writeAuditLog(db, {
      sourceGroup: 'test',
      action: 'ipc_message',
      riskLevel: 'risky',
      verdict: 'blocked',
      detail: result.detail,
    });

    const audit = queryAuditLogs(db, { verdict: 'blocked' });
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toContain('oversized');
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

    const input = sanitizeInput('起飞到100米高度');
    expect(input).toBe('起飞到100米高度');
  });

  it('config should enable all guards by default', () => {
    expect(config.outputGuard.enabled).toBe(true);
    expect(config.ipcGuard.enabled).toBe(true);
    expect(config.inputSanitize.enabled).toBe(true);
    expect(config.auditLog.enabled).toBe(true);
  });

  it('should handle full pipeline: input sanitize → IPC guard → output guard → audit', () => {
    // Step 1: 含零宽字符和 script 标签的输入
    const rawInput = 'send<script>alert(1)</script>​message';
    const cleanInput = sanitizeInput(rawInput);
    // sanitizeInput 剥离零宽字符，但不处理 <script>
    expect(cleanInput).not.toContain('​');

    // Step 2: IPC guard 检测到注入模式
    const ipcAction: IpcAction = {
      type: 'message',
      payload: { text: cleanInput },
    };
    const ipcResult = classifyAction(ipcAction);
    expect(ipcResult.riskLevel).toBe('risky');
    expect(ipcResult.detail).toContain('injection');

    // Step 3: 输出脱敏 — agent 响应包含 JWT
    const agentResponse = 'Token: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig';
    const secrets = scanForSecrets(agentResponse);
    expect(secrets.hasSecrets).toBe(true);
    const cleanOutput = sanitizeOutput(agentResponse);
    expect(cleanOutput).toContain('[REDACTED]');
  });
});
