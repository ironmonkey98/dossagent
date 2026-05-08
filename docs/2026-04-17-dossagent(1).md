# DOSSAgent 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 在 NanoClaw 上扩展无人机具身智能体能力，通过自然语言控制 DOSS 无人机完成巡检任务。

**架构：** 分两个阶段。Phase 1 仅新建 `groups/dossagent/CLAUDE.md` System Prompt，跑通基础飞控闭环。Phase 2 新增 `doss-vision` Skill、`ask_user` IPC 类型和 `resume_context` 内存管理，实现视觉感知与断点交互。

**技术栈：** TypeScript（NanoClaw 核心）、Python CLI 脚本（已有 DOSS Skill）、Claude Vision API（原生支持）

---

## 前置确认

在开始前，确认以下已有内容：
- `container/skills/doss-auth/` ✅
- `container/skills/doss-fly/` ✅
- `container/skills/doss-status/` ✅
- `container/skills/doss-camera/` ✅
- `container/skills/doss-mission/` ✅
- `container/skills/doss-monitor/` ✅
- `src/config.ts` 中 `CONTAINER_TIMEOUT` = 1800000ms ✅
- `container/skills/` 下所有目录自动 sync 进容器 ✅（无需改 container-runner.ts）

---

## Phase 1：最小闭环

### Task 1：创建 dossagent 组目录和 System Prompt

**文件：**
- 新建：`groups/dossagent/CLAUDE.md`

**步骤 1：创建目录**

```bash
mkdir -p groups/dossagent
```

**步骤 2：写入 CLAUDE.md**

内容如下（完整）：

```markdown
# DOSS 无人机智能体

你是一名专业无人机操控智能体，负责通过自然语言指令控制 DOSS 平台无人机执行巡检任务。

## 可用技能

- **doss-auth**：Token 登录与刷新
- **doss-status**：查询机场和无人机实时状态（位置、速度、电量）
- **doss-fly**：飞行控制（takeoff / flyto / update / stop / home / estop / grab）
- **doss-camera**：相机控制与拍照
- **doss-mission**：任务管理（列表 / 创建 / 详情 / 事件 / 报告）
- **doss-monitor**：任务监控
- **doss-vision**：图像视觉分析（见下方说明）

## 执行前必查

每次飞行操作前，必须先调用 `doss-status` 确认：
1. 机场状态正常（modeCode = 0 空闲 或 4 作业中）
2. 无人机电量 ≥ 20%
3. 获取 dockCode（格式如 `DOCK-001`）

若电量 < 20%，拒绝执行飞行任务，提示用户先充电。

## 任务分段执行

复杂任务（多航点巡检）按节点拆分，每段自包含：

```
确认状态 → 下发飞行指令 → 轮询等待到达 → 执行当前节点操作 → 输出结论
```

### 到达检测方法

下发飞行指令后，每 10 秒调用一次 `doss-status`，同时满足以下条件视为到达：
- 速度 < 0.5 m/s
- 当前位置与目标点距离 < 5 米

最多等待 25 分钟（150 次轮询），超时则报错并建议用户检查网络或无人机状态。

## 高危操作确认规则

以下操作执行前必须先输出确认提示，等待用户明确回复"确认"后再执行：

| 操作 | 触发词 |
|---|---|
| estop（急停） | 急停、紧急停止、stop now |
| grab（抢夺控制权） | 抢夺、夺取控制 |
| drc（指令飞行模式） | DRC、指令飞行 |
| takeoff（起飞） | 起飞、takeoff |

确认提示格式：
```
即将执行【操作名称】
机场：{dockCode}
{关键参数}
请回复"确认"继续，或"取消"放弃。
```

## 遇到异常时的处理

遇到以下情况，停止当前操作并向用户说明，等待指示：
- API 返回非成功状态码
- 图像分析结论不确定（无法判断是否满足标准）
- 无人机状态异常（信号弱、GPS 丢失等）
- 用户描述的场景与实际状态不匹配

不要猜测继续，优先挂起并询问。

## 视觉分析说明（doss-vision）

调用 `doss-camera` 拍照获得图片 URL 后，直接将 URL 传给自己进行 Vision 分析。
参考 `doss-vision` Skill 的分析格式输出结构化结论。

## 输出格式

每次操作后输出简洁摘要：
- ✅ 操作成功 + 关键数据
- ⚠️ 操作异常 + 原因 + 建议
- ❓ 需要用户确认 + 具体问题
```

**步骤 3：验证目录结构**

```bash
ls groups/dossagent/
# 预期输出：CLAUDE.md
```

**步骤 4：提交**

```bash
git add groups/dossagent/CLAUDE.md
git commit -m "feat: add dossagent group with UAV system prompt"
```

---

### Task 2：验证 Phase 1 基础闭环

**前提：** NanoClaw 正在运行（`npm run dev`），DOSS Token 已登录（`doss-auth`）

**步骤 1：确认 dossagent 组已注册**

访问 `http://localhost:9080`，检查是否有 dossagent 对话组，或通过 API 发送消息：

```bash
curl -s -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "查询当前所有无人机状态"}' | jq .
```

