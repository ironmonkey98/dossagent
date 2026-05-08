/**
 * 设备路由 - /api/devices
 *
 * 提供设备列表查询、缓存刷新、模糊搜索、近邻机场查询接口
 */
'use strict';

const express = require('express');
const router  = express.Router();
const deviceService = require('../services/device-service');
const deviceCache   = require('../lib/device-cache');

// GET /api/devices — 获取缓存的设备列表（首次调用自动加载）
router.get('/devices', async (req, res) => {
  try {
    const token = req.externalToken;
    const docks = await deviceService.ensureDevicesLoaded(token);
    res.json({
      success: true,
      count: docks.length,
      docks,
    });
  } catch (err) {
    console.error('[/api/devices] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devices/refresh — 强制刷新设备缓存
router.post('/devices/refresh', async (req, res) => {
  try {
    const token = req.externalToken;
    if (!token) {
      return res.status(401).json({ error: '刷新设备缓存需要提供 token' });
    }
    const count = await deviceService.loadDevices(token);
    const cache = deviceCache.readCache();
    res.json({
      success: true,
      count,
      docks: cache ? cache.docks : [],
      message: `设备缓存已刷新，共加载 ${count} 个机场`,
    });
  } catch (err) {
    console.error('[/api/devices/refresh] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devices/search?keyword=A01 — 模糊搜索设备
router.get('/devices/search', (req, res) => {
  try {
    const keyword = req.query.keyword;
    if (!keyword) {
      return res.status(400).json({ error: '缺少 keyword 参数' });
    }

    const aircrafts = deviceCache.findAircraftByName(keyword);
    const docks     = deviceCache.findDockByName(keyword);

    res.json({
      success: true,
      keyword,
      aircrafts,
      docks,
      total: aircrafts.length + docks.length,
    });
  } catch (err) {
    console.error('[/api/devices/search] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devices/nearby?lng=118.08&lat=24.61&radius=10 — 查找附近机场
router.get('/devices/nearby', (req, res) => {
  try {
    const lng    = parseFloat(req.query.lng);
    const lat    = parseFloat(req.query.lat);
    const radius = parseFloat(req.query.radius) || 50;

    if (isNaN(lng) || isNaN(lat)) {
      return res.status(400).json({ error: '缺少或无效的 lng/lat 参数' });
    }

    const results = deviceService.findNearbyDocks(lng, lat, radius);
    res.json({
      success: true,
      lng,
      lat,
      radiusKm: radius,
      count: results.length,
      docks: results,
    });
  } catch (err) {
    console.error('[/api/devices/nearby] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
