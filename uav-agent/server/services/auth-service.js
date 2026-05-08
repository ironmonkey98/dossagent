/**
 * 认证服务 - Token 管理与凭据缓存
 *
 * 使用本地 lib/ 模块（token-cache、credentials-cache）
 * 提供 HTTP API 可调用的认证能力（无需命令行交互）
 */
'use strict';

const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

// SM2 加密（npm 包，Node.js 原生兼容）
const sm2 = require('sm-crypto').sm2;

// 直接引用本地 lib/ 模块（不再依赖 uav-nlp-control 技能脚本）
const tokenCache = require('../lib/token-cache');
const credentialsCache = require('../lib/credentials-cache');

// ─── HTTP 请求工具 ──────────────────────────────────

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── 获取 Token（缓存优先）──────────────────────────

/**
 * 获取有效 Token
 * 1. 先从缓存读取
 * 2. 缓存不存在则从凭据缓存登录
 * 3. 凭据也不存在则返回错误（需要通过 API 设置凭据）
 * @returns {Promise<{token: string, source: string}>}
 */
async function getToken() {
  // 1. 尝试读取 Token 缓存
  const cached = tokenCache.readCachedToken();
  if (cached) {
    return { token: cached, source: 'cache' };
  }

  // 2. 尝试从凭据缓存登录
  const creds = credentialsCache ? credentialsCache.readCachedCredentials() : null;
  if (!creds) {
    return { token: null, source: 'none', error: '需要先配置凭据（POST /api/auth/credentials）' };
  }

  // 3. 使用缓存凭据登录
  try {
    const token = await loginWithCredentials(creds.username, creds.password);
    return { token, source: 'login' };
  } catch (err) {
    return { token: null, source: 'login_failed', error: err.message };
  }
}

// ─── 原始 HTTP 请求（不做 JSON.stringify body，用于 form-urlencoded）──

function httpRequestRaw(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const bodyBuf = typeof body === 'string' ? body : (body ? JSON.stringify(body) : null);
    const reqOpts = {
      hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        ...options.headers,
        ...(bodyBuf ? { 'Content-Length': Buffer.byteLength(bodyBuf) } : {}),
      },
      rejectUnauthorized: false,
    };
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, data }); } });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ─── 使用凭据登录 ───────────────────────────────────

async function loginWithCredentials(username, password) {
  const baseUrl = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';

  console.log(`[auth] 登录 ${baseUrl}，用户: ${username}`);

  // Step 1: 获取公钥（通过 /sys/sysConfig/getConfig，此接口无需认证）
  const configRes = await httpRequest(`${baseUrl}/sys/sysConfig/getConfig`, { method: 'GET' });
  if (configRes.status !== 200 || !configRes.data?.pubKey) {
    throw new Error(`获取公钥失败: HTTP ${configRes.status} - ${JSON.stringify(configRes.data).substring(0, 200)}`);
  }
  const pubKey = configRes.data.pubKey;
  console.log(`[auth] 公钥获取成功: ${pubKey.substring(0, 40)}...`);

  // Step 2: SM2 加密密码（Base64编码 → SM2加密 → 04前缀）
  const passwordBase64 = Buffer.from(password, 'utf8').toString('base64');
  const encryptedPassword = '04' + sm2.doEncrypt(passwordBase64, pubKey, 0);

  // Step 3: 调用 /sys/login 接口（application/x-www-form-urlencoded）
  const postData = new URLSearchParams({
    userName: username,
    password: encryptedPassword,
  }).toString();

  const loginRes = await httpRequestRaw(`${baseUrl}/sys/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, postData);

  if (loginRes.status !== 200) {
    throw new Error(`登录接口返回 HTTP ${loginRes.status}: ${JSON.stringify(loginRes.data).substring(0, 200)}`);
  }

  const result = loginRes.data;
  if (!result.success || !result.token) {
    throw new Error(`登录失败: ${result.msg || JSON.stringify(result).substring(0, 200)}`);
  }

  // Step 4: 缓存 Token 和用户信息
  const exptime = result.exptime || (Date.now() + 48 * 60 * 60 * 1000);
  if (tokenCache) {
    let userInfo = { userId: '', loginName: username, useunitId: '' };
    try {
      const userRes = await httpRequest(`${baseUrl}/sys/user/info`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${result.token}` },
      });
      if (userRes.data?.user?.id) {
        userInfo = {
          userId: userRes.data.user.id,
          loginName: userRes.data.user.loginName || username,
          useunitId: userRes.data.user.useunitId || '',
        };
      }
    } catch (e) {
      console.log(`[auth] 获取用户信息失败: ${e.message}`);
    }
    tokenCache.saveToken(result.token, exptime, userInfo);
  }

  console.log(`[auth] 登录成功! Token: ${result.token.substring(0, 30)}...`);
  return result.token;
}

