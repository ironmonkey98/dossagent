---
name: capabilities
description: |
  展示当前 NanoClaw 实例的完整能力清单——已安装技能、可用工具、MCP 服务和系统信息。
  当用户说"你能做什么"、"有哪些功能"、"你会什么"、"有什么技能"、
  "查看能力"、"功能列表"、"能帮我做什么"、"支持什么"、"/capabilities"、
  "装了哪些插件"、"有什么工具"时触发此 Skill。只读查询，不修改任何状态。
---

# /capabilities — 系统能力报告

生成结构化的只读能力报告。

**主频道检查**：只有主频道挂载了 `/workspace/project`。运行：

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

如果返回 `NOT_MAIN`，回复：
> 此命令仅在主频道可用。请在主频道发送 `/capabilities` 查看完整能力列表。

然后停止——不生成报告。

## 信息采集步骤

依次运行以下命令，将结果汇编为报告。

### 1. 已安装技能

列出可用技能目录：

```bash
ls -1 /home/node/.claude/skills/ 2>/dev/null || echo "No skills found"
```

每个目录即一个已安装技能。目录名即技能名（如 `agent-browser` → `/agent-browser`）。

### 2. 可用工具

从 SDK 配置中确认工具权限。通常可用：

- **核心：** Bash, Read, Write, Edit, Glob, Grep
- **网络：** WebSearch, WebFetch
- **编排：** Task, TaskOutput, TaskStop, TeamCreate, TeamDelete, SendMessage
- **其他：** TodoWrite, ToolSearch, Skill, NotebookEdit
- **MCP：** mcp__nanoclaw__*（消息、任务、群组管理）

### 3. MCP 服务工具

NanoClaw MCP 服务器暴露以下工具（`mcp__nanoclaw__*` 前缀）：

| 工具 | 说明 |
|------|------|
| `send_message` | 发送消息到用户/群组 |
| `schedule_task` | 创建定时或周期任务 |
| `list_tasks` | 列出已调度任务 |
| `pause_task` | 暂停任务 |
| `resume_task` | 恢复暂停的任务 |
| `cancel_task` | 取消并删除任务 |
| `update_task` | 更新已有任务 |
| `register_group` | 注册新聊天/群组（仅主频道） |

### 4. 容器工具（Bash 工具）

检查容器内可执行工具：

```bash
which agent-browser 2>/dev/null && echo "agent-browser: available" || echo "agent-browser: not found"
```

### 5. 群组信息

```bash
ls /workspace/group/CLAUDE.md 2>/dev/null && echo "Group memory: yes" || echo "Group memory: no"
ls /workspace/extra/ 2>/dev/null && echo "Extra mounts: $(ls /workspace/extra/ 2>/dev/null | wc -l | tr -d ' ')" || echo "Extra mounts: none"
```

### 6. 网络连通性（可选）

```bash
curl -s --max-time 3 https://httpbin.org/status/200 > /dev/null 2>&1 && echo "Internet: reachable" || echo "Internet: unreachable"
```

## 报告格式

根据实际采集结果生成报告。**不要列出未安装的功能**：

```
📋 *NanoClaw 能力清单*

*已安装技能：*
• /agent-browser — 浏览网页、填写表单、提取数据
• /capabilities — 本报告
（列出所有发现的技能）

*工具：*
• 核心：Bash, Read, Write, Edit, Glob, Grep ✓
• 网络：WebSearch, WebFetch ✓
• 编排：Task, TeamCreate, SendMessage ✓
• MCP：send_message, schedule_task, list_tasks, pause/resume/cancel/update_task, register_group ✓

*容器工具：*
• agent-browser：✓ / 未安装

*系统：*
• 群组记忆：是/否
• 额外挂载：N 个目录 / 无
• 主频道：是
• 网络连通：正常 / 不可达
```

## 常见问题处理

| 问题 | 原因 | 处理方式 |
|------|------|---------|
| `No skills found` | 技能目录为空 | 提示用户安装技能 |
| `Internet: unreachable` | 网络不通 | 提示检查容器网络配置 |
| MCP 工具列表为空 | MCP 服务未启动 | 提示检查 MCP 配置 |
| 非主频道 | 当前群组无项目挂载 | 引导用户到主频道操作 |

**相关命令：** `/status` — 快速健康检查（会话、工作区、任务状态）
