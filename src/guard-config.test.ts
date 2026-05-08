import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadGuardConfig } from './guard-config.js';

const TEST_CONFIG_PATH = path.join('/tmp', 'test-guard-config.json');

afterEach(() => {
  try {
    fs.unlinkSync(TEST_CONFIG_PATH);
  } catch {
    /* ignore */
  }
});

describe('loadGuardConfig', () => {
  it('should return defaults when file does not exist', () => {
    const config = loadGuardConfig('/nonexistent/path.json');
    expect(config.outputGuard.enabled).toBe(true);
    expect(config.ipcGuard.enabled).toBe(true);
    expect(config.inputSanitize.enabled).toBe(true);
    expect(config.auditLog.enabled).toBe(true);
  });

  it('should return defaults when no path provided', () => {
    const config = loadGuardConfig();
    expect(config.outputGuard.scanSecrets).toBe(true);
    expect(config.ipcGuard.maxPayloadSize).toBe(200_000);
  });

  it('should parse valid config JSON with partial override', () => {
    fs.writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        outputGuard: { enabled: false },
        ipcGuard: { maxPayloadSize: 100000 },
      }),
    );
    const config = loadGuardConfig(TEST_CONFIG_PATH);
    expect(config.outputGuard.enabled).toBe(false);
    expect(config.outputGuard.scanSecrets).toBe(true); // default preserved
    expect(config.ipcGuard.maxPayloadSize).toBe(100000);
    expect(config.ipcGuard.enabled).toBe(true); // default preserved
  });

  it('should handle invalid JSON gracefully', () => {
    fs.writeFileSync(TEST_CONFIG_PATH, 'not json {{{');
    const config = loadGuardConfig(TEST_CONFIG_PATH);
    expect(config.outputGuard.enabled).toBe(true); // falls back to default
  });

  it('should have all expected config sections', () => {
    const config = loadGuardConfig();
    expect(config).toHaveProperty('outputGuard');
    expect(config).toHaveProperty('ipcGuard');
    expect(config).toHaveProperty('inputSanitize');
    expect(config).toHaveProperty('auditLog');
  });
});
