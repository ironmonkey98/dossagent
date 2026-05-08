---
name: doss-monitor
description: |
  实时监控 DOSS 无人机遥测数据、查询告警事件、获取视频流地址、查询历史轨迹。
  当用户说"监控无人机"、"实时状态"、"开始监控"、"查看告警"、"最近告警"、
  "未处理告警"、"获取视频流"、"直播流"、"HLS流"、"历史轨迹"、
  "飞行轨迹"、"doss监控"、"遥测数据"、"监控XX秒"、"在哪飞"、
  "飞了多远"、"风速多大"、"电量还剩多少"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
---

# DOSS 实时监控 Skill

## 概述

提供四类监控能力：WebSocket 实时遥测订阅、告警事件查询、视频流获取、历史 GPS 轨迹查询。

## 自然语言 → 命令映射

| 用户说 | 执行 |
|--------|------|
| 监控无人机 DRONE001 | `watch --device DRONE001` |
| 监控60秒后停止 | `watch --device DRONE001 --duration 60` |
| 查看最近告警 | `alerts --limit 20` |
| 只看未处理告警 | `alerts --unprocessed` |
| 获取机场视频流 | `stream --dock DOCK001` |
| 获取RTMP流 | `stream --dock DOCK001 --protocol RTMP` |
| 查询历史轨迹 | `history --device DRONE001 --start "2026-03-12 10:00:00" --end "2026-03-12 11:00:00"` |

## 命令详解

### 实时遥测监控（watch）

通过 WebSocket 实时订阅设备遥测，持续输出电量、状态、位置、高度、速度、风速等数据。

**前置依赖**：
```bash
pip install websocket-client
```

> **建议**：始终设置 `--duration` 参数避免进程无限挂起。推荐 30-120 秒。

```bash
# 监控60秒后自动退出（推荐）
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py watch \
  --device DRONE001 --duration 60

# 持续监控直到 Ctrl+C（不设 duration 时注意手动退出）
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py watch \
  --device DRONE001
```

输出示例：
```
[14:32:01] 状态:航线飞行  电量:78%  位置:24.5576,117.9438  高度:120m  速度:8.5m/s  风速:3.2m/s
```

### 告警事件查询（alerts）

```bash
# 最近20条告警
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py alerts --limit 20

# 只查未处理告警
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py alerts --unprocessed
```

### 实时视频流（stream）

支持协议：HLS（默认）、RTMP、WebRTC、GB28181

```bash
# 获取HLS流地址
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py stream \
  --dock DOCK001 --protocol HLS

# 获取RTMP流，高清画质
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py stream \
  --dock DOCK001 --protocol RTMP --quality 3
```

画质参数：0=自适应，1=流畅，2=标清，3=高清，4=超清

获取到流地址后可用 VLC 或 ffplay 播放：
```bash
ffplay <stream_url>
```

### 历史 GPS 轨迹（history）

查询时间区间最大 1 小时，可选输出 GeoJSON 文件。

```bash
# 查询轨迹（WGS-84原始坐标）
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py history \
  --device DRONE001 \
  --start "2026-03-12 10:00:00" \
  --end "2026-03-12 11:00:00"

# 同时导出 GeoJSON 文件（可在地图工具中可视化）
python3 ~/.claude/skills/doss-monitor/scripts/doss_monitor.py history \
  --device DRONE001 \
  --start "2026-03-12 10:00:00" \
  --end "2026-03-12 11:00:00" \
  --geojson
```

坐标系选项：`wgs-84`（默认）、`gcj-02`（国测局）、`bd-09`（百度）

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `WebSocket 连接失败` | 设备不在线或网络问题 | 先用 doss-status 确认设备在线 |
| `Token 过期` | 超过 24 小时有效期 | 重新运行 doss-auth 登录 |
| `设备无遥测数据` | 无人机未起飞或信号丢失 | 确认飞行状态，检查信号 |
| `告警列表为空` | 无告警事件 | 正常情况 |
| `视频流获取失败` | 设备离线或协议不支持 | 确认设备在线，尝试切换协议 |
| `轨迹查询超范围` | 时间跨度超过 1 小时 | 缩小时间范围至 1 小时内 |
| `缺少 websocket-client` | Python 库未安装 | `pip install websocket-client` |

## 典型监控流程

```
1. doss-status 查设备编号（deviceCode/dockCode）
2. doss-monitor watch 实时遥测监控
3. doss-monitor alerts 查看告警事件
4. doss-monitor stream 获取视频直播地址
5. doss-monitor history 事后查询飞行轨迹
```
