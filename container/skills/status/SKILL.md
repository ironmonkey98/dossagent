---
name: status
description: |
  快速只读健康检查——会话上下文、工作区挂载、工具可用性、任务快照。
  当用户说"系统状态"、"健康检查"、"运行状态"、"检查环境"、"当前状态"、
  "环境正常吗"、"工作区状态"、"/status"、"看看系统"、"一切正常吗"时触发此 Skill。
  只读查询，不修改任何状态。
---

# /status — 系统状态检查

生成快速只读状态报告。

**主频道检查**：只有主频道挂载了 `/workspace/project`。运行：

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

如果返回 `NOT_MAIN`，回复：
> 此命令仅在主频道可用。请在主频道发送 `/status` 检查系统状态。

然后停止——不生成报告。

## 信息采集步骤

依次运行以下命令，将结果汇编为报告。

### 1. 会话上下文

```bash
echo "Timestamp: $(date)"
echo "Working dir: $(pwd)"
echo "Channel: main"
```

### 2. 工作区与挂载

```bash
echo "=== Workspace ==="
ls /workspace/ 2>/dev/null
echo "=== Group folder ==="
ls /workspace/group/ 2>/dev/null | head -20
echo "=== Extra mounts ==="
ls /workspace/extra/ 2>/dev/null || echo "none"
echo "=== IPC ==="
ls /workspace/ipc/ 2>/dev/null || echo "empty"
```

### 3. 工具可用性

确认当前可用的工具族：

- **核心：** Bash, Read, Write, Edit, Glob, Grep
- **网络：** WebSearch, WebFetch
- **编排：** Task, TaskOutput, TaskStop, TeamCreate, TeamDelete, SendMessage
- **MCP：** mcp__nanoclaw__*（send_message, schedule_task, list_tasks 等）

如果某个工具族调用失败，在报告中标记为 `✗`。

### 4. 容器工具

```bash
which agent-browser 2>/dev/null && echo "agent-browser: available" || echo "agent-browser: not installed"
node --version 2>/dev/null || echo "Node: not found"
claude --version 2>/dev/null || echo "Claude Code: not found"
```

### 5. 调度任务快照

使用 MCP 工具列出任务：

```
调用 mcp__nanoclaw__list_tasks 获取已调度任务列表
```

若无任务，报告"No scheduled tasks."

### 6. DOSS 连接状态（可选）

如果已安装 doss-* 技能，检查 Token 状态：

```bash
if [ -f ~/.claude/doss_session.json ]; then
  python3 -c "
import json, pathlib, datetime
s = json.loads(pathlib.Path.home().joinpath('.claude','doss_session.json').read_text())
elapsed = (datetime.datetime.now() - datetime.datetime.fromisoformat(s['saved_at'])).total_seconds()
print(f'Token: valid ({int(86400-elapsed)}s remaining)' if elapsed < 86400 else 'Token: expired')
" 2>/dev/null || echo "Token: read error"
else
  echo "Token: not found"
fi
```

## 报告格式

根据实际结果生成精简报告。**保持简洁**——这是快速健康检查：

```
🔍 *NanoClaw 状态*

*会话：*
• 频道：main
• 时间：2026-03-14 09:30 UTC
• 工作目录：/workspace/group

*工作区：*
• 群组文件夹：✓（N 个文件）
• 额外挂载：无 / N 个目录
• IPC：✓（messages, tasks, input）/ 空

*工具：*
• 核心：✓  网络：✓  编排：✓  MCP：✓
（如某项不可用标记为 ✗ 并说明原因）

*容器：*
• agent-browser：✓ / 未安装
• Node：vXX.X.X
• Claude Code：vX.X.X

*调度任务：*
• N 个活跃任务 / 无调度任务

*DOSS 连接：*
• Token：有效（剩余 XXs）/ 已过期 / 未配置
```

## 常见问题处理

| 问题 | 原因 | 处理方式 |
|------|------|---------|
| MCP 工具调用失败 | MCP 服务未启动 | 标记 MCP: ✗，建议检查服务状态 |
| IPC 目录为空 | 无待处理消息 | 正常状态，无需处理 |
| 工作区挂载缺失 | 容器配置问题 | 建议检查容器启动参数 |
| Token 过期 | 超过 24 小时 | 建议运行 doss-auth 重新登录 |
| Node/Claude 未找到 | PATH 配置问题 | 标记未安装，不影响基本功能 |

**相关命令：** `/capabilities` — 完整技能和工具能力清单
