/**
 * 执行路由 - POST /api/execute
 *
 * 接收解析后的飞控 actions，启动真实飞控执行，通过 WebSocket 推送状态
 */
'use strict';

const express = require('express');
const router  = express.Router();
const flightService = require('../services/flight-service');
const authService  = require('../services/auth-service');
const deviceCache  = require('../lib/device-cache');

// POST /api/execute
router.post('/execute', async (req, res) => {
  try {
    const { actions } = req.body;
    const defaultDock = deviceCache.getDefaultDock();
    // dockCode 应为无人机编号（cockpit API 使用无人机编号）
    const dockCode = req.body.dockCode || defaultDock?.aircraft?.deviceCode || defaultDock?.dockCode || '8UUXN6A00A0ALQ';

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: '缺少 actions 数组' });
    }

    // 优先使用外部传入的 token，无 token 时才走自有登录流程
    const externalToken = req.externalToken;

    if (!externalToken) {
      // 无外部 token：尝试自有登录
      const authResult = await authService.getToken();
      if (!authResult.token) {
        return res.status(401).json({ error: authResult.error || '未认证，请传入 token 或先配置凭据' });
      }
    }

    // 生成任务 ID
    const taskId = `task_${Date.now()}`;

    // 立即返回任务 ID（异步执行）
    res.json({ success: true, taskId, mode: 'real', totalSteps: actions.length, message: '任务已启动' });

    // 异步执行，通过 WebSocket 推送进度
    const onProgress = (event) => {
      const broadcast = global.__wsBroadcast;
      if (broadcast) {
        broadcast('flight_status', { taskId, ...event });
      }
    };

    try {
      await flightService.executeReal(actions, dockCode, onProgress, externalToken);
    } catch (err) {
      onProgress({ type: 'task_error', error: err.message });
    }

  } catch (err) {
    console.error('[/api/execute] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
