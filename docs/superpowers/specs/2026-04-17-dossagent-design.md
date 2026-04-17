# DOSSAgent 设计文档

> 基于 NanoClaw 架构的无人机具身智能体实现方案
>
> 日期：2026-04-17
> 状态：Draft

## 1. 背景与目标

### 1.1 目标

在现有 NanoClaw 运行时基础上，扩展出无人机具身智能体能力，使操作员通过自然语言即可控制 DOSS 平台无人机完成复杂巡检任务，无需手动操作飞控面板或配置工作流。

### 1.2 现状盘点

以下容器 Skill 已完成，调用真实 DOSS API（`https://doss.xmrbi.com/xmrbi-onecas/uav/cockpit`）：

| Skill | 能力 |
|---|---|
| `doss-auth` | Token 登录与缓存 |
| `doss-fly` | takeoff / flyto / update / stop / home / estop / grab / drc |
| `doss-status` | 机场与无人机实时状态（含位置、速度、电量） |
| `doss-mission` | 任务列表 / 创建 / 详情 / 事件 / 飞行报告 |
| `doss-camera` | 相机控制与拍照 |
| `doss-monitor` | 任务监控 |

**缺失的能力：**
1. 无人机 Agent System Prompt（`groups/dossagent/CLAUDE.md`）
2. 断点交互机制（`ask_user` IPC 类型）
3. 视觉感知 Skill（`doss-vision`）
4. 容器超时配置适配

### 1.3 不在范围内

- VLA（AerialVLA）：DOSS 自带飞控，无需低层速度控制
- MCP Server：Python CLI 脚本已满足工具调用需求
- 语音输入：Phase 1 仅文本，语音为后续阶段
- 多无人机协同：Phase 1 单机单任务

---

## 2. 架构设计

### 2.1 整体消息流

```
用户（车载Pad/Web Frontend）
    ↓ 自然语言指令
NanoClaw API Channel（port 3080）
    ↓
GroupQueue → container-runner
    ↓ 挂载 doss-* skills（只读）
Docker 容器（Claude Agent SDK）
    ├─ groups/dossagent/CLAUDE.md      ← System Prompt
    ├─ container/skills/doss-fly/
    ├─ container/skills/doss-status/
    ├─ container/skills/doss-camera/
    ├─ container/skills/doss-mission/
    ├─ container/skills/doss-monitor/
    └─ container/skills/doss-vision/   ← 新增
         ↓ 执行 Python 脚本
        DOSS API
         ↓ 完成 or 需要询问
        IPC drop（data/ipc/）
             ├─ 正常完成 → 结果返回用户
             └─ ask_user → NanoClaw 转发问题 → 等回复 → 带答案重启容器
```

### 2.2 改动清单

| 文件 | 类型 | 改动内容 | 估算行数 |
|---|---|---|---|
| `src/ipc.ts` | 修改 | 新增 `ask_user` IPC 类型处理逻辑 | ~30 行 |
| `src/index.ts` | 修改 | 挂起任务 resume_context 管理；用户回复时带 context 重启容器 | ~40 行 |
| `src/config.ts` | 修改 | `CONTAINER_TIMEOUT` 改为 1800000ms（30 分钟） | 1 行 |
| `src/container-runner.ts` | 修改 | 将 `doss-vision/` 目录挂载进容器（与其他 doss-* skill 一致） | ~5 行 |
| `groups/dossagent/CLAUDE.md` | 新建 | 无人机 Agent System Prompt | — |
| `container/skills/doss-vision/SKILL.md` | 新建 | Vision 分析指导格式（仅 prompt，无可执行脚本） | — |

**NanoClaw 核心改动约 76 行，其余为新建文件。**

---

## 3. 任务执行模型

### 3.1 分段执行

每个关键节点是一次独立容器调用。容器自包含"执行指令 + 等待完成 + 分析结果"，完成后退出。

**示例：巡检3盏路灯**

```
[Segment 1] 起飞确认
  Claude 输出："即将起飞至50米，机场 DOCK001，确认吗？"
  用户："确认"
  → 新容器：doss-fly takeoff

[Segment 2] 飞向路灯1 + 拍照分析
  doss-fly flyto → 轮询 doss-status 等到达 → doss-camera 拍照
  → Claude Vision 分析 → 输出结论

[Segment 3] 飞向路灯2 + 拍照分析
  （同 Segment 2）

[Segment 4] 飞向路灯3 + 拍照分析
  → 发现异常 → write ask_user IPC → 挂起
  → 用户确认 → 带 resume_context 重启容器 → 继续执行

[Segment 5] 返航 + 汇总报告
  doss-fly home → 输出完整巡检报告
```

### 3.2 到达检测（轮询逻辑）

容器内每 10 秒调用 `doss-status`，同时满足以下条件视为到达：
- 当前速度 ≈ 0（< 0.5 m/s）
- 当前位置与目标点距离 < 5 米

### 3.3 断点交互机制（混合模式）

**A. 高危操作确认（无状态）**

```
Claude 识别高危操作（estop / grab / drc）
    ↓
容器输出确认提示，正常退出
    ↓
用户回复"确认"
    ↓
新容器：执行带 --confirm 的命令
```

**B. 任务挂起（有状态）**

