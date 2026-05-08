/**
 * 飞控执行服务 - 真实飞控执行引擎
 *
 * 使用本地 lib/ 模块（simulate-config、uav-status、token-cache）
 * 每步执行通过回调函数推送状态，由 WebSocket 层转发给前端
 */
'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

// 直接引用本地 lib/ 模块（不再依赖 uav-nlp-control 技能脚本）
const _simExec    = require('../lib/simulate-config');
const _uavStatus  = require('../lib/uav-status');
const _tokenCache = require('../lib/token-cache');

const BASE_URL = process.env.UAV_BASE_URL || 'https://doss.xmrbi.com/xmrbi-onecas';

// ─── HTTP 请求工具 ──────────────────────────────────

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

// ─── 调用驾驶舱 API ─────────────────────────────────

async function callCockpitApi(token, endpoint, body = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = await httpRequest(url, { method: 'POST', headers }, body);
  // 401/402/403 均视为 Token/认证问题
  if ([401, 402, 403].includes(res.status)) {
    const detail = (res.data && (res.data.msg || res.data.message)) ? `: ${res.data.msg || res.data.message}` : '';
    throw new Error(`Token已失效${detail}`);
  }
  if (res.status !== 200) {
    const detail = (typeof res.data === 'object' && res.data !== null) ? ` - ${JSON.stringify(res.data).substring(0, 200)}` : '';
    throw new Error(`接口响应异常: HTTP ${res.status}${detail}`);
  }
  const result = res.data;
  if (result.success === false || result.code === 500) {
    throw new Error(`指令执行失败: ${result.msg || result.message || JSON.stringify(result)}`);
  }
  return result;
}

async function callCockpitGet(token, endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Authorization': `Bearer ${token}` };
  const res = await httpRequest(url, { method: 'GET', headers });
  // 401/402/403 均视为 Token/认证问题
  if ([401, 402, 403].includes(res.status)) {
    const detail = (res.data && (res.data.msg || res.data.message)) ? `: ${res.data.msg || res.data.message}` : '';
    throw new Error(`Token已失效${detail}`);
  }
  if (res.status !== 200) throw new Error(`接口响应异常: HTTP ${res.status}`);
  return res.data;
}

// ─── 获取驾驶舱数据（payloadIndex 等）───────────────

async function getCockpitData(token, dockCode) {
  return callCockpitGet(token, `/uav/cockpit/getCockpitData?dockCode=${dockCode}`);
}

// ─── 展开 repeat 字段 ───────────────────────────────

function expandActions(actions) {
  const result = [];
  actions.forEach((action) => {
    const repeat = action.repeat || 1;
    for (let i = 0; i < repeat; i++) {
      const label = repeat > 1
        ? `${action.label || action.cmd} (${i + 1}/${repeat})`
        : (action.label || action.cmd);
      result.push({ ...action, label, repeat: undefined });
    }
  });
  return result;
}

// ─── 真实飞控执行 ──────────────────────────────────

/**
 * 真实飞控执行
 * @param {Array} actions - 飞控指令数组
 * @param {string} dockCode - 无人机编号（cockpit API 使用无人机编号）
 * @param {Function} onProgress - 回调 (event) => void
 * @param {string} [externalToken] - 外部传入的 token（可选，优先使用）
 * @returns {Promise<{totalSteps, successCount, failCount, totalSec, steps}>}
 */
