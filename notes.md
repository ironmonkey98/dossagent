# Notes: 视觉导航技术决策与发现

## 项目结构发现

### UAV Agent 服务端（/Users/yehong/dossagent/uav-agent/server/）
- 入口：index.js（Express + WS，端口 8699）
- 路由模式：`const router = express.Router()` → `module.exports = router` → index.js 中 `app.use('/api', xxxRouter)`
- WS 广播：`global.__wsBroadcast` 全局注入，service 层通过它推送事件
- Token 机制：`req.externalToken` 优先，无 token 时走 `authService.getToken()`
- 设备缓存：`deviceCache.getDefaultDock()` 获取默认机场

### flight-service.js 关键发现
- `executeReal` 和 `getCockpitData` 已导出
- `callCockpitApi`、`httpRequest`、`callCockpitGet` 未导出（内部函数）
- cockpit API 格式：`/uav/cockpit/${cockpitDockCode}/${cmd}/${payloadIndex}`
- dockCode 实际为无人机编号，需通过 device-cache 反查机场编号

### uav-status.js 模式
- `connect(token, uavDeviceId, dockDeviceId)` → WS 连接
- `waitUntilArrived(targetHeight, timeoutMs, label)` → 阻塞等待
- `getHeight()`, `getSpeed()`, `getLongitude()`, `getLatitude()` → 状态读取
- `close()` → 断开连接

### 现有 VLM 调用模式（doss_vision.py）
- 走 Anthropic Messages 格式（非 OpenAI），带 `x-api-key` header
- 但 Node.js 侧 llm-service.js 走 OpenAI 兼容格式（dashscope compatible-mode）
- 新 vlm-client.js 统一走 OpenAI 兼容格式（与 llm-service 一致）

## 技术约束
- stickControl 未在现有代码中出现，属于 cockpit API 直接命令
- VLM_MODEL 环境变量默认 qwen-vl-max（视觉模型，区别于 qwen3-omni-flash）
- ffmpeg 需要系统安装，用于 RTSP 流抽帧

## 设计文档核对
- 设计文档路径：`docs/superpowers/specs/2026-04-29-visual-nav-design.md`
- 所有 6 个新增文件位置与设计文档一致
- API 端点名称一致：visual-search, visual-track, visual-stop, visual-status
- WS 事件名称一致：visual_search_step, visual_search_found, visual_search_done 等
