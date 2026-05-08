---
name: doss-status
description: |
  查询 DOSS 平台上所有机场和无人机的实时状态。
  当用户说"查看无人机状态"、"机场状态"、"哪些无人机可用"、"当前电量"、
  "风速多少"、"doss状态"、"无人机在哪"、"查看设备"、"设备在线吗"、
  "机场空闲吗"、"能不能飞"、"无人机准备好了吗"、"设备列表"、
  "搜索设备"、"F06在哪"时触发此 Skill。
  通过 uav-agent 服务查询（默认 http://localhost:3000）。
---

# DOSS 状态查询 Skill

## 概述

通过 uav-agent 设备管理接口查询所有机场和无人机的实时状态，包括在线状态、电量、可用性等。

## API 接口

### 查询全部设备

```bash
curl -s http://localhost:3000/api/devices | python3 -m json.tool
```

返回示例：
```json
{
  "success": true,
  "count": 3,
  "docks": [
    {
      "dockCode": "1581F8HHX252N00A00DM",
      "dockName": "示范机场-01",
      "model": "M3E Dock",
      "online": "1",
      "available": true,
      "zoneName": "软三项目",
      "longitude": 118.046,
      "latitude": 24.610,
      "aircraft": {
        "deviceCode": "1581F8HHX252N00A00DM",
        "deviceName": "M3E-001",
        "model": "M3E",
        "online": "0",
        "cameraIndex": "39-0-0"
      }
    }
  ]
}
```

**状态说明：**
- `online: "1"` → 在线，`"0"` → 离线
- `available: true` → 机场在线 + 无人机空闲（可立即起飞）

### 模糊搜索设备

```bash
# 搜索 F06 无人机
curl -s "http://localhost:3000/api/devices/search?keyword=F06" | python3 -m json.tool
```

返回示例：
```json
{
  "success": true,
  "keyword": "F06",
  "aircrafts": [
    {
      "dockCode": "DOCK-006",
      "dockName": "机场六号",
      "aircraft": {
        "deviceCode": "F06XXXX",
        "deviceName": "F06",
        "model": "M3E",
        "online": "1"
      },
      "score": 80
    }
  ],
  "docks": [],
  "total": 1
}
```

搜索会按名称模糊匹配，返回匹配度排序的结果。支持：
- 设备名称（如 "F06"、"M3E"）
- 机场名称（如 "示范机场"）
- 区域名称（如 "软三项目"）
- 标识符（如 "A01"）

### 查找附近机场

```bash
curl -s "http://localhost:3000/api/devices/nearby?lng=118.08&lat=24.61&radius=10" | python3 -m json.tool
```

返回指定坐标附近 radius 公里内的机场，按可用性 → 在线状态 → 距离排序。

### 强制刷新设备缓存

```bash
curl -s -X POST http://localhost:3000/api/devices/refresh \
  -H "Authorization: Bearer $TOKEN"
```

设备缓存 24 小时有效。如果设备状态有变化，刷新获取最新数据。

## 输出格式

向用户展示时，格式化为：

```
📋 *DOSS 设备状态*

*机场 (N 台)：*
• 示范机场-01 [DOCK-001] — ✅ 在线 | 无人机 M3E-001 空闲
• 机场二号 [DOCK-002] — ⚠️ 在线 | 无人机 F06 在线飞行中
• 机场三号 [DOCK-003] — ❌ 离线

*F06 搜索结果：*
• F06 → 机场六号 [DOCK-006] — ✅ 在线（匹配度: 80%）
```

## 离线设备排查

| 状态指示 | 含义 | 排查步骤 |
|---------|------|---------|
| `online: "0"` (机场) | 机场断电或网络断开 | 检查电源和网络 |
| `aircraft: null` | 机场未绑定无人机 | 在 DOSS 平台绑定 |
| `available: false` + `online: "1"` | 机场在线但无人机忙碌 | 等待当前任务完成 |

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| 设备列表为空 | 缓存过期且无 Token | 先运行 doss-auth 登录 |
| `Token已失效` | Token 过期 | 重新运行 doss-auth |
| 搜索无结果 | 关键词不匹配 | 尝试设备编号或简称 |
| uav-agent 连接失败 | 服务未启动 | 检查 uav-agent 服务状态 |