async function executeReal(actions, dockCode, onProgress, externalToken) {
  const expanded = expandActions(actions);
  const steps = [];
  const startTime = Date.now();

  // dockCode 参数实际为无人机编号，需要反查机场编号用于 cockpit API
  let cockpitDockCode = dockCode; // 默认回退
  try {
    const _deviceCache = require('../lib/device-cache');
    const cache = _deviceCache.readCache();
    if (cache?.docks) {
      // 根据无人机编号找到对应机场
      const matchedDock = cache.docks.find(d => d.aircraft?.deviceCode === dockCode);
      if (matchedDock) {
        cockpitDockCode = matchedDock.dockCode;
        console.log(`[flight] 无人机 ${dockCode} → 机场 ${cockpitDockCode}（${matchedDock.dockName}）`);
      } else {
        console.log(`[flight] 未在缓存中找到无人机 ${dockCode} 对应的机场，使用原值`);
      }
    }
  } catch (e) {
    console.log(`[flight] 设备缓存查找失败: ${e.message}`);
  }

  // 优先使用外部传入的 token，无外部 token 时走自有登录流程
  let token = externalToken || null;
  if (token) {
    const tokenPreview = token.substring(0, 20);
    onProgress({ type: 'info', message: `使用外部传入 token: ${tokenPreview}...（无人机编号: ${dockCode}）` });
  } else {
    const authService = require('./auth-service');
    const authResult = await authService.getToken();
    if (!authResult.token) throw new Error(authResult.error || 'Token 未获取，请传入 token 或先配置凭据');
    token = authResult.token;
    onProgress({ type: 'info', message: `Token 已获取（来源: ${authResult.source}）` });
  }

  // 获取驾驶舱数据（payloadIndex）
  let cockpitData = null;
  let cameraIndex = null, lightIndex = null, speakerIndex = null, aircraftDeviceId = null;
  try {
    const resp = await getCockpitData(token, cockpitDockCode);
    cockpitData = resp.cockpitData;
    if (cockpitData?.aircraftData) {
      cameraIndex = cockpitData.aircraftData.cameraIndex;
      lightIndex  = cockpitData.aircraftData.lightIndex;
      speakerIndex = cockpitData.aircraftData.speakerIndex;
      aircraftDeviceId = cockpitData.aircraftData.id;
    }
  } catch (err) {
    onProgress({ type: 'warning', message: `获取驾驶舱数据失败: ${err.message}` });
  }

  // 连接 WebSocket（用于飞行到达判定）
  let wsConnected = false;
  if (aircraftDeviceId) {
    try {
      const dockDeviceId = cockpitData?.dockData?.id;
      await _uavStatus.connect(token, aircraftDeviceId, dockDeviceId);
      wsConnected = true;
      onProgress({ type: 'ws_connected' });
    } catch (err) {
      onProgress({ type: 'warning', message: `WebSocket 连接失败: ${err.message}` });
    }
  }

  onProgress({ type: 'task_start', mode: 'real', totalSteps: expanded.length });

  for (let i = 0; i < expanded.length; i++) {
    const action = expanded[i];
    const { cmd, body, payloadIndex, label, longitude, latitude, height } = action;
    const pIdx = payloadIndex || (
      ['cameraPhotoTake', 'cameraRecordingStart', 'cameraRecordingStop', 'cameraModeSwitch', 'cameraLookAt', 'gimbalReset', 'cameraScreenDrag'].includes(cmd) ? cameraIndex :
      ['lightModeSet', 'lightBrightnessSet'].includes(cmd) ? lightIndex :
      ['speakerTtsPlayStart'].includes(cmd) ? speakerIndex : null
    );

    const apiPath = `/uav/cockpit/${cockpitDockCode}/${cmd}${pIdx ? '/' + pIdx : ''}`;
    let requestBody = body || {};

    // ── 按指令类型从 action 中提取 API 所需参数 ──
    switch (cmd) {
      case 'takeoffToPoint':
        requestBody.height = height || 120.0;
        requestBody.takeoffHeight = action.takeoffHeight || height || 120.0;
        if (longitude != null) {
          requestBody.longitude = longitude;
          requestBody.latitude = latitude;
        } else {
          onProgress({ type: 'warning', message: `takeoffToPoint 缺少坐标参数（地址"${action.address}"未解析），飞控可能失败` });
        }
        break;
      case 'flyToPoint':
        requestBody.height = height || 120.0;
        if (longitude != null) {
          requestBody.longitude = longitude;
          requestBody.latitude = latitude;
        } else {
          onProgress({ type: 'warning', message: `flyToPoint 缺少坐标参数（地址"${action.address}"未解析），飞控可能失败` });
        }
        break;
      case 'cameraLookAt':
        requestBody.height = height != null ? height : 0;
        if (longitude != null) {
          requestBody.longitude = longitude;
          requestBody.latitude = latitude;
        } else {
          onProgress({ type: 'warning', message: `cameraLookAt 缺少坐标参数（地址"${action.address}"未解析），飞控可能失败` });
        }
        break;
      case 'cameraModeSwitch':
        if (action.cameraMode) requestBody.cameraMode = action.cameraMode;
        break;
      case 'lightModeSet':
        if (action.lightMode) requestBody.lightMode = action.lightMode;
        break;
      case 'lightBrightnessSet':
        if (action.brightness != null) requestBody.brightness = action.brightness;
        break;
      case 'speakerTtsPlayStart':
        if (action.text) requestBody.text = action.text;
        if (action.voiceType) requestBody.voiceType = action.voiceType;
        break;
      case 'gimbalReset':
        if (action.resetMode != null) requestBody.resetMode = String(action.resetMode);
        break;
      case 'cameraScreenDrag':
        if (action.screenX != null) requestBody.screenX = action.screenX;
        if (action.screenY != null) requestBody.screenY = action.screenY;
        break;
      // returnHome, droneEmergencyStop, flightAuthorityGrab, cameraPhotoTake,
      // cameraRecordingStart, cameraRecordingStop, flightTaskPause, flightTaskRecovery
      // 这些命令不需要额外参数
      default:
        break;
    }

    const statusText = _simExec.CMD_STATUS[cmd] || _simExec.CMD_STATUS._default;

    onProgress({
      type: 'step_start',
      index: i + 1,
      total: expanded.length,
      cmd, label, apiPath, params: requestBody, status: statusText,
    });

    const t0 = Date.now();
    let success = false;
    let errMsg = '';

    // ── 1. 调用真实 API ──
    try {
      await callCockpitApi(token, apiPath, requestBody);
      success = true;
    } catch (err) {
      // Token 失效时尝试刷新（仅自有登录模式，外部 token 无法刷新）
      if (err.message === 'Token已失效' && !externalToken) {
        try {
          const authService = require('./auth-service');
          const refreshResult = await authService.getToken();
          if (refreshResult.token) {
            token = refreshResult.token;
            await callCockpitApi(token, apiPath, requestBody);
            success = true;
          }
        } catch (retryErr) {
          success = false;
          errMsg = `Token刷新失败: ${retryErr.message}`;
        }
      }
      if (!success) {
        errMsg = err.message;
      }
      onProgress({ type: 'warning', message: `指令 ${cmd} ${success ? '重试成功' : '失败'}: ${errMsg || err.message}` });
    }

    // ── 2. 等待（无论 API 成功或失败，都等待适当时间）──
    const isFlightMove = _simExec.FLIGHT_MOVE_CMDS.has(cmd);
    const isReturnHome = cmd === 'returnHome';

    if (success && isFlightMove && wsConnected) {
      // API成功 + WS已连接：通过遥测等待飞机到达
      const targetH   = requestBody.height || null;
      const targetLng = requestBody.longitude || null;
      const targetLat = requestBody.latitude  || null;
      const timeoutMs = (_simExec.REAL_WAIT_MS[cmd] || 30000);

      onProgress({ type: 'step_waiting', index: i + 1, cmd, timeoutMs, message: `等待飞行到达目标点（最长${Math.ceil(timeoutMs / 1000)}s）` });

      const onTick = (tick) => {
        const broadcast = global.__wsBroadcast;
        if (broadcast) {
          broadcast('flight_telemetry', { stepIndex: i + 1, cmd, ...tick });
        }
      };

      await _uavStatus.waitUntilArrived(
        targetH, timeoutMs, label, null, targetLng, targetLat, onTick
      );
    } else if (isFlightMove || isReturnHome) {
      // API失败 或 WS未连接 或 返航指令：倒计时等待（使用 REAL_WAIT_MS 配置的真实时间）
      const waitMs = _simExec.REAL_WAIT_MS[cmd] || 30000;
      onProgress({ type: 'step_waiting', index: i + 1, cmd, timeoutMs: waitMs, fallback: true, message: `等待飞行执行中（预计${Math.ceil(waitMs / 1000)}s）` });
      const totalSec = Math.ceil(waitMs / 1000);
      for (let remaining = totalSec; remaining > 0; remaining--) {
        await new Promise(r => setTimeout(r, 1000));
        onProgress({ type: 'step_countdown', index: i + 1, cmd, remaining, total: totalSec });
      }
    } else {
      // 非飞行指令：固定等待
      const waitMs = (action.waitSec || (_simExec.REAL_WAIT_MS[cmd] || 3000) / 1000) * 1000;
      await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
    }

    // ── 3. takeoffToPoint 后自动抢控（仅 API 成功时）──
    if (success && cmd === 'takeoffToPoint') {
      const hasAuthorityGrab = expanded.slice(i + 1).some(a => a.cmd === 'flightAuthorityGrab');
      if (!hasAuthorityGrab) {
        onProgress({ type: 'step_auto', message: '起飞成功，5秒后自动抢控...' });
        await new Promise(r => setTimeout(r, 5000));
        try {
          await callCockpitApi(token, `/uav/cockpit/${cockpitDockCode}/flightAuthorityGrab`, {});
          const grabStep = {
            index: expanded.length + 1, cmd: 'flightAuthorityGrab',
            cmdName: '抓取飞行控制权', label: '🔑 自动抓取飞行控制权',
            apiPath: `/uav/cockpit/${cockpitDockCode}/flightAuthorityGrab`,
            params: {}, durationSec: 5, success: true, status: '🔑 已抢夺飞行控制权',
          };
          steps.push(grabStep);
          onProgress({ type: 'step_complete', index: grabStep.index, total: expanded.length + 1, ...grabStep });
        } catch (e) {
          onProgress({ type: 'warning', message: `自动抢控失败: ${e.message}` });
        }
      }
    }

    const durationSec = Math.round((Date.now() - t0) / 100) / 10;
    const stepResult = {
      index: i + 1, cmd,
      cmdName: _simExec.CMD_NAMES[cmd] || _simExec.CMD_NAMES._default,
      label, apiPath, params: requestBody, status: statusText,
      durationSec, success, error: errMsg || undefined,
    };
    steps.push(stepResult);

    onProgress({
      type: 'step_complete', index: i + 1, total: expanded.length, ...stepResult,
    });

    // 急停后终止
    if (cmd === 'droneEmergencyStop') break;
  }

  // 关闭 WebSocket
  if (wsConnected) {
    try { _uavStatus.close(); } catch (e) {}
  }

  const totalMs = Date.now() - startTime;
  const report = {
    mode: 'real',
    dockCode,
    totalSteps: steps.length,
    successCount: steps.filter(s => s.success).length,
    failCount: steps.filter(s => !s.success).length,
    totalSec: Math.round(totalMs / 100) / 10,
    steps,
  };

  onProgress({ type: 'task_complete', report });
  return report;
}

module.exports = { executeReal, getCockpitData };
