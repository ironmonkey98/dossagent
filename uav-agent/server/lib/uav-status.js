/**
 * UAV 实时状态订阅模块
 *
 * 通过 WebSocket 连接到 doss.xmrbi.com，订阅飞机实时 OSD 状态：
 *   height, speed, verticalSpeed, relativeHeight, longitude, latitude, modeCode
 *   cameraMode, lightBrightness, lightWorkMode
 *
 * 自包含版本：不依赖外部技能脚本，内部引用本地 token-cache。
 *
 * 使用方式：
 *   const uavStatus = require('../lib/uav-status');
 *   await uavStatus.connect(token, uavDeviceId, dockDeviceId);
 *   uavStatus.getHeight();       // 当前飞行高度（海拔）
 *   uavStatus.getSpeed();        // 当前水平速度 m/s
 *   await uavStatus.waitUntilArrived(targetHeightM, timeoutMs, label);
 *   uavStatus.close();
 */
'use strict';

const WebSocket = require('ws');
const { sleep } = require('./simulate-config');
const { readCachedUserInfo } = require('./token-cache');

const WSS_URL = 'wss://doss.xmrbi.com/websocket/';

// ─── 状态容器 ───────────────────────────────────────────────────────────────

let _ws = null;
let _uavState = {
  height:          null,  // 海拔高度（米）
  relativeHeight:  null,  // 相对起飞点高度（米）
  speed:           null,  // 水平速度（m/s）
  verticalSpeed:   null,  // 垂直速度（m/s）
  longitude:       null,
  latitude:        null,
  modeCode:        null,
  cameraMode:      null,  // 相机模式: 0=拍照 1=录像 2=智能低光 3=全景拍照
  lightBrightness: null,  // 探照灯亮度（1-100）
  lightWorkMode:   null,  // 探照灯模式: 0=关闭 1=常亮 2=爆闪
};
let _connected = false;
let _uavDeviceId = null;

// ─── 连接 WebSocket ──────────────────────────────────────────────────────────

/**
 * 连接 WebSocket 并订阅飞机实时状态字段
 *
 * WS URL 参数参考前端 websocket.js：
 *   wss://host/websocket/?userId=xxx&useunitId=xxx&loginName=xxx&clientType=bs&token=xxx
 *
 * @param {string} token       - Bearer token
 * @param {string} uavDeviceId - 飞机设备 ID（来自 getCockpitData 的 aircraftData.id）
 * @param {string} dockDeviceId- 机场设备 ID（来自 getCockpitData 的 dockData.id）
 * @returns {Promise<void>}    - resolve 表示连接成功
 */
function connect(token, uavDeviceId, dockDeviceId) {
  _uavDeviceId = uavDeviceId;

  return new Promise((resolve, reject) => {
    // 从缓存读取用户信息，拼完整的 WS URL（与前端 websocket.js 一致）
    const userInfo = readCachedUserInfo() || {};
    const params = new URLSearchParams({
      userId:    userInfo.userId    || '',
      useunitId: userInfo.useunitId || '',
      loginName: userInfo.loginName || '',
      clientType: 'bs',
      token,
    });
    const url = `${WSS_URL}?${params.toString()}`;
    console.log(`  🔗 WS 连接: ${WSS_URL}?userId=${userInfo.userId || '(unknown)'}...`);
    _ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      reject(new Error('WebSocket 连接超时（10s）'));
    }, 10000);

    _ws.on('open', () => {
      clearTimeout(timeout);
      _connected = true;

      // 订阅飞机和机场的实时字段
      // fields: ['_o_'] 表示订阅所有字段（与前端 page.vue 保持一致）
      const subMsg = JSON.stringify({
        msgHead: 'dynamicSubscriberMsg',
        msgBody: [{
          msgHead: 'mcDeviceFieldMsg',
          fields: ['_o_'],
          deviceIds: [uavDeviceId, dockDeviceId].filter(Boolean)
        }]
      });
      _ws.send(subMsg);
      resolve();
    });

    _ws.on('message', (rawData) => {
      try {
        if (rawData === 'pong') return;
        const msg = JSON.parse(rawData.toString());
        if (msg.msgHead === 'mcDeviceFieldMsg') {
          _handleDeviceFieldMsg(msg.msgBody);
        }
      } catch (_) {}
    });

    _ws.on('error', (err) => {
      clearTimeout(timeout);
      _connected = false;
      reject(err);
    });

    _ws.on('close', () => {
      _connected = false;
    });
  });
}

// ─── 处理设备字段消息 ────────────────────────────────────────────────────────

