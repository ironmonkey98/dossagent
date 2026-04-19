---
name: doss-mission
description: |
  管理 DOSS 平台的飞行任务和活动，包括查询、创建、查看报告和识别事件。
  当用户说"查看任务"、"今天的任务"、"任务列表"、"创建立即任务"、
  "飞行报告"、"识别事件"、"任务详情"、"活动列表"、"doss任务"时触发此 Skill。
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

> 注意：需要先知道航线 ID（可通过接口或 DOSS 平台获取）

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

若需要创建任务但不知道 routeId，可直接查询 DOSS 接口：
```bash
TOKEN=$(python3 -c "import json,pathlib; print(json.loads(pathlib.Path.home().joinpath('.claude','doss_session.json').read_text())['token'])")
curl -H "Authorization: $TOKEN" \
  "https://doss.xmrbi.com/xmrbi-onecas/uav/airRoute/list?types=5" | python3 -m json.tool
```
