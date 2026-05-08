---
name: visual-nav-test-log-2026-04-30
description: 视觉导航首次集成测试记录：发现 WS 连接参数缺失和 VLM 配置问题
type: project
---

# 视觉导航首次集成测试 — 2026-04-30

## 测试环境
- 机场：软三F06（dockCode=8UUXN6A00A0ALQ, aircraft=1581F8HHX253L00A00V0）
- 服务：UAV Agent 运行在 localhost:8699
- 飞机状态：先离线→起飞到 120m→在线→测试→返航

## 测试结果

### ✅ 通过的环节
1. **路由注册**：visual-search/visual-track/visual-stop/visual-status 四个端点全部响应正常
2. **认证链路**：通过 `/app/sys/login` 端点（免验证码）+ externalToken 直传机制绕过 captcha
3. **任务状态管理**：getActiveTask/stopActiveTask 正常工作
4. **flyToPoint 指令下发**：cockpit API 调用成功，飞机成功起飞到 120m

### ❌ 发现的问题（2 个）

#### 问题 1：WS 遥测连接失败（关键）
- **现象**：`uav-status.connect()` 打印 `userId=(unknown)`，WS 连不上
- **原因**：`visual-nav-service.js` 调用 `uavStatus.connect(token, aircraftDeviceId, dockDeviceId)` 时只传了 token，但 uav-status 模块需要 token-cache 中的 `userInfo`（userId/loginName/useunitId）来构建 WS URL 参数
- **影响**：flyToPoint 后 `waitUntilArrived` 退化为固定 60s 倒计时等待，而非实时遥测判定
- **修复方向**：visual-nav-service 在调用 connect 前，先通过 `/sys/user/info` 获取 userInfo 并写入 token-cache，或者直接将 userInfo 传给 connect

