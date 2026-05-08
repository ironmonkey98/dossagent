---
name: doss-fly
description: |
  通过自然语言控制 DOSS 无人机飞行：起飞、飞向目标、返航、急停。
  当用户说"起飞"、"飞到XX位置"、"返航"、"急停"、"无人机返回"、
  "飞向经纬度"、"doss飞行控制"、"飞过去"、"悬停"、"停在那"、
  "回来"、"降高"、"升高"、"往北飞"时触发此 Skill。
  通过 uav-agent 的 NLP 解析 + 飞控执行（POST /api/parse → /api/execute）。
  依赖 doss-auth 提供的 Token。
---

# DOSS 飞行控制 Skill

## 概述

通过 uav-agent 的 NLP 解析接口，将自然语言转为飞控指令并执行。支持起飞、飞行、返航、急停等全部飞行操作。

## 安全分级

| 操作 | 风险等级 | 是否需确认 |
|------|---------|-----------|
| takeoffToPoint 起飞 | 中 | 展示参数后执行 |
| flyToPoint 飞向目标 | 中 | 展示参数后执行 |
| returnHome 返航 | 低 | 直接执行 |
| droneEmergencyStop 急停 | **高危** | 必须用户确认 |
| flightAuthorityGrab 抢控 | **高危** | 必须用户确认 |

## 自然语言 → API 映射

所有飞控指令通过两步完成：**NLP 解析** → **执行**

### 第一步：NLP 解析

```bash
curl -s -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "F06起飞到经度117.94纬度24.55高度50米"}'
```

返回示例：
```json
{
  "success": true,
  "actions": [
    {
      "cmd": "takeoffToPoint",
      "longitude": 117.94,
      "latitude": 24.55,
      "height": 50,
      "dockCode": "F06XXXX"
    }
  ],
  "geocoded": ["117.94,24.55"]
}
```

**注意**：NLP 会自动匹配设备名（如 "F06"）到对应的无人机编号。

### 第二步：确认并执行

向用户展示解析出的 actions，确认后执行：

```bash
curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "dockCode": "F06XXXX",
    "actions": [
      {"cmd": "takeoffToPoint", "longitude": 117.94, "latitude": 24.55, "height": 50}
    ]
  }'
```

立即返回 taskId，通过 WebSocket 推送执行进度。

## 常用自然语言示例

| 用户说 | message 参数 |
|--------|-------------|
| F06起飞到XX位置上空50米 | `"F06起飞到XX位置上空50米"` |
| 飞到经度117.94纬度24.55 | `"飞到经度117.94纬度24.55"` |
| 返航 | `"返航"` |
| 急停 | `"急停"` |
| 抢夺控制权 | `"抢夺控制权"` |
| 暂停飞行 | `"暂停飞行"` |
| 恢复飞行 | `"恢复飞行"` |

## 支持的飞控指令（cmd）

| cmd | 说明 | 关键参数 |
|-----|------|---------|
| `takeoffToPoint` | 起飞到目标点 | longitude, latitude, height |
| `flyToPoint` | 飞向目标点 | longitude, latitude, height |
| `returnHome` | 返航 | — |
| `droneEmergencyStop` | 急停 | — |
| `flightTaskPause` | 暂停飞行 | — |
| `flightTaskRecovery` | 恢复飞行 | — |
| `flightAuthorityGrab` | 抢夺控制权 | — |

## WebSocket 进度事件

| 事件类型 | 说明 |
|---------|------|
| `flight_status` | 步骤进度（task_start/step_start/step_complete/task_complete） |
| `flight_telemetry` | 实时遥测（位置、高度、速度） |

## 典型操作流程

```
1. doss-status 确认设备在线
2. POST /api/parse 解析自然语言指令
3. 向用户展示解析结果并确认
4. POST /api/execute 执行
5. 监听 WebSocket 跟踪进度
```

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `缺少 actions 数组` | 请求格式错误 | 确保 actions 是数组 |
| `Token已失效` | Token 过期 | 重新运行 doss-auth |
| `机场忙碌中` | 已有任务执行中 | 等待当前任务完成 |
| `坐标未能解析` | 地址无法地理编码 | 直接提供经纬度坐标 |
| `设备未匹配` | NLP 未识别设备名 | 先搜索设备获取编号 |