function _handleDeviceFieldMsg(dataArr) {
  if (!Array.isArray(dataArr)) return;
  dataArr.forEach((item) => {
    if (!item.deviceId || item.deviceId !== _uavDeviceId) return;
    const p = item.properties || {};
    if (p.height          != null) _uavState.height          = Number(p.height.v);
    if (p.relativeHeight  != null) _uavState.relativeHeight  = Number(p.relativeHeight.v);
    if (p.speed           != null) _uavState.speed           = Number(p.speed.v);
    if (p.verticalSpeed   != null) _uavState.verticalSpeed   = Number(p.verticalSpeed.v);
    if (p.longitude       != null) _uavState.longitude       = Number(p.longitude.v);
    if (p.latitude        != null) _uavState.latitude        = Number(p.latitude.v);
    if (p.modeCode        != null) _uavState.modeCode        = p.modeCode.v;
    if (p.cameraMode      != null) _uavState.cameraMode      = p.cameraMode.v;      // 0=拍照 1=录像 2=智能低光 3=全景
    if (p.lightBrightness != null) _uavState.lightBrightness = Number(p.lightBrightness.v); // 1-100
    if (p.lightWorkMode   != null) _uavState.lightWorkMode   = p.lightWorkMode.v;   // 0=关闭 1=常亮 2=爆闪
  });
}

// ─── 状态访问函数 ────────────────────────────────────────────────────────────

function getHeight()          { return _uavState.height; }
function getRelativeHeight()  { return _uavState.relativeHeight; }
function getSpeed()           { return _uavState.speed; }
function getVerticalSpeed()   { return _uavState.verticalSpeed; }
function getLongitude()       { return _uavState.longitude; }
function getLatitude()        { return _uavState.latitude; }
function getModeCode()        { return _uavState.modeCode; }
function getCameraMode()      { return _uavState.cameraMode; }      // 0=拍照 1=录像 2=智能低光 3=全景
function getLightBrightness() { return _uavState.lightBrightness; } // 1-100
function getLightWorkMode()   { return _uavState.lightWorkMode; }   // 0=关闭 1=常亮 2=爆闪
function isConnected()        { return _connected; }

// ─── 地理距离计算（Haversine，单位：米）────────────────────────────────────────────

function _haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 地球半径（米）
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 等待飞机到达目标位置────────

/**
 * 轮询等待飞机到达目标高度附近 + 速度归零（悬停）
 *
 * 到达判定条件（AND）：
 *   1. |currentSpeed| <= SPEED_THRESHOLD（水平速度趋于零，悬停）
 *   2. |currentRelativeHeight - targetHeightM| <= HEIGHT_TOLERANCE（高度接近目标）
 *   以上条件需连续满足 STABLE_COUNT 次轮询（每次间隔 POLL_INTERVAL_MS）
 *
 * 若 WebSocket 未连接（或中途断开），自动降级为固定等待 fallbackMs 毫秒
 *
 * @param {number} targetHeightM  - 指令中的目标高度（相对起飞点，米）
 * @param {number} timeoutMs      - 最大等待时间（毫秒），超时后继续执行
 * @param {string} label          - 指令描述，用于日志
 * @param {number} [fallbackMs]   - WebSocket 不可用时固定等待毫秒数，默认与 timeoutMs 相同
 * @param {number} [targetLng]    - 目标经度（有坐标时使用坐标判定模式）
 * @param {number} [targetLat]    - 目标纬度
 * @param {Function} [onTick]     - 遥测数据回调
 */
