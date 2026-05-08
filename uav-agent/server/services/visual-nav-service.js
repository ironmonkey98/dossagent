/**
 * 视觉导航服务 — 视觉搜索抵近 + 视觉持续跟踪控制循环
 *
 * 核心思路：
 *   - 搜索抵近：flyToPoint 粗定位 → VLM 视觉搜索 → stickControl 精细抵近
 *   - 持续跟踪：~1Hz 循环抓帧 → VLM 分析 → stickControl 映射
 *
 * 复用：flight-service（flyToPoint/stickControl）、uav-status（遥测）、device-cache
 */
'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');
const { sleep } = require('../lib/simulate-config');
const vlmClient = require('./vlm-client');
const frameExtractor = require('../lib/frame-extractor');
const flightService = require('./flight-service');
const tokenCache = require('../lib/token-cache');

// ─── HTTP 请求工具（自包含，不依赖 flight-service 内部函数）──

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET', headers: options.headers || {},
      rejectUnauthorized: false,
    };
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, data }); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const BASE_URL = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';

async function callCockpitApi(token, endpoint, body = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = await httpRequest(url, { method: 'POST', headers }, body);
  if ([401, 402, 403].includes(res.status)) {
    throw new Error(`Token已失效`);
  }
  if (res.status !== 200) {
    throw new Error(`接口响应异常: HTTP ${res.status}`);
  }
  const result = res.data;
  if (result.success === false || result.code === 500) {
    throw new Error(`指令执行失败: ${result.msg || result.message || JSON.stringify(result)}`);
  }
  return result;
}

// ─── 配置 ────────────────────────────────────────────

const SEARCH_MAX_STEPS = parseInt(process.env.VISUAL_SEARCH_MAX_STEPS, 10) || 50;
const TRACK_MAX_DURATION = parseInt(process.env.VISUAL_TRACK_MAX_DURATION, 10) || 300;  // 秒
const ARRIVE_DIST = parseInt(process.env.VISUAL_ARRIVE_DIST, 10) || 20;  // 米
const CONTROL_INTERVAL_MS = 1000;  // 控制循环间隔 ~1Hz

// ─── 任务状态管理 ────────────────────────────────────

let _activeTask = null;  // 当前活跃任务

function getActiveTask() {
  return _activeTask;
}

function stopActiveTask(reason) {
  if (_activeTask) {
    _activeTask.stopped = true;
    _activeTask.stopReason = reason || '用户中止';
  }
}

// ─── stickControl 映射表（确定性规则）───────────────

/**
 * 跟踪 VLM 输出 → stickControl 参数映射
 * VLM 输出离散语义标签，直接映射为确定性的摇杆值
 */
const TRACK_STICK_MAP = {
  horizontal: {
    left:   { yaw: -0.3 },   // 目标偏左 → 左偏航
    right:  { yaw:  0.3 },   // 目标偏右 → 右偏航
    center: { yaw:  0 },
  },
  vertical: {
    up:     { pitch:  0.3 },  // 目标偏上 → 升高
    down:   { pitch: -0.3 },  // 目标偏下 → 降低
    center: { pitch: 0 },
  },
  distance: {
    too_far:  { throttle:  0.5 },  // 太远 → 前进
    too_close: { throttle: -0.3 },  // 太近 → 后退
    good:     { throttle:  0 },
  },
};

// ─── 工具函数 ────────────────────────────────────────

/**
 * 确保 token-cache 中有 userInfo（WS 连接需要 userId/loginName/useunitId）
 * 如果缓存中没有，用当前 token 调 /sys/user/info 获取并写入
 */
async function ensureUserInfo(token) {
  const cached = tokenCache.readCachedUserInfo();
  if (cached?.userId) {
    console.log(`  ♻️  userInfo 已缓存: userId=${cached.userId}`);
    return cached;
  }
  console.log('  📡 userInfo 缺失，从 /sys/user/info 获取...');
  try {
    const res = await httpRequest(`${BASE_URL}/sys/user/info`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.data?.user?.id) {
      const userInfo = {
        userId:    res.data.user.id,
        loginName: res.data.user.loginName || '',
        useunitId: res.data.user.useunitId || '',
      };
      // 写入缓存（保留已有 token 不覆盖）
      tokenCache.saveUserInfo(userInfo);
      console.log(`  ✅ userInfo 获取成功: userId=${userInfo.userId}, loginName=${userInfo.loginName}`);
      return userInfo;
    }
    console.log(`  ⚠️  /sys/user/info 响应异常: ${JSON.stringify(res.data).substring(0, 200)}`);
  } catch (err) {
    console.log(`  ⚠️  获取 userInfo 失败: ${err.message}`);
  }
  return null;
}