```
容器遇到未预设场景（异常/不确定情况）
    ↓
写 IPC 文件：
{
  "type": "ask_user",
  "chat_jid": "<group_jid>",
  "question": "发现裂缝但画面不清晰，是否抵近拍摄？",
  "resume_context": "已完成路灯1/2，当前在路灯3上空80米。抵近需下降至20米。"
}
    ↓
NanoClaw ipc.ts 处理：
  - 发问题给用户
  - 将 resume_context 存入内存 Map（key: chat_jid）
    ↓
用户回复
    ↓
index.ts 检测到该 chat_jid 有挂起的 resume_context
  - 将用户回复 + resume_context 拼入 prompt
  - 重启容器，从断点继续
```

**状态存储**：内存 Map（`Map<chat_jid, string>`），进程重启清空，满足"同会话内恢复"需求。进程意外重启后挂起任务丢失，用户收到"任务已中断，请重新下达指令"提示。后续可持久化至 SQLite（`src/db.ts`），当前阶段不做。

**`ask_user` IPC 文件 Schema：**

```typescript
interface AskUserIpc {
  type: 'ask_user';
  chat_jid: string;        // 必填，目标会话 JID
  question: string;        // 必填，向用户展示的问题
  resume_context: string;  // 必填，任务状态摘要，拼入下次容器 prompt
}
```

---

## 4. 视觉感知设计

### 4.1 工作原理

容器内的 Claude Agent SDK 原生支持 Vision——直接将图片 URL 传给 Claude 即可，Vision 分析由 Claude 原生处理，无需额外 Python 脚本。`doss-vision` 仅提供分析指导 prompt（SKILL.md），不包含可执行脚本。

### 4.2 `doss-vision/SKILL.md` 内容结构

- 分析维度：目标可见性、检测到的异常、是否满足作业标准、建议下一步
- 量化判断示例（用于指导 Claude 做出一致的判断）
- 触发 `ask_user` 的条件（画面不清晰、发现异常、不确定情况）

### 4.3 单段完整执行流

```
1. doss-status → 确认机场状态和 dockCode
2. doss-fly flyto → 下发飞行指令
3. 轮询 doss-status → 等待到达
4. doss-camera take_photo → 获取图片 URL
5. Claude Vision 分析（依据 doss-vision SKILL.md）
6a. 结论满足标准 → 正常退出，输出结论
6b. 结论不满足  → 写 ask_user IPC，挂起
```

---

## 5. 安全机制

### 5.1 三层防护

| 层级 | 机制 |
|---|---|
| System Prompt 层 | 强制飞前检查状态；电量 < 20% 拒绝飞行任务；estop/grab/drc 必须二次确认 |
| Skill 层 | Python 脚本内 `--confirm` 标志；危险操作无 confirm 则退出不执行 |
| DOSS 平台层 | 大疆/DOSS 自身的限高、限远、避障、低电返航等硬件级保护 |

### 5.2 关键规则（写入 System Prompt）

1. 每次飞行操作前调用 `doss-status` 确认电量和状态
2. `estop` / `grab` / `drc` 必须用户二次确认，禁止自动执行
3. 遇到不确定情况（画面异常、API 报错、状态异常）优先挂起而非猜测继续
4. 任何操作输出操作摘要供用户确认

---

## 6. 项目结构变化

```
nanoclaw/
├── groups/
│   └── dossagent/
│       └── CLAUDE.md              ← 新建：无人机 Agent System Prompt
├── container/skills/
│   ├── doss-auth/                 ← 已有
│   ├── doss-fly/                  ← 已有
│   ├── doss-status/               ← 已有
│   ├── doss-camera/               ← 已有
│   ├── doss-mission/              ← 已有
│   ├── doss-monitor/              ← 已有
│   └── doss-vision/               ← 新建
│       └── SKILL.md
└── src/
    ├── ipc.ts                     ← 修改：ask_user 类型
    ├── index.ts                   ← 修改：resume_context 管理
    └── config.ts                  ← 修改：CONTAINER_TIMEOUT
```

---

## 7. 实施路线图

### Phase 1：最小闭环（当前目标）

**验收标准**：通过自然语言完成"起飞 → 飞到目标点 → 拍照 → 返航"，包含高危操作二次确认

交付物：
- [ ] `groups/dossagent/CLAUDE.md`
- [ ] `src/config.ts` 调整超时（30 分钟）
- [ ] `src/container-runner.ts` 挂载 doss-vision 目录

### Phase 2：视觉感知 + 断点交互（Phase 1 通过后）

**验收标准**：飞到目标点后自动拍照分析，遇到异常能挂起并向用户确认

交付物：
- [ ] `container/skills/doss-vision/SKILL.md`
- [ ] `src/ipc.ts` 新增 `ask_user`
- [ ] `src/index.ts` 新增 resume_context 管理

### Phase 3：复杂任务编排（Phase 2 通过后）

**验收标准**：通过自然语言完成多航点巡检，输出结构化报告

---

## 8. 风险

| 风险 | 缓解策略 |
|---|---|
| DOSS Token 过期（默认24h） | doss-auth 每次任务前检查并刷新 |
| 容器轮询超时（飞行 > 30min） | Phase 1 限制单段飞行距离；后续可调整超时 |
| Vision 分析结论不一致 | doss-vision SKILL.md 提供量化示例锚定判断标准 |
| 网络延迟导致状态不准 | 到达检测设 5 米容差 + 速度双重判断 |
| NanoClaw 进程重启导致挂起任务丢失 | 用户收到"任务已中断"提示，需重新下达指令；后续可持久化至 SQLite |
