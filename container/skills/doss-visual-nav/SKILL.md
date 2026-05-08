---
name: doss-visual-nav
description: |
  无人机视觉导航与目标跟踪。基于 Qwen VLM + stickControl 组合方案，
  支持视觉搜索抵近和视觉持续跟踪两个能力。
  当用户说"飞过去找到那栋红色水塔"、"跟踪画面中穿红衣服的人"、
  "在这附近找一下有没有异常"、"停止跟踪"、"找到那个目标"、
  "跟着那个人"、"锁定目标"、"视觉搜索"、"视觉跟踪"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
  依赖 uav-agent 服务运行中（默认 http://localhost:3000）。
---

# DOSS 视觉导航 Skill

## 概述

通过 uav-agent 服务调用视觉导航接口，实现：
1. **视觉搜索抵近**：flyToPoint 粗定位 → VLM 视觉搜索循环 → stickControl 精细抵近
2. **视觉持续跟踪**：~1Hz 循环抓帧 → VLM 分析 → stickControl 映射

所有接口通过 uav-agent HTTP API 调用，进度通过 WebSocket 推送。

## 前置条件

1. **uav-agent 服务运行中**：`curl http://localhost:3000/api/health`
2. **无人机已在空中**：需先通过 `doss-fly` 起飞
3. **Token 已缓存**：`~/.claude/doss_session.json` 存在且未过期
4. **图传正常**：能通过 HTTP 截图接口抓帧

## 安全分级

| 操作 | 风险等级 | 是否需确认 |
|------|---------|-----------|
| visual-search 搜索抵近 | 中 | 展示参数后执行 |
| visual-track 持续跟踪 | 中 | 展示参数后执行 |
| visual-stop 停止任务 | 低 | 直接执行 |

## 自然语言 → API 映射

| 用户说 | API 调用 |
|--------|---------|
| 飞过去找到那栋红色水塔 | `POST /api/visual-search {targetLng, targetLat, instruction}` |
| 在这附近找一下有没有异常 | `POST /api/visual-search {targetLng, targetLat, instruction}` |
| 跟踪画面中穿红衣服的人 | `POST /api/visual-track {instruction}` |
| 停止跟踪 / 停止搜索 | `POST /api/visual-stop` |
| 视觉任务状态 | `GET /api/visual-status` |

## 查找目标无人机

先用设备搜索接口确认 F06 无人机信息：

```bash
# 搜索 F06 无人机
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/devices/search?keyword=F06"
```

返回示例：
```json
{
  "success": true,
  "aircrafts": [{ "deviceCode": "F06XXXX", "deviceName": "F06" }],
  "docks": [{ "dockCode": "DOCK-001", "dockName": "示范机场-01" }]
}
```

## API 接口详解

### 1. 视觉搜索抵近 — POST /api/visual-search

异步执行，立即返回 taskId，进度通过 WebSocket 推送。

```bash
TOKEN=$(python3 -c "import json,pathlib; print(json.loads(pathlib.Path.home().joinpath('.claude','doss_session.json').read_text())['token'])")

curl -s -X POST http://localhost:3000/api/visual-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "dockCode": "1581F8HHX252N00A00DM",
    "targetLng": 117.9438,
    "targetLat": 24.5576,
    "targetHeight": 50,
    "instruction": "红色水塔",
    "maxSteps": 50
  }'
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dockCode` | string | 否 | 无人机编号，不传则用默认机场的无人机 |
| `targetLng` | number | 是 | 目标区域经度 |
| `targetLat` | number | 是 | 目标区域纬度 |
| `targetHeight` | number | 否 | 搜索飞行高度，默认 50m |
| `instruction` | string | 是 | 目标描述（如"红色水塔"） |
| `maxSteps` | number | 否 | 最大搜索步数，默认 50 |

**立即返回：**
```json
{
  "success": true,
  "taskId": "visual_search_1714449600000",
  "mode": "visual_search",
  "message": "视觉搜索已启动",
  "params": { "dockCode": "...", "targetLng": 117.94, "targetLat": 24.55, "instruction": "红色水塔" }
}
```

**WebSocket 进度事件：**

| 事件类型 | 说明 |
|---------|------|
| `visual_search_step` | 每步搜索进度（step, phase, action） |
| `visual_search_found` | 找到目标（step, distance） |
| `visual_search_done` | 搜索完成（report） |

**搜索流程：**
1. 获取 Token → 反查机场编号 → 抢控
2. flyToPoint 飞到目标区域
3. VLM 视觉搜索循环（抓帧 → VLM 分析 → 决策）
4. 未找到 → 旋转搜索或飞向推测方向
5. 找到且 close → stickControl 精细抵近
6. 找到且 very_close → 悬停拍照，搜索成功