/**
 * 调用 DOSS 视频流 API 获取 RTSP 地址
 * POST /video/stream/v2/liveStream { deviceCode, protocol, type }
 */
async function getLiveStreamUrl(token, deviceCode) {
  const url = `${BASE_URL}/video/stream/v2/liveStream`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const body = {
    deviceCode,
    protocol: 'RTSP',
    type: [1],  // 主码流
  };
  const res = await httpRequest(url, { method: 'POST', headers }, body);
  if (res.status !== 200) {
    throw new Error(`获取视频流失败: HTTP ${res.status}`);
  }
  const data = res.data;
  if (!data?.streamUrl) {
    throw new Error(`视频流响应无 streamUrl: ${JSON.stringify(data).substring(0, 200)}`);
  }
  return data.streamUrl;
}

/**
 * 获取当前飞机位置
 */
function getCurrentPosition() {
  const uavStatus = require('../lib/uav-status');
  return {
    longitude: uavStatus.getLongitude?.() || null,
    latitude: uavStatus.getLatitude?.() || null,
    height: uavStatus.getHeight?.() || null,
    speed: uavStatus.getSpeed?.() || null,
  };
}

/**
 * 调用 cockpit stickControl API
 */
async function callStickControl(token, cockpitDockCode, sticks) {
  const body = {
    yaw: sticks.yaw || 0,
    pitch: sticks.pitch || 0,
    throttle: sticks.throttle || 0,
    roll: sticks.roll || 0,
  };
  return callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/stickControl`, body);
}

/**
 * 抓取当前帧：获取 RTSP 流地址 → ffmpeg 抽帧
 * @param {string} token - Bearer token
 * @param {string} uavDeviceCode - 无人机编号（DOSS 的 deviceCode，非机场 dockCode）
 */
async function grabFrame(token, uavDeviceCode) {
  // 注意：DOSS 中 dockCode=机场编号, deviceCode=无人机编号
  // 此处参数 uavDeviceCode 是无人机编号，用于 video/stream API 的 deviceCode 参数
  const rtspUrl = await getLiveStreamUrl(token, uavDeviceCode);
  console.log(`  📷 RTSP 流地址: ${rtspUrl.substring(0, 80)}...`);
  // ffmpeg 抽帧
  return frameExtractor.extractFrame(rtspUrl, { timeoutMs: 5000, size: '640x360' });
}

// ─── 视觉搜索抵近 ────────────────────────────────────

/**
 * 视觉搜索抵近任务
 * @param {object} params
 * @param {string} params.dockCode - 无人机编号
 * @param {number} params.targetLng - 目标经度
 * @param {number} params.targetLat - 目标纬度
 * @param {number} [params.targetHeight=50] - 目标高度
 * @param {string} params.instruction - 目标描述
 * @param {number} [params.maxSteps] - 最大搜索步数
 * @param {Function} params.onProgress - 进度回调
 * @param {string} [params.token] - 外部 token
 */
async function visualSearch(params) {
  const {
    dockCode,
    targetLng,
    targetLat,
    targetHeight = 50,
    instruction,
    maxSteps = SEARCH_MAX_STEPS,
    onProgress,
    token: externalToken,
  } = params;

  // 注册为活跃任务
  const task = {
    type: 'search',
    dockCode,
    instruction,
    stopped: false,
    stopReason: '',
    startTime: Date.now(),
  };
  _activeTask = task;

  const report = { steps: [], found: false, completed: false };
  const broadcast = (type, data) => {
    const wsBroadcast = global.__wsBroadcast;
    if (wsBroadcast) wsBroadcast(type, data);
    onProgress?.({ type, ...data });
  };

  try {
    // ── Phase 1: 飞到大致区域 ──
    broadcast('visual_search_step', { step: 0, phase: 'fly_to_area', action: '飞向目标区域' });

    // 获取 token
    let token = externalToken;
    if (!token) {
      const authService = require('./auth-service');
      const authResult = await authService.getToken();
      if (!authResult.token) throw new Error(authResult.error || 'Token 未获取');
      token = authResult.token;
    }

    // 反查机场编号
    const _deviceCache = require('../lib/device-cache');
    const cache = _deviceCache.readCache();
    let cockpitDockCode = dockCode;
    let aircraftDeviceId = null;
    if (cache?.docks) {
      const matchedDock = cache.docks.find(d => d.aircraft?.deviceCode === dockCode);
      if (matchedDock) {
        cockpitDockCode = matchedDock.dockCode;
        aircraftDeviceId = matchedDock.aircraft?.id;
      }
    }

    // 获取驾驶舱数据
    const cockpitData = await flightService.getCockpitData(token, cockpitDockCode);
    if (!aircraftDeviceId && cockpitData?.cockpitData?.aircraftData?.id) {
      aircraftDeviceId = cockpitData.cockpitData.aircraftData.id;
    }

    // 连接 WS 遥测（先确保 userInfo 已缓存）
    const uavStatus = require('../lib/uav-status');
    let wsConnected = false;
    if (aircraftDeviceId) {
      try {
        await ensureUserInfo(token);
        const dockDeviceId = cockpitData?.cockpitData?.dockData?.id;
        await uavStatus.connect(token, aircraftDeviceId, dockDeviceId);
        wsConnected = true;
      } catch (err) {
        broadcast('visual_search_step', { step: 0, warning: `遥测连接失败: ${err.message}` });
      }
    }

    // 抢控
    try {
      await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flightAuthorityGrab`, {});
    } catch {}

    // flyToPoint 飞到大致区域
    try {
      await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flyToPoint`, {
        longitude: targetLng,
        latitude: targetLat,
        height: targetHeight,
      });

      // 等待到达（最多 60s）
      if (wsConnected) {
        await uavStatus.waitUntilArrived(targetHeight, 60000, '飞向目标区域');
      } else {
        await sleep(30000);
      }
    } catch (err) {
      broadcast('visual_search_step', { step: 0, warning: `飞向目标区域失败: ${err.message}` });
    }

    // ── Phase 2: VLM 视觉搜索循环 ──
    broadcast('visual_search_step', { step: 0, phase: 'visual_search', action: '开始视觉搜索' });

    for (let step = 1; step <= maxSteps; step++) {
      // 检查中止
      if (task.stopped) {
        report.completed = false;
        report.stopReason = task.stopReason;
        break;
      }

      // 抓帧
      let frameBase64;
      try {
        frameBase64 = await grabFrame(token, dockCode);
      } catch (err) {
        broadcast('visual_search_step', { step, action: '抓帧失败', error: err.message });
        await sleep(2000);
        continue;
      }

      // VLM 分析
      let analysis;
      try {
        analysis = await vlmClient.searchTarget(frameBase64, instruction);
      } catch (err) {
        broadcast('visual_search_step', { step, action: 'VLM 分析失败', error: err.message });
        report.steps.push({ step, action: 'vlm_failed', error: err.message });
        await sleep(2000);
        continue;
      }

      const stepInfo = { step, ...analysis };
      report.steps.push(stepInfo);

      // 决策分支
      if (!analysis.found) {
        // 未找到目标
        if (analysis.confidence < 0.5) {
          // 低置信度 → 原地旋转 30° 搜索
          broadcast('visual_search_step', { ...stepInfo, action: '原地旋转搜索' });
          await callStickControl(token, cockpitDockCode, { yaw: -0.3, pitch: 0, throttle: 0, roll: 0 });
          await sleep(3000);
          await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });
        } else {
          // 高置信度 → flyToPoint 飞向推测方向
          broadcast('visual_search_step', { ...stepInfo, action: '飞向推测方向' });
          const pos = getCurrentPosition();
          if (pos.longitude && pos.latitude) {
            // 根据方向推测偏移坐标
            const offset = analysis.distance === 'far' ? 0.001 : 0.0005;
            let dLng = 0, dLat = 0;
            if (analysis.direction === 'left') dLng = -offset;
            else if (analysis.direction === 'right') dLng = offset;
            else dLat = offset;  // center 时向前飞
            await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flyToPoint`, {
              longitude: pos.longitude + dLng,
              latitude: pos.latitude + dLat,
              height: pos.height || targetHeight,
            });
            await sleep(5000);
          }
        }
      } else {
        // 找到目标！
        report.found = true;

        if (analysis.distance === 'very_close') {
          // 距离 <= 20m → 悬停拍照，返回成功
          broadcast('visual_search_found', { step, distance: analysis.distance, message: '目标已找到，距离足够近' });
          report.completed = true;
          report.successStep = step;
          break;
        } else if (analysis.distance === 'close') {
          // 距离 20-50m → stickControl 精细抵近
          broadcast('visual_search_step', { ...stepInfo, action: '精细抵近' });
          // 根据方向微调
          const yawAdjust = analysis.direction === 'left' ? -0.2 : analysis.direction === 'right' ? 0.2 : 0;
          await callStickControl(token, cockpitDockCode, { yaw: yawAdjust, pitch: 0, throttle: 0.3, roll: 0 });
          await sleep(3000);
          await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });
        } else {
          // 距离 > 50m → flyToPoint 飞向 VLM 推算坐标
          broadcast('visual_search_step', { ...stepInfo, action: '飞向目标' });
          const pos = getCurrentPosition();
          if (pos.longitude && pos.latitude) {
            const offset = 0.002;  // 约 200m 偏移
            let dLng = 0, dLat = 0;
            if (analysis.direction === 'left') dLng = -offset;
            else if (analysis.direction === 'right') dLng = offset;
            else dLat = offset;
            await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flyToPoint`, {
              longitude: pos.longitude + dLng,
              latitude: pos.latitude + dLat,
              height: pos.height || targetHeight,
            });
            await sleep(8000);
          }
        }
      }

      broadcast('visual_search_step', stepInfo);
      await sleep(CONTROL_INTERVAL_MS);
    }

    // 搜索结束
    if (!report.found && !task.stopped) {
      report.completed = false;
      report.stopReason = 'maxSteps 耗尽';
    }

    // 悬停稳定
    await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });

    // 关闭 WS
    if (wsConnected) {
      try { uavStatus.close(); } catch {}
    }

    report.totalSec = Math.round((Date.now() - task.startTime) / 1000);
    broadcast('visual_search_done', { report });

    return report;

  } catch (err) {
    report.error = err.message;
    broadcast('visual_search_done', { report });
    throw err;
  } finally {
    _activeTask = null;
  }
}

// ─── 视觉持续跟踪 ────────────────────────────────────

/**
 * 视觉持续跟踪任务
 * @param {object} params
 * @param {string} params.dockCode - 无人机编号
 * @param {string} params.instruction - 目标描述
 * @param {number} [params.keepDistance=30] - 保持距离（米）
 * @param {number} [params.keepHeight] - 保持高度
 * @param {number} [params.maxDuration] - 最大跟踪时长（秒）
 * @param {Function} params.onProgress - 进度回调
 * @param {string} [params.token] - 外部 token
 */
async function visualTrack(params) {
  const {
    dockCode,
    instruction,
    keepDistance = 30,
    keepHeight,
    maxDuration = TRACK_MAX_DURATION,
    onProgress,
    token: externalToken,
  } = params;

  const task = {
    type: 'track',
    dockCode,
    instruction,
    stopped: false,
    stopReason: '',
    startTime: Date.now(),
  };
  _activeTask = task;

  const report = { steps: [], completed: false, lostCount: 0 };
  const broadcast = (type, data) => {
    const wsBroadcast = global.__wsBroadcast;
    if (wsBroadcast) wsBroadcast(type, data);
    onProgress?.({ type, ...data });
  };

  // 丢失恢复参数
  let consecutiveLost = 0;
  const MAX_CONSECUTIVE_LOST = 10;  // 连续丢失 10 帧（约 10s）→ 暂停
  const MAX_TOTAL_LOST_TIME = 10000;  // 10s

  try {
    // 获取 token
    let token = externalToken;
    if (!token) {
      const authService = require('./auth-service');
      const authResult = await authService.getToken();
      if (!authResult.token) throw new Error(authResult.error || 'Token 未获取');
      token = authResult.token;
    }

    // 反查机场编号
    const _deviceCache = require('../lib/device-cache');
    const cache = _deviceCache.readCache();
    let cockpitDockCode = dockCode;
    let aircraftDeviceId = null;
    if (cache?.docks) {
      const matchedDock = cache.docks.find(d => d.aircraft?.deviceCode === dockCode);
      if (matchedDock) {
        cockpitDockCode = matchedDock.dockCode;
        aircraftDeviceId = matchedDock.aircraft?.id;
      }
    }

    // 获取驾驶舱数据 + 连接 WS
    const cockpitData = await flightService.getCockpitData(token, cockpitDockCode);
    if (!aircraftDeviceId && cockpitData?.cockpitData?.aircraftData?.id) {
      aircraftDeviceId = cockpitData.cockpitData.aircraftData.id;
    }

    const uavStatus = require('../lib/uav-status');
    let wsConnected = false;
    if (aircraftDeviceId) {
      try {
        await ensureUserInfo(token);
        const dockDeviceId = cockpitData?.cockpitData?.dockData?.id;
        await uavStatus.connect(token, aircraftDeviceId, dockDeviceId);
        wsConnected = true;
      } catch {}
    }

    // 抢控
    try {
      await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flightAuthorityGrab`, {});
    } catch {}

    broadcast('visual_track_step', { step: 0, action: '开始视觉跟踪' });

    const deadline = Date.now() + maxDuration * 1000;
    let step = 0;

    while (Date.now() < deadline) {
      // 检查中止
      if (task.stopped) {
        report.completed = false;
        report.stopReason = task.stopReason;
        break;
      }

      step++;

      // 抓帧
      let frameBase64;
      try {
        frameBase64 = await grabFrame(token, dockCode);
      } catch (err) {
        broadcast('visual_track_step', { step, action: '抓帧失败', error: err.message });
        await sleep(2000);
        continue;
      }

      // VLM 分析
      let analysis;
      try {
        analysis = await vlmClient.trackTarget(frameBase64, instruction);
      } catch (err) {
        broadcast('visual_track_step', { step, action: 'VLM 分析失败', error: err.message });
        await sleep(CONTROL_INTERVAL_MS);
        continue;
      }

      const stepInfo = { step, ...analysis };
      report.steps.push(stepInfo);

      if (analysis.found) {
        // 目标找到 → stickControl 映射
        consecutiveLost = 0;

        const hStick = TRACK_STICK_MAP.horizontal[analysis.horizontal] || { yaw: 0 };
        const vStick = TRACK_STICK_MAP.vertical[analysis.vertical] || { pitch: 0 };
        const dStick = TRACK_STICK_MAP.distance[analysis.distance] || { throttle: 0 };

        const sticks = {
          yaw: hStick.yaw || 0,
          pitch: vStick.pitch || 0,
          throttle: dStick.throttle || 0,
          roll: 0,
        };

        await callStickControl(token, cockpitDockCode, sticks);
        broadcast('visual_track_step', { ...stepInfo, sticks });
      } else {
        // 目标丢失 → 丢失恢复
        consecutiveLost++;
        broadcast('visual_track_lost', { step, consecutiveLost });

        if (consecutiveLost >= MAX_CONSECUTIVE_LOST) {
          report.completed = false;
          report.stopReason = `目标连续丢失 ${consecutiveLost} 帧`;
          report.lostCount = consecutiveLost;
          break;
        }

        // 丢失恢复策略：悬停 → 缓慢旋转搜索
        if (consecutiveLost <= 3) {
          // 前 3 帧：悬停等待
          await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });
        } else {
          // 3 帧后：缓慢旋转搜索
          await callStickControl(token, cockpitDockCode, { yaw: -0.2, pitch: 0, throttle: 0, roll: 0 });
          await sleep(2000);
          await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });
        }
      }

      await sleep(CONTROL_INTERVAL_MS);
    }

    // 跟踪结束 → 停止摇杆
    await callStickControl(token, cockpitDockCode, { yaw: 0, pitch: 0, throttle: 0, roll: 0 });

    if (!task.stopped && !report.stopReason) {
      report.completed = true;
      report.stopReason = 'maxDuration 耗尽';
    }

    if (wsConnected) {
      try { uavStatus.close(); } catch {}
    }

    report.totalSec = Math.round((Date.now() - task.startTime) / 1000);
    report.totalSteps = step;
    broadcast('visual_track_done', { report });

    return report;

  } catch (err) {
    report.error = err.message;
    broadcast('visual_track_done', { report });
    throw err;
  } finally {
    _activeTask = null;
  }
}

module.exports = { visualSearch, visualTrack, getActiveTask, stopActiveTask };