#### 问题 2：VLM 调用配置（已修正）
- **原因**：原 .env 中 VLM_BASE_URL 是 `https://dashscope.aliyuncs.com`，代码又拼了 `/compatible-mode/v1`，导致路径正确但 API Key 不匹配
- **已修正**：
  - VLM_BASE_URL 改为 `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - VLM_API_KEY 改为 `sk-1cb7ff0f3fc041c89c3b6c6297c48078`
  - vlm-client.js URL 拼接改为 `${VLM_BASE_URL}/chat/completions`
  - system prompt 放入 messages 数组（OpenAI 兼容格式）
- **状态**：配置已修正，但 VLM 实际调用还未测试到（被问题 1 阻塞在 Phase 1）

### ⚠️ 待验证环节
1. VLM 实际调用（frame-extractor → vlm-client → 解析）—— 未走到
2. stickControl cockpit API —— 未走到
3. 完整搜索循环（Phase 2）—— 未走到
4. 视频流抓帧 —— frame-extractor 的 HTTP 截图 URL 为预留接口，实际 DOSS 图传 URL 待对接

## DOSS 认证发现
- `/sys/login`：网页端，需要图形验证码
- `/app/sys/login`：应用端，**不需要验证码**，传 `exptime` 参数
- SM2 加密用 `sm-crypto`（Node.js npm 包），不要用 `gmssl`（Python，加密结果不一致）
- Token 有效期 24h，可缓存复用

## 修正的文件清单
1. `uav-agent/.env` — VLM 三项配置修正
2. `uav-agent/server/services/vlm-client.js` — URL 拼接修正 + system prompt 放入 messages

## 第二轮准备 — 2026-04-30

### 已完成的修复
1. **WS 连接参数修复**：`visual-nav-service.js` 新增 `ensureUserInfo(token)` 函数
   - 在 `uavStatus.connect()` 调用前自动检查 token-cache 是否有 userInfo
   - 如缺失，自动调 `/sys/user/info` 获取并写入缓存
   - `visualSearch` 和 `visualTrack` 两处 WS 连接均已修复
2. **新增 `scripts/app-login.cjs`**：免验证码登录脚本，通过 `/app/sys/login`（form-urlencoded）获取 token + userInfo 并缓存
3. **Token + userInfo 已缓存**：
   - Token 有效期约 1439 分钟（~24h）
   - userInfo: userId=8b12f75ff0a749e3b73db9667ff66f48, loginName=lqsup

### 第二轮待执行步骤
1. **起飞 F06 飞机到 120m**
   - cockpitData API：`GET /uav/cockpit/getCockpitData?dockCode=8UUXN6A00A0ALQ`
   - 飞机当前 online=0（在机场内），dock online=1
   - dockData 中没有经纬度，起飞坐标需从地图选点或其他方式获取
   - 起飞指令：`POST /uav/cockpit/8UUXN6A00A0ALQ/flyToPoint` + `{longitude, latitude, height:120}`
2. **验证 WS 遥测连接**（第一轮核心阻塞点）
   - 确保 `ensureUserInfo` 生效，WS URL 不再 `userId=(unknown)`
   - 验证 `waitUntilArrived` 能收到实时遥测数据
3. **测试 VLM 视觉搜索循环**
   - 指令：找中庭公园的水池，对着水池拍照
   - instruction="中庭公园的水池"
   - 需要提供水池的大致坐标（targetLng/targetLat）
4. **视频流抓帧**
   - 当前 `getStreamUrl()` 返回预留的 HTTP 截图接口
   - 需要对接实际的 DOSS 图传 URL

### F06 关键参数
- dockCode: `8UUXN6A00A0ALQ`
- dockId: `accdc56f4e5e438085510e673eaf4484`
- aircraftDeviceCode: `1581F8HHX253L00A00V0`
- aircraftDeviceId: `44581df622164995bb347bc2798cb258`
- model: Matrice 4D

### 修正的文件清单（第二轮）
1. `uav-agent/server/services/visual-nav-service.js` — 新增 ensureUserInfo + 两处 WS 连接前调用
2. `uav-agent/scripts/app-login.cjs` — 新增，/app/sys/login 免验证码登录脚本

### 下轮测试待办
1. 获取 F06 附近坐标（水池位置），起飞到 120m
2. 验证 WS 遥测连接（ensureUserInfo 修复验证）
3. 验证 VLM 抓帧→分析→决策的完整循环
4. 对接实际视频流 URL（替代预留接口）

## 第三轮测试进展 — 2026-04-30

### 本地验证结果
1. **主仓库测试**：`npm test` 通过，18 个测试文件、246 个用例全部通过
2. **类型检查**：`npm run typecheck` 通过
3. **Lint**：`npm run lint` 未通过，阻塞错误为 `src/api-server.ts:43` 的 `callLLM` 未使用；其余为既有 warning
4. **UAV Agent 健康检查**：`GET http://localhost:8699/api/health` 返回 `status=ok`
5. **视觉任务状态**：`GET /api/visual-status` 返回 `active=false`
6. **视觉路由参数校验**：
   - `POST /api/visual-stop` 在无任务时正常返回
   - `POST /api/visual-search` 缺少 `instruction` 或坐标时正确返回 400 级错误消息
   - `POST /api/visual-track` 缺少 `instruction` 时正确返回错误消息
7. **Token/userInfo 缓存**：token 存在且剩余约 1422 分钟，`userInfo.userId` 已缓存
8. **VLM 配置**：`VLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`，`VLM_PROVIDER=qwen`，`VLM_MODEL=qwen-vl-max`，API Key 已配置
9. **F06 缓存状态**：dock online=1，aircraft online=1，aircraftDeviceId 与第二轮记录一致；缓存中仍无经纬度，`available=false`

### 当前结论
- 第一轮的 WS 参数缺失问题具备复测条件：token-cache 已有 `userInfo.userId`，`visual-nav-service.js` 会在 `uavStatus.connect()` 前调用 `ensureUserInfo(token)`。
- 尚未执行真实 DOSS 生产接口联调、WS 连接、VLM 实际调用、飞行控制或抓帧，因为这些操作会发送生产 token/API Key，部分还会控制真实无人机。

### 下一步需要确认
1. 只读联调：调用 DOSS `getCockpitData` 并尝试 WS 遥测连接，不下发飞行控制
2. VLM 联调：用测试图片调用 DashScope VLM，验证响应和 JSON 解析
3. 飞控联调：在提供目标坐标后执行 `flyToPoint`/视觉搜索真实任务
