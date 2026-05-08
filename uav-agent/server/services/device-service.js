/**
 * 设备服务模块
 *
 * 负责设备列表的加载、缓存管理、设备名称解析及近邻机场查询。
 * 依赖：device-cache、token-cache、geocode-service、auth-service
 */
'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const _deviceCache = require('../lib/device-cache');
const _tokenCache  = require('../lib/token-cache');

const BASE_URL = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';

// 设备缓存有效期：24 小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── HTTP 请求工具（与 flight-service.js 一致）────────────────────────────────

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    };
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', c => data += c);
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

async function callCockpitGet(token, endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Authorization': `Bearer ${token}` };
  const res = await httpRequest(url, { method: 'GET', headers });
  if ([401, 402, 403].includes(res.status)) {
    const detail = (res.data && (res.data.msg || res.data.message))
      ? `: ${res.data.msg || res.data.message}` : '';
    throw new Error(`Token已失效${detail}`);
  }
  if (res.status !== 200) throw new Error(`接口响应异常: HTTP ${res.status}`);
  return res.data;
}

// ─── Haversine 距离计算 ────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 公共方法 ─────────────────────────────────────────────────────────────────

/**
 * 调用 zoneListDeviceInfo API，解析并缓存设备列表。
 * 对每个机场尝试地理编码获取坐标（失败静默跳过）。
 * @param {string} token - Bearer Token
 * @returns {Promise<number>} 加载的 dock 数量
 */
async function loadDevices(token) {
  console.log('[device] 开始加载设备列表...');

  const endpoint = '/uav/videoWall/zoneListDeviceInfo';

  const result = await callCockpitGet(token, endpoint);

  if (!result || result.success === false) {
    throw new Error(`设备列表接口返回失败: ${result && (result.msg || result.message) || '未知错误'}`);
  }

  // 新接口返回 { list: [{ name, id, deviceList: [{dockData, aircraftData}] }] }
  const zones = (result && Array.isArray(result.list)) ? result.list : [];
  console.log(`[device] API 返回 ${zones.length} 个区域`);

  // 延迟加载 geocode-service，避免循环依赖
  let geocode = null;
  try {
    geocode = require('./geocode-service').geocode;
  } catch (e) {
    console.log('[device] ⚠️  geocode-service 加载失败，跳过坐标解析');
  }

  const docks = [];
  for (const zone of zones) {
    if (!Array.isArray(zone.deviceList)) continue;
    for (const device of zone.deviceList) {
      const dockRaw    = device.dockData;
      const aircraftRaw = device.aircraftData;
      if (!dockRaw) continue; // 必须有机场数据

      const dock = {
        dockCode:    dockRaw.deviceCode,
        dockName:    dockRaw.deviceName,
        dockId:      dockRaw.id,
        model:       dockRaw.model,
        online:      dockRaw.online,
        cameraIndex: dockRaw.cameraIndex,
        zoneName:    zone.name,
        aircraft:    aircraftRaw ? {
          deviceCode:  aircraftRaw.deviceCode,
          deviceName:  aircraftRaw.deviceName,
          deviceId:    aircraftRaw.id,
          model:       aircraftRaw.model,
          online:      aircraftRaw.online,
          cameraIndex: aircraftRaw.cameraIndex,
        } : null,
        // 机场在线 + 飞机离线 = 可用（飞机待命于机场内）
        available: dockRaw.online === '1' && aircraftRaw != null && aircraftRaw.online === '0',
        longitude: null,
        latitude:  null,
      };

      // 尝试地理编码
      if (geocode && dockRaw.deviceName) {
        try {
          const geo = await geocode(dockRaw.deviceName);
          if (geo && geo.longitude != null && geo.latitude != null) {
            dock.longitude = geo.longitude;
            dock.latitude  = geo.latitude;
            console.log(`[device] 机场 "${dockRaw.deviceName}" 地理编码成功: (${geo.longitude}, ${geo.latitude})`);
          }
        } catch (geoErr) {
          console.log(`[device] ⚠️  机场 "${dockRaw.deviceName}" 地理编码失败（已跳过）: ${geoErr.message}`);
        }
      }

      docks.push(dock);
    }
  }

  _deviceCache.saveCache(docks);
  console.log(`[device] 设备列表加载完成，共 ${docks.length} 个机场`);
  return docks.length;
}

/**
 * 确保设备已加载（24 小时内有缓存则直接返回，否则重新加载）。
 * @param {string} [token] - Bearer Token（缓存命中时可不传）
 * @returns {Promise<Array>} docks 数组
 */
