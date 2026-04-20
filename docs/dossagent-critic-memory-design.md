# DOSSAgent 新方向设计：VLAC Critic + 视觉记忆

> 日期：2026-04-19
> 状态：设计完成，待实现
> 前置：Phase 2（ask_user IPC）已完成

---

## 方向 1：VLAC Critic 闭环（任务自纠错）

### 设计决策

| 问题 | 决策 |
|------|------|
| 实现层 | Agent Prompt 层（写入 CLAUDE.md，YAGNI） |
| 重试次数 | 固定 3 次 |
| 重试失败 fallback | 悬停 + ask_user（无人机安全第一） |
| Critic 触发时机 | 每个 flyto 后都触发 |

### Critic 闭环流程

```
[执行 flyto] ──→ [轮询 doss-status：速度<0.5m/s + 距离<5m]
                          ↓
                   [到达？]
              ┌────── Yes ──────┐
              ↓                 ↓
         [执行操作]      [No: 重试计数 +1]
              ↓                 ↓
         [继续下一段]    [重试次数 < 3？]
                         ┌── Yes ──→ [重新 flyto，偏移5m修正]
                         └── No ───→ [write ask_user IPC: 悬停，报告给用户]
```

### 在 CLAUDE.md 中新增的 Critic 规则

```markdown
## Critic 自纠错规则

每次 flyto 完成后，运行 Critic 检查（最多 3 次重试）：

1. **位置 Critic**：调用 doss-status，实际坐标与目标相差 > 5m → 触发重试
   - 重试策略：对原坐标偏移 3m 后重新 flyto（规避 GPS 漂移点）
2. **超时 Critic**：25 分钟内未到达 → 停止重试，write ask_user IPC
3. **Vision Critic**（拍照后）：分析结论为"模糊/不可见" → 自动下降 10m 重拍（最多 2 次）
4. **3 次 Critic 失败**：write ask_user IPC，内容包含：当前位置、目标位置、已尝试次数
```

### 实现范围

只改 `groups/dossagent/CLAUDE.md`，无需新建文件：

| 修改内容 | 说明 |
|---------|------|
| 新增 § Critic 自纠错规则 | 定义 3 次重试 + fallback 逻辑 |
| 更新 § 到达检测方法 | 加入 Critic 判断流 |
| 更新 § 视觉分析说明 | 结论不满足时自动下降重拍 |

---

## 方向 2：视觉中心记忆（地理 + 视觉索引）

### 设计决策

| 问题 | 决策 |
|------|------|
| 存储方式 | JSON 文件（git 可追踪，0 依赖） |
| 存储位置 | `groups/dossagent/memory/` |
| 检索接口 | 新建 `doss-memory` Skill（Python CLI） |
| 写入时机 | 每次 doss-vision 分析后自动写 |
| 存储粒度 | 每个航点一条记录 |

### 存储结构

```
groups/dossagent/
├── CLAUDE.md
└── memory/
    ├── index.json          ← 轻量索引，查询入口
    └── records/
        ├── 2026-04-19T10-30-00_WP001.json
        └── ...
```

**index.json 结构：**
```json
[
  {
    "id": "2026-04-19T10-30-00_WP001",
    "timestamp": "2026-04-19T10:30:00Z",
    "waypoint": "路灯1",
    "lat": 24.5576,
    "lon": 117.9438,
    "alt": 50,
    "anomalies_count": 1,
    "satisfied": false,
    "summary": "发现裂缝，画面清晰"
  }
]
```

**单条记录结构：**
```json
{
  "id": "2026-04-19T10-30-00_WP001",
  "timestamp": "2026-04-19T10:30:00Z",
  "waypoint": "路灯1",
  "coordinates": { "lat": 24.5576, "lon": 117.9438, "alt": 50 },
  "image_url": "https://doss.xmrbi.com/photos/xxx.jpg",
  "vision_result": {
    "visibility": "清晰",
    "anomalies": ["灯杆裂缝，长约20cm"],
    "satisfied": false,
    "recommendation": "抵近拍摄"
  },
  "task_id": "mission-001",
  "drone": "M3E-001"
}
```

### doss-memory Skill 接口

新建两个文件：
- `container/skills/doss-memory/SKILL.md`
- `container/skills/doss-memory/scripts/doss_memory.py`（~100 行）

```bash
# 写入新记录
python3 ~/.claude/skills/doss-memory/scripts/doss_memory.py \
  --action write \
  --waypoint "路灯1" \
  --lat 24.5576 --lon 117.9438 --alt 50 \
  --image-url "https://..." \
  --vision-json '{"visibility":"清晰",...}'

# 查询最近 N 条
python3 ... --action recent --limit 5

# 按坐标范围查询（半径单位：米）
python3 ... --action near --lat 24.5576 --lon 117.9438 --radius 200

# 只看有异常的记录
python3 ... --action anomalies --since 2026-04-01
```

### 自然语言 → 查询映射

Claude 理解自然语言后自动转为 CLI 参数：

| 用户说 | Claude 调用 |
|--------|------------|
| "上次在路灯1看到什么" | `--action near --lat X --lon Y --radius 50` |
| "最近10次巡检有哪些异常" | `--action anomalies --limit 10` |
| "4月份的巡检记录" | `--action recent --since 2026-04-01` |

### 实现范围

| 文件 | 操作 |
|------|------|
| `container/skills/doss-memory/SKILL.md` | 新建 |
| `container/skills/doss-memory/scripts/doss_memory.py` | 新建 |
| `groups/dossagent/CLAUDE.md` | 修改：新增"Vision 分析后调用 doss-memory write"规则 |

---

## 实施顺序

| 顺序 | 方向 | 原因 |
|------|------|------|
| 先 | 方向 1 VLAC Critic | 只改 CLAUDE.md，30 分钟内完成，直接提升飞行安全 |
| 后 | 方向 2 视觉记忆 | 独立模块，需写 Python 脚本，~2小时 |

---

## 待确认事项（已在设计中做出选择，如有异议请调整）

1. Critic fallback = 悬停 + ask_user（保守策略）
2. Critic 实现在 CLAUDE.md 层（不新建 Skill）
3. 记忆存储 = JSON 文件（不用 SQLite）
4. 实施顺序 = 方向1 → 方向2
