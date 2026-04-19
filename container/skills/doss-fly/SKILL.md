---
name: doss-fly
description: |
  通过自然语言控制 DOSS 无人机飞行：起飞、飞向目标、返航、急停、抢夺控制权。
  当用户说"起飞"、"飞到XX位置"、"返航"、"急停"、"无人机返回"、
  "飞向经纬度"、"抢夺控制权"、"doss飞行控制"时触发此 Skill。
  依赖 doss-auth 提供的 Token。需要知道机场编号（dockCode）。
---

# DOSS 飞行控制 Skill

## 概述

通过自然语言下达飞行指令，控制 DOSS 无人机起飞、导航、返航和紧急处置。
高危操作（急停/抢夺控制权/DRC模式）需要 Boss 明确二次确认后方可执行。

## 安全分级

| 操作 | 风险等级 | 是否需确认 |
|------|---------|-----------|
| takeoff 起飞 | 中 | 展示参数后执行 |
| flyto 飞向目标 | 中 | 展示参数后执行 |
| update 更新目标 | 低 | 直接执行 |
| stop 停止飞行 | 低 | 直接执行 |
| home 返航 | 低 | 直接执行 |
| estop 急停 | **高危** | 必须加 --confirm |
| grab 抢夺控制权 | **高危** | 必须加 --confirm |
| drc 指令飞行模式 | **高危** | 必须加 --confirm |

## 自然语言 → 命令映射

当用户使用自然语言时，提取关键信息并执行对应命令：

| 用户说 | 执行 |
|--------|------|
| 起飞，飞到经度117.94纬度24.55高度50米 | `takeoff --dock <code> --lon 117.94 --lat 24.55 --height 50` |
| 飞到XX位置上空80米 | `flyto --dock <code> --lon ... --lat ... --height 80` |
| 把目标改到XX | `update --dock <code> --lon ... --lat ... --height ...` |
| 停止飞行 / 悬停 | `stop --dock <code>` |
| 返航 / 回来 | `home --dock <code>` |
| 急停！ | `estop --dock <code> --confirm`（需用户确认） |
| 抢夺控制权 | `grab --dock <code> --confirm`（需用户确认） |

> **注意**：执行前请先通过 `doss-status` 确认机场编号（dockCode）

## 命令详解

### 起飞（takeoff）

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py takeoff \
  --dock DOCK001 \
  --lon 117.9438 \
  --lat 24.5576 \
  --height 50 \
  --rth-height 100 \
  --takeoff-height 30
```

参数说明：
- `--height` 目标点飞行高度（m）
- `--rth-height` 返航高度，默认 100m
- `--takeoff-height` 起飞离地高度，默认 30m

### 飞向目标（flyto）

> 适用于无人机已在空中时重新指定目标点

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py flyto \
  --dock DOCK001 --lon 117.950 --lat 24.560 --height 80
```

### 更新目标（update）

> 飞行途中实时更新目标，无需中断当前飞行

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py update \
  --dock DOCK001 --lon 117.955 --lat 24.565 --height 80
```

### 停止飞行（stop）

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py stop --dock DOCK001
```

### 返航（home）

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py home --dock DOCK001
```

### 急停 ⚠️（estop）

> 立即中断所有飞行指令，无人机就地悬停

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py estop --dock DOCK001 --confirm
```

### 抢夺控制权 ⚠️（grab）

> 当其他用户占用控制权时使用，会强制中断他人操作

```bash
python3 ~/.claude/skills/doss-fly/scripts/doss_fly.py grab --dock DOCK001 --confirm
```

## 获取机场编号（dockCode）

若不知道 dockCode，先运行 `doss-status` 查询：
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py --type dock
```
在输出中找到 `[DOCK-XXX]` 方括号内的编号即为 dockCode。

## 典型操作流程

```
1. doss-status 查确认机场状态和 dockCode
2. doss-fly takeoff 起飞到目标点
3. doss-fly flyto 调整目标（如需）
4. doss-fly home 任务完成返航
```
