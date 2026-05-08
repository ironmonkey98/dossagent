/**
 * 凭据缓存管理
 *
 * 用 AES-256-GCM 加密账号密码后缓存到本地文件。
 * 后续自动读取缓存，无需重复输入。
 *
 * 加密主密钥从当前机器特征（机器名 + 操作系统用户名）派生，
 * 缓存文件即使被复制到其他机器也无法解密。
 *
 * 缓存文件位置：uav-agent/server/lib/.credentials_cache.json
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const CACHE_FILE = path.join(__dirname, '.credentials_cache.json');
const ALGORITHM  = 'aes-256-gcm';

// ─── 主密钥派生（机器绑定）────────────────────────────────────────────────

/**
 * 从机器特征派生 AES 主密钥（32字节）。
 * 使用 PBKDF2，盐值固定为机器名+用户名拼接，避免跨机器解密。
 */
function deriveMachineKey() {
  const salt = `uav-agent:${os.hostname()}:${os.userInfo().username}`;
  return crypto.pbkdf2Sync(salt, 'uav-agent-cred-v1', 100000, 32, 'sha256');
}

// ─── AES-256-GCM 加解密 ───────────────────────────────────────────────────

function encrypt(plaintext) {
  const key = deriveMachineKey();
  const iv  = crypto.randomBytes(12); // GCM 推荐 12 字节
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return {
    iv:  iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('hex'),
  };
}

function decrypt(payload) {
  const key    = deriveMachineKey();
  const iv     = Buffer.from(payload.iv,   'hex');
  const tag    = Buffer.from(payload.tag,  'hex');
  const data   = Buffer.from(payload.data, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

// ─── 缓存读写 ─────────────────────────────────────────────────────────────

function readCachedCredentials() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const username = decrypt(raw.username);
    const password = decrypt(raw.password);
    console.log(`  ♻️  复用缓存凭据（用户: ${username}）`);
    return { username, password };
  } catch (e) {
    console.log(`  ⚠️  凭据缓存读取失败（${e.message}），需要重新输入`);
    return null;
  }
}

function saveCredentials(username, password) {
  const cached = {
    username: encrypt(username),
    password: encrypt(password),
    savedAt:  Date.now(),
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cached, null, 2), 'utf8');
  console.log('  💾 凭据已加密缓存（AES-256-GCM，机器绑定）');
}

function clearCredentials() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
    console.log('  🗑️  凭据缓存已清除，下次运行将重新询问账号密码');
  } else {
    console.log('  📭 无凭据缓存');
  }
}

/**
 * 强制更新凭据缓存（用户主动提供新账号密码时调用）
 * 同时清除 Token 缓存，确保下次使用新凭据重新登录获取 Token。
 * @param {string} username
 * @param {string} password
 */
function forceSetCredentials(username, password) {
  // 覆盖凭据缓存
  saveCredentials(username, password);
  // 清除旧 Token（凭据变更，旧 Token 不再可信）
  const tokenCache = require('./token-cache');
  tokenCache.clearCache();
}

module.exports = { saveCredentials, clearCredentials, readCachedCredentials, forceSetCredentials };
