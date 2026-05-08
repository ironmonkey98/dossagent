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

  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}
