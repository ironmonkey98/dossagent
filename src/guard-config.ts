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
