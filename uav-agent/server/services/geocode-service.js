/**
 * 地理编码服务 - 地点名称 → 经纬度坐标
 *
 * 复用 uav-control.js 中的 POI 搜索逻辑
 */
'use strict';

const path   = require('path');
const https  = require('https');
const http   = require('http');
const { URL } = require('url');

const MAP_URL = process.env.MAP_URL || 'https://mapserver.xmrbi.com/xmrbi-onecas-mapserver';

// ─── HTTP 请求工具 ──────────────────────────────────

function httpRequest(urlStr, options = {}) {
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
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── 生成地图服务 tk ────────────────────────────────

function generateMapTk() {
  return Buffer.from('xmrbi-mapserver-' + Date.now()).toString('base64');
}

// ─── 地理编码：地点名称 → 经纬度 ────────────────────

/**
 * 地理编码：将地点名称解析为经纬度坐标
 * @param {string} address - 地点名称（如"软件园三期F09栋"）
 * @returns {Promise<{longitude: number, latitude: number, name: string}>}
 */
async function geocode(address) {
  const tk = generateMapTk();

  // 判断是否已包含市级地名，无则默认厦门市
  const CITY_KEYWORDS = ['市', '区', '县', '镇', '省', '自治区'];
  const hasCityHint   = CITY_KEYWORDS.some(k => address.includes(k));
  const region        = hasCityHint ? '' : '厦门市';

  const params = new URLSearchParams({ keywords: address, tk });
  if (region) params.set('region', region);

  const url = `${MAP_URL}/map/server/placeTextSearch?${params.toString()}`;

  try {
    const res = await httpRequest(url, { method: 'GET' });

    if (res.status !== 200) {
      throw new Error(`地理编码服务响应异常: HTTP ${res.status}`);
    }

    const pois = res.data?.pois;
    if (!pois || pois.length === 0) {
      throw new Error(`未找到地点"${address}"的坐标，请提供更精确的地址`);
    }

    const location = pois[0].location; // 格式: "经度,纬度"
    const [lon, lat] = location.split(',').map(parseFloat);

    return {
      longitude: lon,
      latitude: lat,
      name: pois[0].name || address,
    };
  } catch (err) {
    throw new Error(`地理编码失败: ${err.message}`);
  }
}

/**
 * 批量解析 actions 中的地点为坐标
 * 修改 actions 中含 address 字段的 action，填入 longitude/latitude
 * @param {Array} actions - 飞控指令数组
 * @returns {Promise<{actions: Array, geocoded: Array<{address, longitude, latitude, name}>}>}
 */
async function resolveActionsGeocode(actions) {
  const geocoded = [];
  const uniqueAddresses = [...new Set(
    actions
      .filter(a => a.address && !a.longitude)
      .map(a => a.address)
  )];

  // 并行解析所有地点
  const geoMap = {};
  await Promise.all(
    uniqueAddresses.map(async (addr) => {
      try {
        const result = await geocode(addr);
        geoMap[addr] = result;
        geocoded.push(result);
      } catch (err) {
        geoMap[addr] = { error: err.message };
      }
    })
  );

  // 填入坐标到 actions
  for (const action of actions) {
    if (action.address && !action.longitude) {
      const geo = geoMap[action.address];
      if (geo && geo.longitude) {
        action.longitude = geo.longitude;
        action.latitude  = geo.latitude;
      }
    }
  }

  return { actions, geocoded };
}

module.exports = { geocode, resolveActionsGeocode, generateMapTk };
