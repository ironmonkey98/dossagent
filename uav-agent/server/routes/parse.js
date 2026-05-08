/**
 * 解析路由 - POST /api/parse
 *
 * 接收自然语言指令，调用 LLM 解析为飞控 JSON，再进行地理编码
 */
'use strict';

const express = require('express');
const router  = express.Router();
const llmService    = require('../services/llm-service');
const geocodeService = require('../services/geocode-service');
const authService   = require('../services/auth-service');
const deviceService = require('../services/device-service');
const deviceCache   = require('../lib/device-cache');

// POST /api/parse
router.post('/parse', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: '缺少 message 字段' });
    }

    // 拦截设备刷新指令
    const refreshKeywords = ['刷新机场', '刷新飞机', '刷新无人机', '刷新设备', '更新机场', '更新飞机'];
    const isRefresh = refreshKeywords.some(kw => message.includes(kw));
    if (isRefresh) {
      const token = req.externalToken;
      const count = await deviceService.loadDevices(token);
      return res.json({
        success: true,
        isDeviceRefresh: true,
        message: `设备记忆已刷新，共加载 ${count} 个机场`,
        devices: deviceCache.readCache()?.docks || []
      });
    }

    // 确保设备已加载
    try {
      await deviceService.ensureDevicesLoaded(req.externalToken);
    } catch (e) {
      console.log('[/api/parse] 设备加载跳过:', e.message);
    }

    // 1. 调用 LLM 解析自然语言
    const { actions, model, raw } = await llmService.parseNlpToActions(message);

    // 2. 地理编码：将 actions 中的 address 解析为坐标
    const { actions: resolvedActions, geocoded } = await geocodeService.resolveActionsGeocode(actions);

    // 3. 验证坐标完整性：需要坐标的指令必须有 longitude/latitude
    const COORD_CMDS = ['takeoffToPoint', 'flyToPoint', 'cameraLookAt'];
    const warnings = [];
    for (const action of resolvedActions) {
      if (COORD_CMDS.includes(action.cmd) && action.longitude == null) {
        const msg = `指令 ${action.cmd} 的地址"${action.address || '未知'}"未能解析为坐标，执行时可能失败`;
        warnings.push(msg);
      }
    }

    // 4. 统一补全 dockCode（无人机编号）
    // 规则：整个飞行任务使用同一架无人机，所有 action 的 dockCode 保持一致
    // 优先级：用户消息模糊匹配 > LLM已设置的 > 默认机场的
    const defaultDock = deviceCache.getDefaultDock();
    const cache = deviceCache.readCache();
    let taskDockCode = null;

    // 第一步：从用户消息中模糊匹配设备（最可靠，因为直接匹配用户意图）
    const aircraftMatch = deviceCache.findAircraftByName(message)?.[0];
    const dockMatch = deviceCache.findDockByName(message)?.[0];

    if (aircraftMatch) {
      taskDockCode = aircraftMatch.aircraft.deviceCode;
      console.log(`[parse] 用户消息匹配到无人机: ${aircraftMatch.aircraft.deviceName}（得分:${aircraftMatch.score}）`);
    } else if (dockMatch) {
      const fullDock = cache?.docks?.find(d => d.dockCode === dockMatch.dockCode);
      taskDockCode = fullDock?.aircraft?.deviceCode || dockMatch.dockCode;
      console.log(`[parse] 用户消息匹配到机场: ${dockMatch.dockName}（得分:${dockMatch.score}）`);
    }

    // 第二步：模糊匹配未命中时，使用 LLM 设置的 dockCode
    if (!taskDockCode) {
      for (const action of resolvedActions) {
        if (action.dockCode) {
          taskDockCode = action.dockCode;
          // 检查 LLM 是否填了机场编号，若是则替换为对应无人机编号
          if (cache?.docks) {
            const dock = cache.docks.find(d => d.dockCode === taskDockCode);
            if (dock?.aircraft?.deviceCode) {
              taskDockCode = dock.aircraft.deviceCode;
            }
          }
          break;
        }
      }
    }

    // 第三步：都没有时用默认机场
    if (!taskDockCode) {
      const defaultAircraftCode = defaultDock?.aircraft?.deviceCode;
      taskDockCode = defaultAircraftCode || defaultDock?.dockCode || '8UUXN6A00A0ALQ';
    }

    // 第四步：将统一的无人机编号应用到所有 action
    for (const action of resolvedActions) {
      action.dockCode = taskDockCode;
    }

    res.json({
      success: true,
      model,
      actions: resolvedActions,
      geocoded,
      warnings: warnings.length > 0 ? warnings : undefined,
      raw: raw.substring(0, 500),
    });
  } catch (err) {
    console.error('[/api/parse] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/geocode - 单独的地理编码接口
router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: '缺少 address 字段' });

    const result = await geocodeService.geocode(address);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/status - 认证状态
router.get('/auth/status', (req, res) => {
  res.json(authService.getStatus());
});

// POST /api/auth/credentials - 设置凭据
router.post('/auth/credentials', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '缺少 username 或 password' });
    }
    authService.setCredentials(username, password);
    res.json({ success: true, message: '凭据已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login - 手动触发登录
router.post('/auth/login', async (req, res) => {
  try {
    const result = await authService.getToken();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/captcha - 获取验证码图片
router.get('/auth/captcha', async (req, res) => {
  try {
    const result = await authService.getCaptcha();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login-with-captcha - 带验证码登录
router.post('/auth/login-with-captcha', async (req, res) => {
  try {
    const { username, password, captcha, sessionCookie } = req.body;
    if (!username || !password || !captcha || !sessionCookie) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    // 保存凭据
    authService.setCredentials(username, password);
    // 带验证码登录
    const token = await authService.loginWithCaptcha(username, password, captcha, sessionCookie);
    res.json({ success: true, token: token.substring(0, 30) + '...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
