# DOSSAgent

**AI 驱动的无人机智能控制平台 — 用自然语言操控 DOSS 无人机，执行巡检、拍摄、识别等复杂任务。**

基于 [NanoClaw](https://github.com/qwibitai/nanoclaw) 运行时构建，将 Claude AI 与 DOSS 空地一体巡检平台深度集成，实现从"按固定工作流走"到"按意图自主工作"的升级。

---

## 核心能力

| 能力 | 说明 |
|------|------|
| **自然语言飞控** | 说"飞到A边坡检查"，无需配置航点或工作流 |
| **分段任务执行** | 复杂多航点任务自动拆解，每步可见、可介入 |
| **视觉感知** | 拍照后自动调用 Claude Vision 分析，输出结构化结论 |
| **视觉导航** | 基于实时图像的自主导航，识别并飞向目标 |
| **断点交互** | 遇到未预设情况自动挂起，向操作员提问确认后继续 |
| **三层安全防护** | 输入清洗 → 输出过滤 → IPC 分级管控，防止机密泄露和危险操作 |
| **多渠道接入** | Web 界面、API、WhatsApp、Telegram、Slack 均可作为控制端 |

---

## 架构

```
操作员（Web / 车载 Pad / 即时通讯）
         ↓ 自然语言
    ┌─────────────────────────────────────────┐
    │  DOSSAgent Orchestrator (Node.js)       │
    │  ├─ GroupQueue     消息队列               │
    │  ├─ Safety Guard   三层安全管道            │
    │  ├─ Task Scheduler 定时任务调度            │
    │  └─ Sender ACL     发送者白名单            │
    └──────────────┬──────────────────────────┘
                   ↓ 容器隔离
    ┌─────────────────────────────────────────┐
    │  Claude Agent (容器内)                   │
    │  ├─ doss-status    查询无人机/机场实时状态   │
    │  ├─ doss-fly       飞行控制               │
    │  ├─ doss-camera    相机控制与拍照           │
    │  ├─ doss-mission   任务管理               │
    │  ├─ doss-vision    图像视觉分析            │
    │  ├─ doss-visual-nav 视觉导航              │
    │  ├─ doss-route     航线规划               │
    │  ├─ doss-auth      认证管理               │
    │  └─ doss-monitor   设备监控               │
    └──────────────┬──────────────────────────┘
                   ↓ HTTPS
            DOSS API (doss.xmrbi.com)
```

---

## 快速开始

### 前提条件

- Node.js 20+
- Docker 或 Apple Container（macOS）
- DOSS 平台账号

### 安装与启动

```bash
git clone https://github.com/ironmonkey98/dossagent.git
cd dossagent
npm install
npm run dev
```

### 登录 DOSS

```bash
python3 container/skills/doss-auth/scripts/doss_auth.py <用户名> <密码>
```

### 访问 Web 界面

打开 `http://localhost:9080`，在对话框中输入自然语言指令。

---

## 使用示例

```
查看所有无人机和机场当前状态

起飞，飞到经度117.9438纬度24.5576高度50米，拍照后返航

检查前方3盏路灯，拍照记录异常，完成后返航

用视觉导航飞到那座信号塔附近，距离保持20米
```

---

## 安全体系

DOSSAgent 采用三层安全管道，贯穿从消息输入到操作执行的完整链路：

```
输入消息 → [Input Sanitize] → Agent 处理 → [Output Guard] → 容器输出
                                                           → [IPC Guard]  → 操作执行
```

| 层级 | 组件 | 职责 |
|------|------|------|
| 第一层 | **Input Sanitize** | 剥离零宽字符、ANSI 转义序列等注入攻击 |
| 第二层 | **Output Guard** | 扫描 API key / token / password，过滤内部路径和零宽 Unicode |
| 第三层 | **IPC Guard** | 动作风险分级（safe / risky / dangerous），危险操作强制二次确认 |

所有安全决策记录到 `audit_logs` 表，支持事后审计。

---

## UAV Agent 子模块

`uav-agent/` 提供独立的无人机控制服务：

- **Server**（Express）— 设备管理、飞行控制、语音识别、视觉导航、LLM 指令解析
- **Web**（Vue.js）— 可视化操控面板，支持语音输入和实时状态展示

---

## 配置

通过 `.env` 文件配置，主要变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_PORT` | `3080` | API HTTP 端口 |
| `FRONTEND_PORT` | `9080` | Web 前端端口 |
| `CONTAINER_IMAGE` | `nanoclaw-agent:latest` | 容器镜像 |
| `CONTAINER_TIMEOUT` | `1800000` | 容器最大运行时间（ms） |
| `MAX_CONCURRENT_CONTAINERS` | `5` | 并发容器数上限 |
| `CONTAINER_MEMORY_LIMIT` | `512m` | 容器内存上限 |

完整变量列表见 [CLAUDE.md](CLAUDE.md)。

---

## 开发

```bash
npm run build        # 编译 TypeScript
npm run test         # 运行测试（Vitest）
npm run test:watch   # 监听模式
npm run typecheck    # 类型检查
npm run lint         # ESLint
npm run format       # Prettier 格式化
```

单文件测试：`npx vitest run src/group-queue.test.ts`

---

## 设计文档

- [系统设计](docs/superpowers/specs/2026-04-17-dossagent-design.md)
- [实现计划](docs/plans/2026-04-17-dossagent.md)
- [视觉导航设计](docs/superpowers/specs/2026-04-29-visual-nav-design.md)
- [安全防护系统](docs/plans/2026-05-08-safety-guard-system.md)

---

## License

MIT
