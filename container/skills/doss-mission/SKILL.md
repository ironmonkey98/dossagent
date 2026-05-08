---
name: doss-mission
description: |
  管理 DOSS 平台的飞行任务和活动，包括查询、创建、查看报告和识别事件。
  当用户说"查看任务"、"今天的任务"、"任务列表"、"创建立即任务"、
  "飞行报告"、"识别事件"、"任务详情"、"活动列表"、"doss任务"、
  "今天飞了什么"、"任务执行情况"、"下载报告"、"有什么事件"、
  "创建巡查"、"开始飞"、"任务状态"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
---

# DOSS 任务管理 Skill

## 概述

查询和管理 DOSS 平台飞行任务全生命周期：任务列表、详情、活动、立即任务创建、飞行报告、识别事件。

## 自然语言 → 命令映射

| 用户说 | 执行命令 |
|--------|---------|
| 查看今天的任务 | `list --date-start "今天 00:00:00" --date-end "今天 23:59:59"` |
| 查看执行中的任务 | `list --status 1` |
| 任务 XXX 的详情 | `detail --id <id>` |
| 查看活动列表 | `apply` |
| 用航线 XXX 创建立即任务 | `create --route-id <id>` |
| 查看飞行报告 | `report` |
| 查看任务 XXX 的识别事件 | `events --task-id <id>` |

## 子命令详解

### 1. list — 查询飞行任务列表

```bash
# 查询所有任务（默认最近10条）
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py list

# 按状态过滤（1=执行中 2=已完成）
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py list --status 1

# 按时间范围过滤
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py list \
  --date-start "2026-03-01 00:00:00" --date-end "2026-03-12 23:59:59"

# 按航线名过滤
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py list --route-name "巡检"

# 翻页
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py list --page 2 --size 20
```

**任务状态码：** 0=未开始 1=执行中 2=已完成 3=启动失败 4=部分执行 5=已取消

### 2. detail — 任务详情

```bash
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py detail --id <task_id>
```

返回：状态、时间、航线、无人机、机场、航点进度、告警事件数、媒体资源数

### 3. apply — 活动列表

```bash
# 查询全部活动
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py apply

# 只看立即任务
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py apply --attr 3
```

**活动性质：** 1=频率性任务 2=临时性任务 3=立即任务

### 4. create — 创建立即任务

> ⚠️ **此操作将派遣无人机实际飞行。** 执行前必须向用户确认以下信息：
> - 航线名称和 ID
> - 任务类型（巡查/全景/倾斜/正射）
> - 机场当前状态（通过 doss-status 确认空闲）
>
> 获得用户明确同意后再执行。

```bash
# 创建立即巡查任务（默认类型1）
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py create --route-id <airRouteId>

# 创建全景任务
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py create --route-id <airRouteId> --type 2
```

**任务类型：** 1=巡查 2=全景 3=倾斜 4=正射

### 5. report — 飞行报告

```bash
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py report

# 按任务名搜索
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py report --task-name "XX巡检"
```

### 6. events — 识别事件

```bash
# 查询任务所有识别事件
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py events --task-id <task_id>

# 只看未处理事件
python3 ~/.claude/skills/doss-mission/scripts/doss_mission.py events --task-id <task_id> --unprocessed
```

## 典型工作流

```
1. 查看今日任务    → list --date-start/end
2. 关注某任务详情  → detail --id
3. 查看识别到什么  → events --task-id
4. 下载飞行报告    → report --task-name
```

## 获取航线 ID（创建任务前）

使用 `doss-route` Skill 查询：
```bash
# 查所有航线
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes

# 按名称过滤
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes --name 巡检
```

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `Token 过期` | 超过 24 小时有效期 | 重新运行 doss-auth 登录 |
| `任务创建失败` | 航线 ID 无效或机场忙碌 | 确认航线 ID，检查机场状态 |
| `机场正在作业` | 已有任务在执行 | 等待当前任务完成或取消 |
| `航线不可用` | 航线被删除或禁用 | 重新查询航线列表获取最新 ID |
| `报告为空` | 任务尚未完成或无数据 | 等待任务完成后再查询 |
| `无识别事件` | 任务中未触发 AI 识别 | 正常情况，非所有任务都有识别事件 |
