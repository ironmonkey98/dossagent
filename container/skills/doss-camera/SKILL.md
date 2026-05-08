---
name: doss-camera
description: |
  控制 DOSS 无人机摄像头与负载设备：拍照、录像、变焦、切换模式、探照灯、喊话器。
  当用户说"拍照"、"录像"、"变焦"、"探照灯"、"喊话"、"切换红外"、
  "doss摄像头"、"负载控制"、"看直播"、"视频流"、"云台"时触发此 Skill。
  通过 uav-agent 的 NLP 解析 + 飞控执行（POST /api/parse → /api/execute）。
  依赖 doss-auth 提供的 Token。
---

# DOSS 摄像头与负载控制 Skill

## 概述

通过 uav-agent 的 NLP 解析接口控制无人机摄像头、探照灯、喊话器等负载。与飞控使用相同接口。

## 自然语言 → API 映射

### 第一步：NLP 解析

```bash
curl -s -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "F06拍张照片"}'
```

### 第二步：执行

```bash
curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"dockCode": "F06XXXX", "actions": [{"cmd": "cameraPhotoTake"}]}'
```

## 常用自然语言示例

| 用户说 | message 参数 |
|--------|-------------|
| 拍张照片 | `"拍张照片"` |
| 开始录像 | `"开始录像"` |
| 停止录像 | `"停止录像"` |
| 看向经度117.94纬度24.55 | `"看向经度117.94纬度24.55"` |
| 开探照灯 | `"开探照灯"` |
| 喊话：请注意安全 | `"喊话：请注意安全"` |
| 切换到红外模式 | `"切换到红外模式"` |
| 云台复位 | `"云台复位"` |

## 支持的负载指令（cmd）

| cmd | 说明 | 关键参数 |
|-----|------|---------|
| `cameraPhotoTake` | 拍照 | — |
| `cameraRecordingStart` | 开始录像 | — |
| `cameraRecordingStop` | 停止录像 | — |
| `cameraLookAt` | 云台对准目标 | longitude, latitude, height |
| `cameraModeSwitch` | 相机模式切换 | cameraMode (0=拍照 1=录像 2=低光 3=全景) |
| `gimbalReset` | 云台复位 | resetMode |
| `cameraScreenDrag` | 云台拖拽 | screenX, screenY |
| `lightModeSet` | 探照灯模式 | lightMode (0=关 1=常亮 2=爆闪) |
| `lightBrightnessSet` | 探照灯亮度 | brightness (1-100) |
| `speakerTtsPlayStart` | TTS 播报 | text, voiceType |

> 负载索引（payloadIndex）由系统自动从驾驶舱数据获取，无需手动指定。

## 安全提示

- 抢夺负载控制权 (`payloadAuthorityGrab`) 会中断其他用户操作，需用户确认
- TTS 播报音量受设备限制，长文本会分段播报

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `设备离线` | 机场或无人机未连接 | 先用 doss-status 确认设备状态 |
| `Token已失效` | Token 过期 | 重新运行 doss-auth |
| `控制权被占用` | 其他用户正在操作 | 确认后使用抢夺控制权 |
| `负载不可用` | 设备不支持该负载 | 确认设备型号支持的负载类型 |

## 视频流获取

获取实时视频流需使用 DOSS 平台 API 直接调用（uav-agent 暂未封装）：

```bash
# 获取视频流地址（需要无人机的 deviceCode）
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://doss.xmrbi.com/xmrbi-onecas/uav/cockpit/${DOCK_CODE}/liveStreamSnapshot"
```

或通过 doss-monitor skill 的视频流接口。
