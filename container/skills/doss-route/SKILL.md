---
name: doss-route
description: |
  查询 DOSS 平台的项目、航线和航点数据，为创建飞行任务提供所需 ID。
  当用户说"查看航线"、"航线列表"、"查找航线"、"项目列表"、"查看项目"、
  "航点数据"、"航线详情"、"我要飞XX航线"、"doss航线"、"航线规划"、
  "有多少航线"、"搜索航线"、"机场关联"、"哪个项目"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
---

# DOSS 航线与项目管理 Skill

## 概述

查询 DOSS 平台的项目、航线、航点数据，获取航线 ID 以便传给 `doss-mission` 创建飞行任务。

## 自然语言 → 命令映射

| 用户说 | 执行命令 |
|--------|---------|
| 查看项目列表 | `projects` |
| 查找名为"巡检"的项目 | `projects --name 巡检` |
| 查询项目关联的机场 | `docks --project-id <id>` |
| 查看所有航线 | `routes` |
| 查找名为"沈海"的航线 | `routes --name 沈海` |
| 查询某项目下的航线 | `routes --project-id <id>` |
| 查看航线详情（含航点）| `detail --id <route_id>` |
| 查询某航线所有航点 | `waypoints --route-id <route_id>` |

## 子命令详解

### 1. projects — 查询项目列表

```bash
python3 ~/.claude/skills/doss-route/scripts/doss_route.py projects

# 按名称过滤
python3 ~/.claude/skills/doss-route/scripts/doss_route.py projects --name 巡检

# 翻页
python3 ~/.claude/skills/doss-route/scripts/doss_route.py projects --page 2 --size 20
```

输出示例：
```
═══ 项目列表 (1 个) ═══
  项目: 软三项目
  ID: e68d66f5-6343-42d6-b5ba-6805824608d5
  创建时间: 2025-06-04 15:17:53
```

### 2. docks — 查询项目关联机场

```bash
python3 ~/.claude/skills/doss-route/scripts/doss_route.py docks --project-id <project_id>

# 按机场名过滤
python3 ~/.claude/skills/doss-route/scripts/doss_route.py docks --project-id <id> --name 软三
```

### 3. routes — 查询航线列表

```bash
# 查询所有航线（默认20条）
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes

# 按名称模糊查询
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes --name 沈海高速

# 按项目过滤
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes --project-id <id>

# 翻页
python3 ~/.claude/skills/doss-route/scripts/doss_route.py routes --page 2 --size 20
```

输出示例：
```
═══ 航线列表 (72 条) ═══
  航线: 沈海高速路面病害测试
  ID: 0adb1b371b404d11b1d568c82924e584
  项目: 天源欧瑞（路桥信息）项目
  距离: 1405.61m  高度: 15.0m  速度: 10.0m/s  预计: 162s  航点数: 6
  起点: 24.609972, 118.046395
```

### 4. detail — 查询航线详情（含航点）

```bash
python3 ~/.claude/skills/doss-route/scripts/doss_route.py detail --id <route_id>
```

返回：航线基本信息 + 所有航点坐标列表

### 5. waypoints — 查询航点数据

```bash
python3 ~/.claude/skills/doss-route/scripts/doss_route.py waypoints --route-id <route_id>

# 翻页（航点多时）
python3 ~/.claude/skills/doss-route/scripts/doss_route.py waypoints --route-id <id> --page 2
```

## 典型工作流

```
创建任务前的准备：

1. 查项目列表，找到目标项目 ID
   → doss-route projects --name 巡检

2. 查项目下的航线，找到目标航线 ID
   → doss-route routes --project-id <project_id> --name 目标航线

3. 确认航线详情（距离/高度/航点）
   → doss-route detail --id <route_id>

4. 用航线 ID 创建飞行任务
   → doss-mission create --route-id <route_id>
```

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `Token 过期` | 超过 24 小时有效期 | 重新运行 `doss-auth` 登录 |
| `项目列表为空` | 账号无项目权限 | 确认 DOSS 账号权限或联系管理员 |
| `航线列表为空` | 项目下未创建航线 | 在 DOSS 平台先规划航线 |
| `航线 ID 不存在` | ID 错误或已被删除 | 重新查询获取最新航线列表 |
| `网络请求失败` | 网络不通或 VPN | 检查网络连接或 VPN 状态 |
| `无搜索结果` | 过滤条件太严格 | 放宽名称过滤条件或去掉 --name 参数 |

## 空结果排查步骤

当查询返回空列表时，按以下顺序排查：

1. **去掉过滤条件**：先不加 `--name` 查看全部结果
2. **检查 Token**：确认 `doss-auth` 已登录且未过期
3. **扩大范围**：尝试 `--page 1 --size 50` 增大返回数量
4. **确认权限**：DOSS 平台确认当前账号有项目访问权限

## 注意事项

- 航线类型固定传 `types=5`（无人机机场航线）
- `detail` 命令已包含航点，无需再调用 `waypoints`
- Token 过期时运行 `doss-auth` 重新登录