async function waitUntilArrived(targetHeightM, timeoutMs, label, fallbackMs, targetLng, targetLat, onTick) {
  const SPEED_THRESHOLD   = 1.0;  // m/s，速度低于此值认为悬停（高度判定模式用）
  const HEIGHT_TOLERANCE  = 5.0;  // 米，高度差容差
  const COORD_TOLERANCE_M = 5.0;  // 米，与目标坐标距离容差
  const POSITION_STABLE_M = 5.0;  // 米，连续两次轮询间位移变化阈值
  const POLL_INTERVAL_MS  = 500; // 每0.5秒轮询一次
  const STABLE_COUNT      = 2;    // 连续满足 N 次才确认到达

  const hasCoord = (targetLng != null && targetLat != null);

  // WebSocket 不可用时降级为固定等待
  if (!_connected || !_ws) {
    const fbMs  = (fallbackMs != null && fallbackMs > 0) ? fallbackMs : timeoutMs;
    const fbSec = Math.ceil(fbMs / 1000);
    console.log(`  ⚠️  WebSocket 未连接，固定等待 ${fbSec}s`);
    for (let remaining = fbSec; remaining > 0; remaining--) {
      process.stdout.write(`\r  ⏳ 固定等待... ${remaining}s `);
      await sleep(1000);
    }
    process.stdout.write(`\r  ⏳ 等待完成 (${fbSec}s)          \n`);
    return;
  }

  const startTime  = Date.now();
  let elapsed      = 0;
  let stableCount  = 0;
  let lastPrintLen = 0;
  // 用于位移稳定判定：记录上一次轮询时的经纬度
  let prevLng = null;
  let prevLat = null;

  while (true) {
    elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      process.stdout.write('\r' + ' '.repeat(lastPrintLen) + '\r');
      console.log(`  ⚠️  等待超时 (${Math.round(timeoutMs / 1000)}s)，继续执行下一步`);
      return;
    }

    const curLng    = _uavState.longitude;
    const curLat    = _uavState.latitude;
    const curSpeed  = _uavState.speed;
    const curHeight = _uavState.relativeHeight;

    let statusStr;
    let conditionMet = false;

    if (hasCoord) {
      // ── 坐标判定模式 ──
      if (curLng === null || curLat === null) {
        statusStr = `  🔄 等待定位数据... (${Math.round(elapsed / 1000)}s/${Math.round(timeoutMs / 1000)}s)`;
      } else {
        const distToTarget = _haversineDistance(curLat, curLng, targetLat, targetLng);
        const nearTarget   = distToTarget <= COORD_TOLERANCE_M;

        // 位移稳定检测：与上一次坐标的位移距离
        let posStable = false;
        if (prevLng !== null && prevLat !== null) {
          const moved = _haversineDistance(prevLat, prevLng, curLat, curLng);
          posStable = moved <= POSITION_STABLE_M;
        }
        prevLng = curLng;
        prevLat = curLat;

        conditionMet = nearTarget && posStable;

        const distStr = distToTarget < 1000
          ? `${distToTarget.toFixed(0)}m`
          : `${(distToTarget / 1000).toFixed(2)}km`;
        const htStr  = curHeight != null ? `${curHeight.toFixed(1)}m`  : '--';
        const spdStr = curSpeed  != null ? `${curSpeed.toFixed(1)}m/s` : '--';
        statusStr = `  🔄 飞行中... 距目标:${distStr} 高度:${htStr} 速度:${spdStr}` +
                    `${nearTarget ? ' ✓接近' : ''}${posStable ? ' ✓稳定' : ''} 已等:${Math.round(elapsed / 1000)}s`;
      }
    } else {
      // ── 高度+速度判定模式（无坐标时兜底） ──
      if (curSpeed === null || curHeight === null) {
        statusStr = `  🔄 等待状态数据... (${Math.round(elapsed / 1000)}s/${Math.round(timeoutMs / 1000)}s)`;
      } else {
        const heightOk = targetHeightM != null
          ? Math.abs(curHeight - targetHeightM) <= HEIGHT_TOLERANCE
          : true;
        const speedOk  = curSpeed <= SPEED_THRESHOLD;
        conditionMet   = heightOk && speedOk;
        statusStr = `  🔄 飞行中... 高度:${curHeight.toFixed(1)}m(目标:${targetHeightM ?? '--'}m) 速度:${curSpeed.toFixed(1)}m/s 已等:${Math.round(elapsed / 1000)}s`;
      }
    }

    // 构建遥测快照
    const tickData = {
      height: _uavState.relativeHeight,
      altitude: _uavState.height,
      speed: _uavState.speed,
      verticalSpeed: _uavState.verticalSpeed,
      longitude: _uavState.longitude,
      latitude: _uavState.latitude,
      modeCode: _uavState.modeCode,
      targetHeight: targetHeightM,
      targetLng,
      targetLat,
      elapsed: Math.round(elapsed / 1000),
      timeout: Math.round(timeoutMs / 1000),
      conditionMet,
      stableCount,
    };
    if (hasCoord && curLng !== null && targetLng != null) {
      tickData.distToTarget = _haversineDistance(curLat, curLng, targetLat, targetLng);
    }
    if (typeof onTick === 'function') onTick(tickData);

    if (conditionMet) {
      stableCount++;
    } else {
      stableCount = 0;
    }

    // 覆写同一行
    const padded = statusStr.padEnd(lastPrintLen, ' ');
    process.stdout.write('\r' + padded);
    lastPrintLen = padded.length;

    if (stableCount >= STABLE_COUNT) {
      process.stdout.write('\r' + ' '.repeat(lastPrintLen) + '\r');
      if (hasCoord && curLng !== null) {
        const finalDist = _haversineDistance(curLat, curLng, targetLat, targetLng);
        const htStr  = (curHeight || 0).toFixed(1);
        const spdStr = (curSpeed  || 0).toFixed(1);
        console.log(`  ✅ 已到达目标位置！距目标:${finalDist.toFixed(0)}m 高度:${htStr}m 速度:${spdStr}m/s 用时:${Math.round(elapsed / 1000)}s`);
      } else {
        const curH = (_uavState.relativeHeight || 0).toFixed(1);
        const curS = (_uavState.speed          || 0).toFixed(1);
        console.log(`  ✅ 已到达目标位置！高度:${curH}m 速度:${curS}m/s 用时:${Math.round(elapsed / 1000)}s`);
      }
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── 关闭连接 ────────────────────────────────────────────────────────────────

function close() {
  if (_ws) {
    _connected = false;
    _ws.close();
    _ws = null;
  }
  // 重置状态
  _uavState = {
    height: null, relativeHeight: null, speed: null,
    verticalSpeed: null, longitude: null, latitude: null, modeCode: null,
    cameraMode: null, lightBrightness: null, lightWorkMode: null,
  };
}

module.exports = {
  connect,
  close,
  isConnected,
  getHeight,
  getRelativeHeight,
  getSpeed,
  getVerticalSpeed,
  getLongitude,
  getLatitude,
  getModeCode,
  getCameraMode,
  getLightBrightness,
  getLightWorkMode,
  waitUntilArrived,
};
