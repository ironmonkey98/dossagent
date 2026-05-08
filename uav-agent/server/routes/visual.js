/**
 * 视觉导航路由 - /api/visual-*
 *
 * 提供 4 个端点：视觉搜索、视觉跟踪、停止任务、查询状态
 * 异步执行，通过 WebSocket 推送进度
 */
'use strict';

const express = require('express');
const router  = express.Router();
const visualNavService = require('../services/visual-nav-service');
const authService     = require('../services/auth-service');
const deviceCache     = require('../lib/device-cache');

// POST /api/visual-search — 启动视觉搜索抵近
router.post('/visual-search', async (req, res) => {
  try {
    const { targetLng, targetLat, instruction } = req.body;
    const defaultDock = deviceCache.getDefaultDock();
    const dockCode = req.body.dockCode || defaultDock?.aircraft?.deviceCode || defaultDock?.dockCode;

    if (!dockCode) {
      return res.status(400).json({ error: '缺少 dockCode 且无默认机场' });
    }
    if (!instruction) {
      return res.status(400).json({ error: '缺少 instruction（目标描述）' });
    }
    if (targetLng == null || targetLat == null) {
      return res.status(400).json({ error: '缺少 targetLng/targetLat（目标坐标）' });
    }

    // 检查是否有正在进行的任务
    const active = visualNavService.getActiveTask();
    if (active) {
      return res.status(409).json({ error: `已有任务正在执行（${active.type}）`, activeTask: active.type });
    }

    const externalToken = req.externalToken;
    if (!externalToken) {
      const authResult = await authService.getToken();
      if (!authResult.token) {
        return res.status(401).json({ error: authResult.error || '未认证' });
      }
    }

    const taskId = `visual_search_${Date.now()}`;
    res.json({
      success: true,
      taskId,
      mode: 'visual_search',
      message: '视觉搜索已启动',
      params: { dockCode, targetLng, targetLat, instruction },
    });

    // 异步执行
    try {
      await visualNavService.visualSearch({
        dockCode,
        targetLng: parseFloat(targetLng),
        targetLat: parseFloat(targetLat),
        targetHeight: req.body.targetHeight,
        instruction,
        maxSteps: req.body.maxSteps,
        token: externalToken,
      });
    } catch (err) {
      const broadcast = global.__wsBroadcast;
      if (broadcast) broadcast('visual_search_done', { report: { error: err.message } });
    }

  } catch (err) {
    console.error('[/api/visual-search] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/visual-track — 启动视觉持续跟踪
router.post('/visual-track', async (req, res) => {
  try {
    const { instruction } = req.body;
    const defaultDock = deviceCache.getDefaultDock();
    const dockCode = req.body.dockCode || defaultDock?.aircraft?.deviceCode || defaultDock?.dockCode;

    if (!dockCode) {
      return res.status(400).json({ error: '缺少 dockCode 且无默认机场' });
    }
    if (!instruction) {
      return res.status(400).json({ error: '缺少 instruction（目标描述）' });
    }

    const active = visualNavService.getActiveTask();
    if (active) {
      return res.status(409).json({ error: `已有任务正在执行（${active.type}）`, activeTask: active.type });
    }

    const externalToken = req.externalToken;
    if (!externalToken) {
      const authResult = await authService.getToken();
      if (!authResult.token) {
        return res.status(401).json({ error: authResult.error || '未认证' });
      }
    }

    const taskId = `visual_track_${Date.now()}`;
    res.json({
      success: true,
      taskId,
      mode: 'visual_track',
      message: '视觉跟踪已启动',
      params: { dockCode, instruction },
    });

    // 异步执行
    try {
      await visualNavService.visualTrack({
        dockCode,
        instruction,
        keepDistance: req.body.keepDistance,
        keepHeight: req.body.keepHeight,
        maxDuration: req.body.maxDuration,
        token: externalToken,
      });
    } catch (err) {
      const broadcast = global.__wsBroadcast;
      if (broadcast) broadcast('visual_track_done', { report: { error: err.message } });
    }

  } catch (err) {
    console.error('[/api/visual-track] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/visual-stop — 停止当前视觉任务
router.post('/visual-stop', (req, res) => {
  const active = visualNavService.getActiveTask();
  if (!active) {
    return res.json({ success: true, message: '当前无活跃任务' });
  }

  visualNavService.stopActiveTask('用户中止');
  res.json({
    success: true,
    message: `已发送停止信号（${active.type}）`,
    stoppedTask: active.type,
  });
});

// GET /api/visual-status — 查询当前视觉任务状态
router.get('/visual-status', (req, res) => {
  const active = visualNavService.getActiveTask();
  if (!active) {
    return res.json({ active: false, task: null });
  }

  res.json({
    active: true,
    task: {
      type: active.type,
      dockCode: active.dockCode,
      instruction: active.instruction,
      elapsed: Math.round((Date.now() - active.startTime) / 1000),
    },
  });
});

module.exports = router;
