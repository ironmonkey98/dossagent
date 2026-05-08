/**
 * API Key 解码工具
 *
 * .env 中 API Key 使用 Base64 编码存储。
 * 运行时自动解码，解码失败则视为明文（向后兼容）。
 *
 * 编码方式：
 *   node -e "console.log(Buffer.from('your-api-key').toString('base64'))"
 *
 * 解码示例：
 *   c2stNjRl... → sk-64e8...
 */
'use strict';

/**
 * 解码 API Key（Base64 解码，失败则原样返回）
 * @param {string} raw - 原始值，可能是 Base64 编码或明文
 * @returns {string|null} 解码后的明文 Key，raw 为空时返回 null
 */
function decodeApiKey(raw) {
  if (!raw) return null;

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    // 校验：解码结果应可读（含 ASCII 可打印字符），且与原文不同
    if (decoded && decoded !== raw && /^[\x20-\x7e]+$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // 解码失败，视为明文
  }

  return raw;
}

/**
 * 检查 API Key 是否已配置（排除占位符）
 * @param {string} raw - .env 中的原始值
 * @returns {boolean}
 */
function isApiKeyConfigured(raw) {
  if (!raw) return false;

  const decoded = decodeApiKey(raw);
  if (!decoded) return false;

  // 排除占位符值
  return !decoded.includes('your-') && !decoded.includes('-here');
}

module.exports = { decodeApiKey, isApiKeyConfigured };