**步骤 2：发送测试指令**

```bash
curl -s -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "查看所有无人机和机场状态"}' | jq .
```

预期：Agent 调用 `doss-status` 脚本，返回机场和无人机列表。

**步骤 3：验证高危确认流程**

```bash
curl -s -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "起飞，目标经度117.9438，纬度24.5576，高度50米"}' | jq .
```

预期：Agent 输出确认提示，不直接执行起飞。

---

## Phase 2：视觉感知 + 断点交互

### Task 3：创建 doss-vision Skill

**文件：**
- 新建：`container/skills/doss-vision/SKILL.md`

**步骤 1：创建目录**

```bash
mkdir -p container/skills/doss-vision
```

**步骤 2：写入 SKILL.md**

```markdown
---
name: doss-vision
description: |
  对无人机拍摄的图片进行视觉分析，输出结构化巡检结论。
  当需要分析无人机图传画面或拍摄图片时触发。
  依赖 doss-camera 提供的图片 URL。
---

# DOSS Vision 图像分析 Skill

## 使用方式

获得图片 URL 后，直接将其传入 Vision 分析，按以下格式输出结论。
无需额外脚本，Claude 原生处理图像内容。

## 输出格式（必须严格遵守）

```
【视觉分析结论】
目标可见性：[清晰 / 模糊 / 不可见]（说明原因）
检测到的异常：
  - [异常描述1] 或 无异常
  - [异常描述2]
是否满足作业标准：[是 / 否 / 不确定]
建议下一步：[继续下一航点 / 调整变焦 / 抵近拍摄 / 请求人工确认]
```

## 量化判断示例

| 场景 | 判断标准 | 建议 |
|---|---|---|
| 裂缝检测 | 裂缝占画面 ≥ 60% 视为清晰 | 清晰则记录，否则抵近 |
| 设备检查 | 目标设备完整出现在画面内 | 否则调整角度 |
| 火情识别 | 任何明火或烟雾即触发异常 | 立即请求人工确认 |
| 正常巡检 | 无明显异常，画面清晰 | 继续下一航点 |

## 触发 ask_user 的条件

遇到以下情况，停止分析并写入 ask_user IPC，等待用户指示：
- 目标可见性为"不可见"或"模糊"且无法自动调整
- 检测到高风险异常（火情、结构破损、人员入侵）
- 分析结论为"不确定"
```

**步骤 3：验证 Skill 自动 sync**

重启 NanoClaw（或等待热重载），检查 doss-vision 是否出现在容器 skills 目录：

```bash
ls data/sessions/dossagent/skills/ | grep doss-vision
```

**步骤 4：提交**

```bash
git add container/skills/doss-vision/SKILL.md
git commit -m "feat: add doss-vision skill for image analysis guidance"
```

---

### Task 4：扩展 IpcDeps 接口，新增 ask_user 支持

**文件：**
- 修改：`src/ipc.ts`

**步骤 1：写失败测试**

打开 `src/ipc.ts`，找到 `IpcDeps` interface（约第 13 行），确认当前字段列表。

在 `src/` 下找到 ipc 的测试文件：

```bash
ls src/*.test.ts | grep ipc
```

若无 ipc 专用测试，在 `src/ipc-auth.test.ts` 确认测试框架用法（vitest）。

