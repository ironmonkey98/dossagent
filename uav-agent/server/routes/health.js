/**
 * 健康检查路由
 */
'use strict';

const express = require('express');
const router  = express.Router();

router.get('/health', (req, res) => {
  const hasDashscope = process.env.DASHSCOPE_API_KEY && !process.env.DASHSCOPE_API_KEY.includes('your-');
  const hasZhipu = process.env.ZHIPU_API_KEY && !process.env.ZHIPU_API_KEY.includes('your-');

  res.json({
    status: 'ok',
    services: {
      lib: 'ok',
      llm: (hasDashscope || hasZhipu) ? 'ok' : 'not_configured',
      dashscope: hasDashscope ? 'ok' : 'not_configured',
      zhipu: hasZhipu ? 'ok' : 'not_configured',
    },
    config: {
      baseUrl: process.env.UAV_BASE_URL || '',
      mapUrl: process.env.MAP_URL || '',
    },
    timestamp: Date.now(),
  });
});

module.exports = router;
