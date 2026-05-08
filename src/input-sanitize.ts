// src/input-sanitize.ts
// 入站消息净化，防御 ASCII Smuggling 和异常输入

const MAX_INPUT_LENGTH = 50_000;

// 零宽字符 (U+200B-U+200D, U+FEFF, U+00AD, U+2060-U+2064)
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
