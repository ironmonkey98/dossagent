import { describe, it, expect } from 'vitest';
import { scanForSecrets, sanitizeOutput } from './output-guard.js';

describe('scanForSecrets', () => {
  it('should detect API keys', () => {
    const text = 'config: api_key=sk-abc123def456ghi789jkl012mno345';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].rule).toBe('api_key');
    expect(result.matches[0].match).toContain('sk-abc123def456ghi789jkl012mno345');
  });

  it('should detect API keys with colon format', () => {
    const text = 'apikey: "sk-proj-abc123def456ghi789jkl"';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches[0].rule).toBe('api_key');
  });

  it('should detect Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc==';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    const bearerMatch = result.matches.find((m) => m.rule === 'bearer_token');
    expect(bearerMatch).toBeDefined();
    expect(bearerMatch!.match).toContain('Bearer');
  });

  it('should pass clean Chinese text without false positives', () => {
    const text =
      '无人机航线规划已完成，飞行状态正常。预计到达时间：14:30。' +
      '航班号 CA1234，起飞机场：北京首都国际机场。';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('should detect password patterns', () => {
    const text = 'password="mySecretP@ss123!"';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    const pwdMatch = result.matches.find((m) => m.rule === 'password');
    expect(pwdMatch).toBeDefined();
  });

  it('should detect passwd variant', () => {
    const text = 'passwd: supersecret123!';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.rule === 'password')).toBe(true);
  });

  it('should detect secret_key patterns', () => {
    const text = 'secret_key=wJalrXUtnFEMI/K7MDENG12345678';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    const skMatch = result.matches.find((m) => m.rule === 'secret_key');
    expect(skMatch).toBeDefined();
  });

  it('should detect RSA private key blocks', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowI...\n-----END RSA PRIVATE KEY-----';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.rule === 'private_key_block')).toBe(true);
  });

  it('should detect EC private key blocks', () => {
    const text = '-----BEGIN EC PRIVATE KEY-----\nMHQCAQ...\n-----END EC PRIVATE KEY-----';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.rule === 'private_key_block')).toBe(true);
  });

  it('should detect JWT tokens', () => {
    const text =
      'token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    const jwtMatch = result.matches.find((m) => m.rule === 'jwt');
    expect(jwtMatch).toBeDefined();
    expect(jwtMatch!.match).toMatch(/^eyJ/);
  });

  it('should detect multiple secrets in one text', () => {
    const text =
      'api_key=sk-abc123def456ghi789jkl012mno345 and password="hunter2xyz!"';
    const result = scanForSecrets(text);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('sanitizeOutput', () => {
  it('should redact API keys with [REDACTED]', () => {
    const text = 'Your api_key=sk-abc123def456ghi789jkl012mno345 is ready';
    const result = sanitizeOutput(text);
    expect(result).not.toContain('sk-abc123def456ghi789jkl012mno345');
    expect(result).toContain('[REDACTED]');
  });

  it('should strip zero-width characters (U+200B)', () => {
    const text = 'Hello​World';
    const result = sanitizeOutput(text);
    expect(result).toBe('HelloWorld');
  });

  it('should strip zero-width joiner (U+200D)', () => {
    const text = 'data‍hidden';
    const result = sanitizeOutput(text);
    expect(result).toBe('datahidden');
  });

  it('should strip BOM (U+FEFF)', () => {
    const text = '﻿start of text';
    const result = sanitizeOutput(text);
    expect(result).toBe('start of text');
  });

  it('should strip soft hyphen (U+00AD) used in smuggling', () => {
    const text = 'invis­ible';
    const result = sanitizeOutput(text);
    expect(result).toBe('invisible');
  });

  it('should strip container internal paths', () => {
    const text = 'File saved to /workspace/project/src/index.ts';
    const result = sanitizeOutput(text);
    expect(result).not.toContain('/workspace/project/');
    expect(result).toContain('[PATH]');
  });

  it('should strip /workspace/skills/ paths', () => {
    const text = 'Loading skill from /workspace/skills/doss-fly/SKILL.md';
    const result = sanitizeOutput(text);
    expect(result).toContain('[PATH]');
    expect(result).not.toContain('/workspace/skills/');
  });

  it('should strip /workspace/extra/ paths', () => {
    const text = 'Referenced /workspace/extra/config.json';
    const result = sanitizeOutput(text);
    expect(result).toContain('[PATH]');
    expect(result).not.toContain('/workspace/extra/');
  });

  it('should preserve normal Chinese text unchanged', () => {
    const text = '无人机航线规划已完成，飞行状态正常。';
    const result = sanitizeOutput(text);
    expect(result).toBe(text);
  });

  it('should redact private key blocks with specific label', () => {
    const text =
      'Here is the key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIABCDEF...\n-----END RSA PRIVATE KEY-----';
    const result = sanitizeOutput(text);
    expect(result).toContain('[REDACTED:PRIVATE_KEY]');
    expect(result).not.toContain('MIIEowIABCDEF');
    // 确保 END 标记也被替换
    expect(result).not.toContain('-----END RSA PRIVATE KEY-----');
  });

  it('should handle text with no issues (identity)', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(sanitizeOutput(text)).toBe(text);
  });

  it('should redact Bearer tokens', () => {
    const text = 'Authorization: Bearer abc123tokenXYZ==';
    const result = sanitizeOutput(text);
    expect(result).not.toContain('abc123tokenXYZ');
    expect(result).toContain('[REDACTED]');
  });
});