新建测试文件 `src/ipc-ask-user.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 测试 ask_user IPC 文件被正确处理：
// 1. sendMessage 被调用，内容为 question
// 2. storeResumeContext 被调用，内容为 resume_context
describe('IPC ask_user', () => {
  it('处理 ask_user 文件：发送问题并存储 resume_context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
    const messagesDir = path.join(tmpDir, 'dossagent', 'messages');
    fs.mkdirSync(messagesDir, { recursive: true });

    const payload = {
      type: 'ask_user',
      chat_jid: 'api@nanoclaw',
      question: '是否需要抵近拍摄？',
      resume_context: '已完成路灯1/2，当前在路灯3上空。',
    };
    fs.writeFileSync(
      path.join(messagesDir, 'ask-001.json'),
      JSON.stringify(payload),
    );

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const storeResumeContext = vi.fn();

    const { startIpcWatcher } = await import('./ipc.js');
    startIpcWatcher({
      sendMessage,
      storeResumeContext,
      registeredGroups: () => ({
        'api@nanoclaw': { folder: 'dossagent', name: 'dossagent', isMain: false },
      }),
      registerGroup: vi.fn(),
      syncGroups: vi.fn(),
      getAvailableGroups: () => [],
      writeGroupsSnapshot: vi.fn(),
      onTasksChanged: vi.fn(),
      _ipcBaseDir: tmpDir, // 注入测试目录
    });

    // 等待轮询处理
    await new Promise((r) => setTimeout(r, 200));

    expect(sendMessage).toHaveBeenCalledWith('api@nanoclaw', '是否需要抵近拍摄？');
    expect(storeResumeContext).toHaveBeenCalledWith(
      'api@nanoclaw',
      '已完成路灯1/2，当前在路灯3上空。',
    );

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

**步骤 2：运行测试，确认失败**

```bash
npx vitest run src/ipc-ask-user.test.ts
# 预期：FAIL（storeResumeContext 不存在）
```

**步骤 3：修改 `src/ipc.ts`**

在 `IpcDeps` interface 末尾新增字段：

```typescript
// 在 onTasksChanged: () => void; 之后添加：
storeResumeContext: (chatJid: string, context: string) => void;
```

在 `processIpcFiles` 函数内，找到处理 `messages` 目录的 switch/if 块（约第 77 行），在现有 `type === 'message'` 处理之后添加 `ask_user` 分支：

```typescript
// 在 if (data.type === 'message' && ...) { ... } 块之后添加：
else if (data.type === 'ask_user' && data.chat_jid && data.question && data.resume_context) {
  const targetGroup = registeredGroups[data.chat_jid];
  if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
    deps.storeResumeContext(data.chat_jid, data.resume_context);
    await deps.sendMessage(data.chat_jid, data.question);
    logger.info(
      { chatJid: data.chat_jid, sourceGroup },
      'ask_user IPC processed',
    );
  } else {
    logger.warn(
      { chatJid: data.chat_jid, sourceGroup },
      'Unauthorized ask_user IPC attempt blocked',
    );
  }
}
```

**步骤 4：运行测试，确认通过**

```bash
npx vitest run src/ipc-ask-user.test.ts
# 预期：PASS
```

**步骤 5：运行全量测试，确认无回归**

```bash
npm run test
# 预期：全部 PASS
```

**步骤 6：提交**

```bash
git add src/ipc.ts src/ipc-ask-user.test.ts
git commit -m "feat: add ask_user IPC type for drone breakpoint interaction"
```

---

### Task 5：在 index.ts 中实现 resume_context 管理

**文件：**
- 修改：`src/index.ts`

**步骤 1：写失败测试**

在 `src/` 下找到与 index.ts 相关的集成测试，或在现有测试中验证行为。由于 index.ts 是主入口难以单元测试，通过类型检查验证接口完整性：

```bash
npm run typecheck
# 预期：FAIL（storeResumeContext 未在 startIpcWatcher 调用处实现）
```

**步骤 2：在 `src/index.ts` 模块级别添加 resumeContextMap**

找到 `let sessions: Record<string, string> = {};`（约第 74 行），在其附近添加：

```typescript
// 断点交互：存储挂起任务的 resume_context，key 为 chat_jid
const resumeContextMap = new Map<string, string>();
```

**步骤 3：在 startIpcWatcher 调用处补充 storeResumeContext**

找到 `startIpcWatcher({` 调用（约第 729 行），在 deps 对象内补充：

```typescript
storeResumeContext: (chatJid: string, context: string) => {
  resumeContextMap.set(chatJid, context);
  logger.info({ chatJid }, 'Resume context stored for breakpoint interaction');
},
```

**步骤 4：在 processGroupMessages 中注入 resume_context**

找到 `const prompt = formatMessages(missedMessages, TIMEZONE);`（约第 255 行），修改为：

```typescript
let prompt = formatMessages(missedMessages, TIMEZONE);

// 若该会话有挂起的 resume_context（断点交互），前置注入后清除
const resumeCtx = resumeContextMap.get(chatJid);
if (resumeCtx) {
  resumeContextMap.delete(chatJid);
  prompt = `[任务断点恢复]\n${resumeCtx}\n\n[用户回复]\n${prompt}`;
  logger.info({ chatJid }, 'Resume context injected into prompt');
}
```

**步骤 5：运行类型检查和全量测试**

```bash
npm run typecheck && npm run test
# 预期：全部通过
```

**步骤 6：提交**

```bash
git add src/index.ts
git commit -m "feat: implement resume_context map for drone breakpoint interaction"
```

---

### Task 6：端到端验证 Phase 2

**步骤 1：重启 NanoClaw**

```bash
# 如果用 dev 模式，热重载会自动生效
# 否则：
npm run build && npm start
```

**步骤 2：模拟完整拍照分析流程**

```bash
curl -s -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "飞到经度117.9438纬度24.5576高度50米，到达后拍照分析"}' | jq .
```

预期：Agent 确认起飞 → 用户回复"确认" → 飞行 → 拍照 → Vision 分析 → 输出结构化结论

**步骤 3：模拟断点交互**

在 Vision 分析输出"不确定"时，确认：
1. Agent 输出问题给用户
2. 用户回复后，Agent 带 resume_context 继续执行
3. 最终完成任务

**步骤 4：推送到 dossagent 仓库**

```bash
git push dossagent main
```

---

## 文件变更汇总

| 文件 | 操作 | Phase |
|---|---|---|
| `groups/dossagent/CLAUDE.md` | 新建 | 1 |
| `container/skills/doss-vision/SKILL.md` | 新建 | 2 |
| `src/ipc.ts` | 修改（+ask_user 处理，+IpcDeps 字段） | 2 |
| `src/ipc-ask-user.test.ts` | 新建 | 2 |
| `src/index.ts` | 修改（+resumeContextMap，+prompt 注入） | 2 |

**核心代码改动：约 50 行**（不含注释和空行）
