/**
 * Token 缓存管理
 *
 * 将 Token 持久化到本地文件 .token_cache.json，
 * 每次操作前优先读取缓存，未过期则直接复用，避免重复登录。
 *
 * Token 有效期：生产环境约为 48 小时（exptime 字段），缓存提前 5 分钟失效。
 *
 * 缓存文件位置：uav-agent/server/lib/.token_cache.json
 */

const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '.token_cache.json');
const EXPIRE_BUFFER_MS = 5 * 60 * 1000; // 提前5分钟视为过期

/**
 * 读取缓存的 Token
 * @returns {string|null} 有效的 token 字符串，或 null（缓存不存在/已过期）
 */
function readCachedToken() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    // 拒绝假 token（模拟/测试用的占位符）
    if (cache.token && (cache.token.startsWith('simulated') || cache.token.startsWith('fake') || cache.token.startsWith('test'))) {
      console.log('  ⚠️  检测到模拟 Token，忽略缓存');
      return null;
    }
    const now = Date.now();
    if (cache.token && cache.exptime && (cache.exptime - EXPIRE_BUFFER_MS) > now) {
      const remaining = Math.floor((cache.exptime - now) / 1000 / 60);
      console.log(`  ♻️  复用缓存 Token（剩余有效期约 ${remaining} 分钟）`);
      return cache.token;
    }
    console.log('  ⏰ Token 缓存已过期，需要重新登录');
    return null;
  } catch (e) {
    console.log('  ⚠️  Token 缓存读取失败: ' + e.message);
    return null;
  }
}

/**
 * 保存 Token 到缓存文件
 * @param {string} token - JWT token 字符串
 * @param {number} exptime - 过期时间戳（毫秒），来自登录响应的 exptime 字段
 * @param {object} [userInfo] - 可选，用户信息 { userId, loginName, useunitId }
 */
function saveToken(token, exptime, userInfo) {
  const cache = { token, exptime, savedAt: Date.now(), userInfo: userInfo || null };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  const remainMin = Math.floor((exptime - Date.now()) / 1000 / 60);
  console.log(`  💾 Token 已缓存（有效期约 ${remainMin} 分钟）`);
}

/**
 * 读取缓存的用户信息
 * @returns {{ userId:string, loginName:string, useunitId:string }|null}
 */
function readCachedUserInfo() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return cache.userInfo || null;
  } catch (e) {
    return null;
  }
}

/**
 * 更新缓存文件中的用户信息（不影响 Token）
 * @param {{ userId:string, loginName:string, useunitId:string }} userInfo
 */
function saveUserInfo(userInfo) {
  if (!fs.existsSync(CACHE_FILE)) return;
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cache.userInfo = userInfo;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * 清除缓存（登出或强制重新登录时使用）
 */
function clearCache() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
    console.log('  🗑️  Token 缓存已清除');
  }
}

/**
 * 显示当前缓存状态
 */
function showCacheStatus() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('  📭 无 Token 缓存');
    return;
  }
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const now = Date.now();
    const valid = cache.exptime && (cache.exptime - EXPIRE_BUFFER_MS) > now;
    const remaining = valid ? Math.floor((cache.exptime - now) / 1000 / 60) : 0;
    const savedTime = new Date(cache.savedAt).toLocaleString('zh-CN');
    console.log(`  📦 Token 缓存状态:`);
    console.log(`     保存时间: ${savedTime}`);
    console.log(`     状态: ${valid ? '✅ 有效（剩余约 ' + remaining + ' 分钟）' : '❌ 已过期'}`);
    console.log(`     Token 前50字符: ${cache.token ? cache.token.substring(0, 50) + '...' : 'N/A'}`);
  } catch (e) {
    console.log('  ⚠️  缓存文件损坏');
  }
}

module.exports = { readCachedToken, saveToken, clearCache, showCacheStatus, readCachedUserInfo, saveUserInfo };