### 2. 视觉持续跟踪 — POST /api/visual-track

```bash
curl -s -X POST http://localhost:3000/api/visual-track \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "dockCode": "1581F8HHX252N00A00DM",
    "instruction": "穿红衣服的人",
    "keepDistance": 30,
    "keepHeight": 50,
    "maxDuration": 300
  }'
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dockCode` | string | 否 | 无人机编号 |
| `instruction` | string | 是 | 目标描述 |
| `keepDistance` | number | 否 | 保持距离（米），默认 30 |
| `keepHeight` | number | 否 | 保持高度 |
| `maxDuration` | number | 否 | 最大跟踪时长（秒），默认 300 |

**WebSocket 进度事件：**

| 事件类型 | 说明 |
|---------|------|
| `visual_track_step` | 每步跟踪（step, found, sticks） |
| `visual_track_lost` | 目标丢失（step, consecutiveLost） |
| `visual_track_done` | 跟踪完成（report） |

**跟踪控制映射：**

VLM 输出离散语义标签 → 确定性 stickControl 参数：

| 维度 | VLM 标签 | 控制动作 |
|------|---------|---------|
| 水平 | left / right / center | yaw: -0.3 / +0.3 / 0 |
| 垂直 | up / down / center | pitch: +0.3 / -0.3 / 0 |
| 距离 | too_far / too_close / good | throttle: +0.5 / -0.3 / 0 |

**丢失恢复策略：**
- 前 3 帧：悬停等待
- 3 帧后：缓慢旋转搜索
- 连续丢失 10 帧（~10s）：暂停并通知

### 3. 停止任务 — POST /api/visual-stop

```bash
curl -s -X POST http://localhost:3000/api/visual-stop \
  -H "Authorization: Bearer $TOKEN"
```

**返回：**
```json
{
  "success": true,
  "message": "已发送停止信号（search）",
  "stoppedTask": "search"
}
```

### 4. 查询状态 — GET /api/visual-status

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/visual-status
```

**返回：**
```json
{
  "active": true,
  "task": {
    "type": "search",
    "dockCode": "1581F8HHX252N00A00DM",
    "instruction": "红色水塔",
    "elapsed": 45
  }
}
```

无活跃任务时返回 `{ "active": false, "task": null }`。

## 典型操作流程

```
1. 确认 uav-agent 服务运行 → curl /api/health
2. 搜索目标无人机编号 → GET /api/devices/search?keyword=F06
3. doss-fly takeoff 起飞到目标区域上空
4. 启动视觉搜索 → POST /api/visual-search
5. 监听 WebSocket 跟踪进度
6. 找到目标后可切换跟踪 → POST /api/visual-track
7. 完成后停止 → POST /api/visual-stop
8. doss-fly home 返航
```

## 搜索失败退出条件

| 条件 | 行为 |
|------|------|
| 达到 maxSteps 上限 | 悬停并报告"搜索步数耗尽，未找到目标" |
| VLM 连续 5 次调用失败 | 报告"VLM 服务异常" |
| 用户中止 | POST /api/visual-stop 立即停止 |
| 抓帧连续失败 | 每次等待 2s 重试，不影响计数 |

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `已有任务正在执行` | 前一个任务未完成 | 先调用 `visual-stop` 停止 |
| `缺少 instruction` | 未提供目标描述 | 必须传入 instruction 参数 |
| `缺少 targetLng/targetLat` | 搜索模式必须提供坐标 | 提供目标区域坐标 |
| `视频流不可用` | 图传未开启或网络问题 | 检查 doss-camera stream 状态 |
| `Token已失效` | doss-auth Token 过期 | 重新运行 doss-auth 登录 |
| `uav-agent 连接失败` | 服务未启动 | 检查 uav-agent 服务状态 |
| `VLM 返回内容为空` | VLM 服务异常 | 检查 VLM_API_KEY 环境变量 |

## 环境变量

uav-agent 服务依赖以下环境变量（在 uav-agent 的 `.env` 中配置）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VLM_PROVIDER` | `qwen` | VLM 提供商（qwen/openai/local） |
| `VLM_BASE_URL` | `https://dashscope.aliyuncs.com` | VLM API 地址 |
| `VLM_API_KEY` | — | VLM API 密钥 |
| `VLM_MODEL` | `qwen-vl-max` | VLM 模型名称 |
| `VISUAL_SEARCH_MAX_STEPS` | `50` | 搜索最大步数 |
| `VISUAL_TRACK_MAX_DURATION` | `300` | 跟踪最大时长（秒） |
| `VISUAL_ARRIVE_DIST` | `20` | 抵近完成距离（米） |
