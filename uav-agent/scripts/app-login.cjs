/**
 * /app/sys/login 免验证码登录 + 缓存 token + userInfo
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');
const { URL } = require('url');
const sm2 = require('sm-crypto').sm2;
const creds = require('../server/lib/credentials-cache');
const tokenCache = require('../server/lib/token-cache');

const baseUrl = process.env.UAV_BASE_URL;

function httpsPost(urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const bodyBuf = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname, port: 443, path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyBuf), ...headers },
      rejectUnauthorized: false,
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function httpsGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    https.get({ hostname: parsed.hostname, path: parsed.pathname, port: 443, rejectUnauthorized: false, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

async function run() {
  const { username, password } = creds.readCachedCredentials();
  console.log(`登录用户: ${username}`);

  // 1. 获取公钥
  const configRes = await httpsGet(`${baseUrl}/sys/sysConfig/getConfig`);
  const pubKey = configRes.pubKey;
  console.log(`公钥: ${pubKey?.substring(0, 30)}...`);

  // 2. SM2 加密
  const pwd64 = Buffer.from(password, 'utf8').toString('base64');
  const encPwd = '04' + sm2.doEncrypt(pwd64, pubKey, 0);

  // 3. /app/sys/login（免验证码）
  const loginRes = await httpsPost(`${baseUrl}/app/sys/login`, {
    userName: username,
    password: encPwd,
    exptime: Date.now() + 48 * 3600 * 1000,
  });

  if (!loginRes.token) {
    console.error('登录失败:', loginRes.msg || JSON.stringify(loginRes).substring(0, 300));
    process.exit(1);
  }

  const token = loginRes.token;
  const exptime = loginRes.exptime || (Date.now() + 48 * 3600 * 1000);
  console.log(`Token: ${token.substring(0, 30)}...`);

  // 4. 获取 userInfo
  let userInfo = { userId: '', loginName: username, useunitId: '' };
  try {
    const userRes = await httpsGet(`${baseUrl}/sys/user/info`, { 'Authorization': `Bearer ${token}` });
    if (userRes.user?.id) {
      userInfo = {
        userId: userRes.user.id,
        loginName: userRes.user.loginName || username,
        useunitId: userRes.user.useunitId || '',
      };
    }
  } catch (e) {
    console.log(`userInfo 获取失败: ${e.message}`);
  }
  console.log(`userInfo: ${JSON.stringify(userInfo)}`);

  // 5. 缓存
  tokenCache.saveToken(token, exptime, userInfo);
  console.log('✅ Token + userInfo 已缓存');
}

run().catch(e => console.error(e));
