/**
 * 设备缓存管理
 *
 * 将设备列表（机场 + 无人机）持久化到本地文件 .device_cache.json，
 * 每次操作前优先读取缓存，避免频繁调用后端接口。
 *
 * 缓存数据结构：
 *   { docks: [ { dockCode, dockName, dockId, model, online, cameraIndex, zoneName, available,
 *                aircraft: { deviceCode, deviceName, deviceId, model, online, cameraIndex },
 *                longitude, latitude } ],
 *     lastRefreshed: <timestamp ms> }
 *
 * 缓存文件位置：uav-agent/server/lib/.device_cache.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '.device_cache.json');

// ─────────────────────────────────────────────
// 基础读写
// ─────────────────────────────────────────────

/**
 * 读取设备缓存
 * @returns {{ docks: Array, lastRefreshed: number }|null}
 */
function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!Array.isArray(data.docks)) return null;
    return data;
  } catch (e) {
    console.log('  ⚠️  设备缓存读取失败: ' + e.message);
    return null;
  }
}

/**
 * 保存设备列表到缓存文件
 * @param {Array} docks - 机场设备数组
 */
function saveCache(docks) {
  const data = { docks, lastRefreshed: Date.now() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  💾 设备缓存已保存（共 ${docks.length} 个机场）`);
}

/**
 * 清除设备缓存文件
 */
function clearCache() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
    console.log('  🗑️  设备缓存已清除');
  }
}

// ─────────────────────────────────────────────
// 内部工具：模糊匹配评分
// ─────────────────────────────────────────────

/**
 * 对目标字符串按关键词计算模糊匹配分数
 * 支持正向匹配（设备名含关键词）和反向匹配（消息含设备名/标识符）
 * @param {string} target   - 被匹配的字符串（设备名）
 * @param {string} keyword  - 原始关键词（用户消息或搜索词）
 * @returns {number} 0(不匹配) / 40~100
 */
function calcScore(target, keyword) {
  if (!target || !keyword) return 0;

  const t = target.toLowerCase();
  const k = keyword.toLowerCase();

  // === 正向匹配：设备名匹配关键词 ===
  // 完全匹配
  if (t === k) return 100;
  // 前缀匹配
  if (t.startsWith(k)) return 80;
  // 包含匹配
  if (t.includes(k)) return 60;

  // 去除“无人机”/“飞机”后缀后再匹配
  const stripped = k.replace(/(无人机|飞机)$/, '').trim();
  if (stripped && stripped !== k) {
    if (t === stripped)            return 100;
    if (t.startsWith(stripped))    return 80;
    if (t.includes(stripped))      return 60;
  }

  // === 反向匹配：用户消息包含设备名或其核心部分 ===
  if (k.includes(t)) return 50;

  // 去除设备名后缀后检查
  const tStripped = t.replace(/(无人机|飞机|机场)$/, '').trim();
  if (tStripped && tStripped !== t && k.includes(tStripped)) return 45;

  // === 标识符匹配：提取设备名中的字母+数字编号（如A01、F06）===
  const ids = t.match(/[a-z]\d+/gi) || [];
  for (const id of ids) {
    if (k.includes(id.toLowerCase())) return 40;
  }

  return 0;
}

// ─────────────────────────────────────────────
// 查询方法
// ─────────────────────────────────────────────

/**
 * 按名称模糊匹配无人机（搜索所有机场的 aircraft.deviceName）
 * @param {string} keyword
 * @returns {Array<{ dockCode, dockName, aircraft: { deviceCode, deviceName, model, online }, available, zoneName, score }>}
 */
function findAircraftByName(keyword) {
  const cache = readCache();
  if (!cache) return [];

  const results = [];
  for (const dock of cache.docks) {
    const ac = dock.aircraft;
    if (!ac) continue;
    const score = calcScore(ac.deviceName, keyword);
    if (score > 0) {
      results.push({
        dockCode:  dock.dockCode,
        dockName:  dock.dockName,
        aircraft: {
          deviceCode:  ac.deviceCode,
          deviceName:  ac.deviceName,
          model:       ac.model,
          online:      ac.online,
          cameraIndex: ac.cameraIndex,
        },
        available: dock.available,
        zoneName:  dock.zoneName,
        score
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 按名称模糊匹配机场（搜索 dockName 和 zoneName）
 * @param {string} keyword
 * @returns {Array<{ dockCode, dockName, model, online, available, zoneName, longitude, latitude, score }>}
 */
function findDockByName(keyword) {
  const cache = readCache();
  if (!cache) return [];

  const results = [];
  for (const dock of cache.docks) {
    const scoreByName = calcScore(dock.dockName, keyword);
    const scoreByZone = calcScore(dock.zoneName,  keyword);
    const score = Math.max(scoreByName, scoreByZone);
    if (score > 0) {
      results.push({
        dockCode:  dock.dockCode,
        dockName:  dock.dockName,
        model:     dock.model,
        online:    dock.online,
        available: dock.available,
        zoneName:  dock.zoneName,
        longitude: dock.longitude,
        latitude:  dock.latitude,
        score
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 返回默认机场
 * 优先级：
 *   1. available === true（机场在线 + 飞机空闲）的第一个
 *   2. online === '1' 的第一个
 *   3. 第一个（回退）
 * @returns {{ dockCode: string, dockName: string, aircraft: object|null }|null}
 */
function getDefaultDock() {
  const cache = readCache();
  if (!cache || !cache.docks.length) return null;

  const pick = cache.docks.find(d => d.available === true)
            || cache.docks.find(d => d.online === '1')
            || cache.docks[0];

  return {
    dockCode: pick.dockCode,
    dockName: pick.dockName,
    aircraft: pick.aircraft || null
  };
}

// ─────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────

module.exports = {
  readCache,
  saveCache,
  clearCache,
  findAircraftByName,
  findDockByName,
  getDefaultDock
};