async function ensureDevicesLoaded(token) {
  const cache = _deviceCache.readCache();
  if (cache && cache.lastRefreshed && (Date.now() - cache.lastRefreshed) < CACHE_TTL_MS) {
    console.log(`[device] 使用缓存设备列表（共 ${cache.docks.length} 个机场，上次刷新 ${Math.round((Date.now() - cache.lastRefreshed) / 60000)} 分钟前）`);
    return cache.docks;
  }

  if (!token) {
    // 尝试从 token 缓存获取
    token = _tokenCache.readCachedToken();
  }
  if (!token) {
    // 尝试通过 auth-service 获取
    try {
      const authService = require('./auth-service');
      const authResult = await authService.getToken();
      token = authResult.token;
    } catch (e) {
      console.log('[device] ⚠️  无法获取 Token，无法加载设备列表');
    }
  }

  if (!token) {
    // 无 token 时返回已有缓存（即使已过期）或空数组
    return (cache && cache.docks) ? cache.docks : [];
  }

  await loadDevices(token);
  const newCache = _deviceCache.readCache();
  return (newCache && newCache.docks) ? newCache.docks : [];
}

/**
 * 从用户输入文本中提取设备引用。
 * 优先按无人机名称匹配，再按机场名称匹配。
 * @param {string} text - 用户输入文本
 * @returns {{ dockCode: string, aircraftCode: string|null, aircraftName: string|null, dockName: string }|null}
 */
function resolveDeviceFromText(text) {
  if (!text) return null;

  // 优先匹配无人机
  const aircraftMatches = _deviceCache.findAircraftByName(text);
  if (aircraftMatches.length > 0) {
    const best = aircraftMatches[0];
    console.log(`[device] 文本 "${text}" 匹配到无人机: ${best.aircraft.deviceName}（机场: ${best.dockName}，得分: ${best.score}）`);
    return {
      dockCode:     best.dockCode,
      aircraftCode: best.aircraft.deviceCode,
      aircraftName: best.aircraft.deviceName,
      dockName:     best.dockName,
    };
  }

  // 再匹配机场
  const dockMatches = _deviceCache.findDockByName(text);
  if (dockMatches.length > 0) {
    const best = dockMatches[0];
    console.log(`[device] 文本 "${text}" 匹配到机场: ${best.dockName}（得分: ${best.score}）`);
    // 从缓存中取该机场的无人机信息
    const cache = _deviceCache.readCache();
    const dockFull = cache && cache.docks.find(d => d.dockCode === best.dockCode);
    const ac = dockFull && dockFull.aircraft;
    return {
      dockCode:     best.dockCode,
      aircraftCode: ac ? ac.deviceCode : null,
      aircraftName: ac ? ac.deviceName : null,
      dockName:     best.dockName,
    };
  }

  console.log(`[device] 文本 "${text}" 未匹配到任何设备`);
  return null;
}

/**
 * 查找指定坐标周围指定半径内的机场，按距离升序排列。
 * @param {number} longitude  - 目标经度
 * @param {number} latitude   - 目标纬度
 * @param {number} [radiusKm=50] - 搜索半径（公里）
 * @returns {Array<{ dockCode, dockName, longitude, latitude, distanceKm, online, available, zoneName }>}
 */
function findNearbyDocks(longitude, latitude, radiusKm = 50) {
  const cache = _deviceCache.readCache();
  if (!cache || !cache.docks.length) return [];

  const results = [];
  for (const dock of cache.docks) {
    if (dock.longitude == null || dock.latitude == null) continue;
    const dist = haversineKm(latitude, longitude, dock.latitude, dock.longitude);
    if (dist <= radiusKm) {
      results.push({
        dockCode:   dock.dockCode,
        dockName:   dock.dockName,
        longitude:  dock.longitude,
        latitude:   dock.latitude,
        distanceKm: Math.round(dist * 10) / 10,
        online:     dock.online,
        available:  dock.available,
        zoneName:   dock.zoneName,
      });
    }
  }

  // 可用优先，在线次之，距离再次之
  results.sort((a, b) => {
    const availA = a.available ? 0 : 1;
    const availB = b.available ? 0 : 1;
    if (availA !== availB) return availA - availB;
    const onlineA = a.online === '1' ? 0 : 1;
    const onlineB = b.online === '1' ? 0 : 1;
    if (onlineA !== onlineB) return onlineA - onlineB;
    return a.distanceKm - b.distanceKm;
  });
  console.log(`[device] 坐标 (${longitude}, ${latitude}) 半径 ${radiusKm}km 内找到 ${results.length} 个机场`);
  return results;
}

/**
 * 服务启动时自动初始化：尝试用缓存 Token 加载设备列表。
 * 失败时仅打印警告，不抛异常。
 */
async function tryAutoInit() {
  console.log('[device] 启动时强制刷新设备列表...');
  try {
    const token = _tokenCache.readCachedToken();
    if (!token) {
      console.log('[device] ⚠️  无缓存 Token，跳过自动初始化');
      return;
    }

    const count = await loadDevices(token);
    console.log(`[device] 启动刷新完成，共加载 ${count} 个机场`);
  } catch (err) {
    console.log(`[device] ⚠️  启动刷新失败（已忽略）: ${err.message}`);
  }
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
  loadDevices,
  ensureDevicesLoaded,
  resolveDeviceFromText,
  findNearbyDocks,
  tryAutoInit,
};
