import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeAuditLog, queryAuditLogs } from './audit-log.js';
import { AuditEntry } from './types.js';

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
    writeAuditLog(db, {
      sourceGroup: 'main',
      action: 'ipc_message',
      riskLevel: 'safe',
      verdict: 'pass',
    });
    writeAuditLog(db, {
      sourceGroup: 'api',
      action: 'ipc_task',
      riskLevel: 'risky',
      verdict: 'blocked',
    });
    const blocked = queryAuditLogs(db, { verdict: 'blocked' });
    expect(blocked).toHaveLength(1);
    expect(blocked[0].source_group).toBe('api');
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      writeAuditLog(db, {
        sourceGroup: 'main',
        action: 'test',
        riskLevel: 'safe',
        verdict: 'pass',
      });
    }
    const limited = queryAuditLogs(db, { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('should store optional fields', () => {
    const entry: AuditEntry = {
      sourceGroup: 'main',
      action: 'ipc_message',
      riskLevel: 'dangerous',
      verdict: 'approved',
      payload: '{"cmd":"fly"}',
      approver: 'admin',
      detail: 'Manual approval for flight',
    };
    writeAuditLog(db, entry);
    const rows = queryAuditLogs(db, {});
    expect(rows[0].payload).toBe('{"cmd":"fly"}');
    expect(rows[0].approver).toBe('admin');
    expect(rows[0].detail).toBe('Manual approval for flight');
  });
});
