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

  it('should handle empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('should strip multiple zero-width types', () => {
    // U+200B zero-width space, U+200C zero-width non-joiner, U+FEFF BOM
    const input = 'a​b‌c﻿d';
    expect(sanitizeInput(input)).toBe('abcd');
  });

  it('should handle complex ANSI codes', () => {
    const input = '\x1b[1;32;40mOK\x1b[0m';
    expect(sanitizeInput(input)).toBe('OK');
  });

  it('should preserve English and numbers', () => {
    const input = 'Fly to point N24.48 E118.10 at 120m';
    expect(sanitizeInput(input)).toBe(input);
  });
});
