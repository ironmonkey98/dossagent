/**
 * UAV Agent - Express 服务器入口
 *
 * 启动 HTTP + WebSocket 服务，提供自然语言飞控智能体 REST API
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { WebSocketServer } = require('ws');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── 中间件 ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Token 提取中间件：从请求中提取外部传入的 token，挂载到 req.externalToken
app.use((req, res, next) => {
  // 优先级：Authorization header > X-Token header > body.token > query.token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    req.externalToken = authHeader.substring(7);
  } else if (req.headers['x-token']) {
    req.externalToken = req.headers['x-token'];
  } else if (req.body && req.body.token) {
    req.externalToken = req.body.token;
  } else if (req.query && req.query.token) {
    req.externalToken = req.query.token;
  }
  if (req.externalToken) {
    console.log(`[auth] 收到外部 token: ${req.externalToken.substring(0, 20)}...`);
  }
  next();
});

// 静态文件（生产模式下前端构建产物）
const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));

// ─── API 路由 ────────────────────────────────────────
const healthRouter  = require('./routes/health');
const parseRouter   = require('./routes/parse');
const executeRouter = require('./routes/execute');
const sttRouter     = require('./routes/stt');
const deviceRouter  = require('./routes/device');
const visualRouter = require('./routes/visual');

app.use('/api', healthRouter);
app.use('/api', parseRouter);
app.use('/api', executeRouter);
app.use('/api', sttRouter);
app.use('/api', deviceRouter);
app.use('/api', visualRouter);

// SPA fallback：前端路由由 Vue Router 处理
app.get('*', (req, res) => {
  const indexPath = path.join(webDist, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'API not found' });
  }
});

// ─── HTTP + WebSocket 服务 ───────────────────────────
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

// WebSocket 连接管理
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] 客户端连接，当前连接数: ${wsClients.size}`);

  ws.send(JSON.stringify({ type: 'connected', data: { time: Date.now() } }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] 客户端断开，当前连接数: ${wsClients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] 错误:', err.message);
    wsClients.delete(ws);
  });
});

/**
 * 向所有已连接的 WebSocket 客户端广播消息
 * @param {string} type - 消息类型
 * @param {object} data - 消息数据
 */
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(msg);
    }
  }
}

// 将 broadcast 注入到全局，供 service 层调用
global.__wsBroadcast = broadcast;

// ─── 启动 ────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     🛸  UAV NLP Agent Server                ║');
  console.log(`║     HTTP:  http://localhost:${PORT}             ║`);
  console.log(`║     WS:    ws://localhost:${PORT}/ws             ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 检查 LLM API Key
  const { isApiKeyConfigured } = require('./services/apikey-helper');
  const hasDashscope = isApiKeyConfigured(process.env.DASHSCOPE_API_KEY);
  const hasZhipu = isApiKeyConfigured(process.env.ZHIPU_API_KEY);
  console.log(`  ${hasDashscope ? '✅' : '⚠️ '} 阿里云 API Key: ${hasDashscope ? '已配置' : '未配置'}`);
  console.log(`  ${hasZhipu ? '✅' : '⚠️ '} 智谱 API Key: ${hasZhipu ? '已配置' : '未配置'}`);

  // 启动后自动初始化设备缓存
  const deviceService = require('./services/device-service');
  deviceService.tryAutoInit();
  console.log('');
});

module.exports = { app, server, broadcast };