// ─── 获取验证码图片 ──────────────────────────────────

async function getCaptcha() {
  const baseUrl = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';
  return new Promise((resolve, reject) => {
    const parsed = new URL(baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname.replace(/\/$/, '')}/sys/verify/image?t=${Date.now()}`,
      method: 'GET',
      rejectUnauthorized: false,
    };
    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      let sessionCookie = '';
      if (res.headers['set-cookie']) {
        const m = res.headers['set-cookie'].join('').match(/wolfking\.xmrbi\.session\.id=([^;]+)/);
        if (m) sessionCookie = 'wolfking.xmrbi.session.id=' + m[1];
      }
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          imageBase64: 'data:image/jpeg;base64,' + buf.toString('base64'),
          sessionCookie,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── 带验证码登录 ──────────────────────────────────

async function loginWithCaptcha(username, password, captcha, sessionCookie) {
  const baseUrl = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';

  console.log(`[auth] 带验证码登录 ${baseUrl}，用户: ${username}`);

  // Step 1: 获取公钥
  const configRes = await httpRequest(`${baseUrl}/sys/sysConfig/getConfig`, { method: 'GET' });
  if (configRes.status !== 200 || !configRes.data?.pubKey) {
    throw new Error(`获取公钥失败: HTTP ${configRes.status}`);
  }
  const pubKey = configRes.data.pubKey;

  // Step 2: SM2 加密密码
  const passwordBase64 = Buffer.from(password, 'utf8').toString('base64');
  const encryptedPassword = '04' + sm2.doEncrypt(passwordBase64, pubKey, 0);

  // Step 3: 带验证码和 Session Cookie 登录
  const postData = new URLSearchParams({
    userName: username,
    password: encryptedPassword,
    captcha: captcha,
  }).toString();

  const loginRes = await httpRequestRaw(`${baseUrl}/sys/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionCookie,
    },
  }, postData);

  if (loginRes.status !== 200) {
    throw new Error(`登录接口返回 HTTP ${loginRes.status}`);
  }

  const result = loginRes.data;
  if (!result.success || !result.token) {
    throw new Error(`登录失败: ${result.msg || JSON.stringify(result).substring(0, 200)}`);
  }

  // Step 4: 缓存 Token 和用户信息
  const exptime = result.exptime || (Date.now() + 48 * 60 * 60 * 1000);
  if (tokenCache) {
    let userInfo = { userId: '', loginName: username, useunitId: '' };
    try {
      const userRes = await httpRequest(`${baseUrl}/sys/user/info`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${result.token}` },
      });
      if (userRes.data?.user?.id) {
        userInfo = {
          userId: userRes.data.user.id,
          loginName: userRes.data.user.loginName || username,
          useunitId: userRes.data.user.useunitId || '',
        };
      }
    } catch (e) {
      console.log(`[auth] 获取用户信息失败: ${e.message}`);
    }
    tokenCache.saveToken(result.token, exptime, userInfo);
  }

  console.log(`[auth] 登录成功! Token: ${result.token.substring(0, 30)}...`);
  return result.token;
}

// ─── 设置凭据（API 方式，替代命令行交互）─────────────

/**
 * 设置凭据并缓存
 * @param {string} username
 * @param {string} password
 */
function setCredentials(username, password) {
  credentialsCache.forceSetCredentials(username, password);
  return { username };
}

// ─── 清除凭据和 Token ──────────────────────────────

function clearAll() {
  if (tokenCache) tokenCache.clearCache();
  if (credentialsCache) credentialsCache.clearCredentials();
}

// ─── 获取凭据状态 ──────────────────────────────────

function getStatus() {
  const hasCreds = credentialsCache ? !!credentialsCache.readCachedCredentials() : false;
  const token = tokenCache ? tokenCache.readCachedToken() : null;
  return {
    hasCredentials: hasCreds,
    hasToken: !!token,
    tokenPreview: token ? token.substring(0, 20) + '...' : null,
  };
}

module.exports = { getToken, setCredentials, clearAll, getStatus, loginWithCredentials, getCaptcha, loginWithCaptcha };
