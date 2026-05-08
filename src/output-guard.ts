/**
 * Output Guard — 敏感信息过滤
 *
 * 在容器输出和用户消息之间充当安全屏障，防止 API key、token 等机密信息
 * 通过 agent 响应泄露，并剥离容器内部路径和零宽度 Unicode 注入字符。
 */

/** 单条匹配结果 */
export interface SecretMatch {
  rule: string;
  match: string;
}

/** scanForSecrets 的返回值 */
export interface SecretScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
}

/**
 * 敏感信息检测规则
 * 每条规则包含名称、正则表达式和替换模板
 */
const SECRET_RULES: { name: string; pattern: RegExp }[] = [
  // API Key: 匹配 api_key=xxx, apiKey: xxx 等格式
  {
    name: 'api_key',
    pattern:
      /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([\w-]{20,})["']?/gi,
  },
  // Bearer Token
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[\w-._~+/]+=*/gi,
  },
  // 密码
  {
    name: 'password',
    pattern:
      /(?:password|passwd|pwd)\s*[:=]\s*["']?[\S]{6,}["']?/gi,
  },
  // Secret Key（含 AWS 风格的 / 字符）
  {
    name: 'secret_key',
    pattern:
      /(?:secret[_-]?key|secret)\s*[:=]\s*["']?([\w\-/]{16,})["']?/gi,
  },
  // 私钥块（RSA/EC）— 匹配整个 PEM 块
  {
    name: 'private_key_block',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
  },
  // JWT Token (三段式 base64url)
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
  },
];

/** 零宽度 Unicode 字符（ASCII Smuggling 防御） */
const ZERO_WIDTH_PATTERN = /[​-‏﻿­⁠-⁤]/g;

/** 容器内部路径 */
const INTERNAL_PATH_PATTERN = /\/workspace\/(project|skills|extra)\/\S+/g;

/**
 * 扫描文本中是否包含敏感信息
 *
 * @param text - 待扫描的原始文本
 * @returns 检测结果，包含是否发现机密及匹配详情
 */
export function scanForSecrets(text: string): SecretScanResult {
  const matches: SecretMatch[] = [];

  for (const rule of SECRET_RULES) {
    // 重置 lastIndex（规则带有 g 标志，需确保从头开始匹配）
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      matches.push({
        rule: rule.name,
        match: m[0],
      });
    }
  }

  return {
    hasSecrets: matches.length > 0,
    matches,
  };
}

/**
 * 对容器输出进行脱敏处理
 *
 * 依次执行：
 * 1. 敏感信息替换为 [REDACTED]
 * 2. 零宽度 Unicode 字符剥离
 * 3. 容器内部路径替换为 [PATH]
 *
 * @param text - 原始输出文本
 * @returns 脱敏后的安全文本
 */
export function sanitizeOutput(text: string): string {
  // 1. 替换敏感信息
  let sanitized = text;
  for (const rule of SECRET_RULES) {
    sanitized = sanitized.replace(rule.pattern, (match) => {
      // 保留可辨识的前缀以便调试，但隐藏实际值
      if (rule.name === 'private_key_block') {
        return '[REDACTED:PRIVATE_KEY]';
      }
      return '[REDACTED]';
    });
  }

  // 2. 剥离零宽度字符
  sanitized = sanitized.replace(ZERO_WIDTH_PATTERN, '');

  // 3. 替换容器内部路径
  sanitized = sanitized.replace(INTERNAL_PATH_PATTERN, '[PATH]');

  return sanitized;
}
