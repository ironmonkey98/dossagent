---
name: doss-status
description: |
  查询 DOSS 平台上所有机场和无人机的实时状态。
  当用户说"查看无人机状态"、"机场状态"、"哪些无人机可用"、"当前电量"、
  "风速多少"、"doss状态"、"无人机在哪"、"查看设备"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
---

# DOSS 状态查询 Skill

## 概述

实时查询 DOSS 平台所有机场和无人机的状态，包括位置、电量、飞行状态、气象数据等。
依赖 `doss-auth` Skill 提供的 Token，请确保已登录。

## 使用流程

### 前提条件

确认 Token 已缓存：
```bash
cat ~/.claude/doss_session.json
```
若无文件，先运行 `doss-auth` 登录。

### 查询命令

**查询全部设备（默认）：**
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py
```

**只查机场：**
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py --type dock
```

**只查无人机：**
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py --type drone
```

**按名称过滤（模糊匹配）：**
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py --name "M3E"
```

### 输出示例

```
正在查询 DOSS 设备状态（2026-03-12 14:30:00）...

═══ 机场状态 (2 台) ═══
  机场: 示范机场-01  [DOCK-001]
  状态: 空闲中  |  任务步骤: 任务空闲
  无人机: 舱内/开机  电量: 87%  充电: 充电中
  气象: 风速=3.2m/s  降雨=无雨  环境温度=22℃  舱内温度=28℃
  网络: 以太网  位置: 24.5576, 117.9438

═══ 无人机状态 (2 台) ═══
  无人机: M3E-001  [UAV-001]
  状态: 待机  电量: 87%
  位置: 24.5576, 117.9438  高度: 海拔120m / 相对50m
  速度: 0m/s  风速: 3.2m/s (东北)  距Home: 0m
  相机: 拍照/空闲  剩余飞行时间: 1800s

─── 共 4 台设备 ───
```

## 状态码参考

### 机场状态（modeCode）
| 代码 | 含义 |
|------|------|
| 0 | 空闲中 |
| 1 | 现场调试 |
| 2 | 远程调试 |
| 3 | 固件升级中 |
| 4 | 作业中 |

### 无人机状态（modeCode）
| 代码 | 含义 |
|------|------|
| 0 | 待机 |
| 5 | 航线飞行 |
| 9 | 自动返航 |
| 17 | 指令飞行 |
| 14 | 未连接 |

## Token 过期处理

若输出 `[警告] Token 已过期`，重新运行 `doss-auth` 获取新 Token：
```bash
python3 ~/.claude/skills/doss-auth/scripts/doss_auth.py "<用户名>" "<密码>"
```
