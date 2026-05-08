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

// IPC payload 最大尺寸
const MAX_PAYLOAD_SIZE = 200_000;

// 危险注入模式
const INJECTION_PATTERNS: RegExp[] = [
  /<script[\s>]/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,  // event handlers like onerror=
];

// Action 分级规则表
interface ActionRule {
  riskLevel: RiskLevel;
  autoApprove: boolean;
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
    // Reset lastIndex for global regexes
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(serialized)) {
      return `injection pattern detected: ${pattern.source}`;
    }
  }
  return null;
}

export function classifyAction(action: IpcAction): GuardResult {
  // 1. Payload size check
  const sizeError = checkPayloadSize(action.payload);
  if (sizeError) {
    logger.warn({ type: action.type, detail: sizeError }, 'IPC blocked: oversized payload');
    return { riskLevel: 'risky', verdict: 'blocked', detail: sizeError };
  }

  // 2. Injection pattern check
  const injectionError = checkInjection(action.payload);
  if (injectionError) {
    logger.warn({ type: action.type, detail: injectionError }, 'IPC flagged: injection pattern');
    const rule = ACTION_RULES[action.type] ?? DEFAULT_RULE;
    return {
      riskLevel: 'risky',
      verdict: rule.autoApprove ? 'pass' : 'needs_approval',
      detail: injectionError,
    };
  }

  // 3. Rule table lookup
  const rule = ACTION_RULES[action.type] ?? DEFAULT_RULE;

  return {
    riskLevel: rule.riskLevel,
    verdict: rule.autoApprove ? 'pass' : 'needs_approval',
  };
}
