# DOSSAgent

**通过自然语言控制 DOSS 无人机，执行巡检、拍摄、识别等复杂任务。**

基于 [NanoClaw](https://github.com/qwibitai/nanoclaw) 运行时构建，将 Claude AI 与 DOSS 空地一体巡检平台深度集成，实现从"按固定工作流走"到"按意图自主工作"的升级。

---

## 核心能力

- **自然语言飞控** — 直接说"飞到A边坡检查"，无需配置航点或工作流
- **分段任务执行** — 复杂多航点任务自动拆解，每步可见、可介入
- **视觉感知** — 无人机拍照后自动调用 Claude Vision 分析，输出结构化结论
- **断点交互** — 遇到未预设情况自动挂起，向操作员提问确认后继续
- **安全分级** — 急停/抢夺控制权等高危操作强制二次确认

---

## 架构

```
操作员（Web / 车载Pad）
    ↓ 自然语言
Claude Agent（容器隔离运行）
    ├─ doss-status   查询无人机/机场实时状态
    ├─ doss-fly      飞行控制（起飞/飞向/返航/急停）
    ├─ doss-camera   相机控制与拍照
    ├─ doss-mission  任务管理
    └─ doss-vision   图像视觉分析
         ↓
    DOSS API（https://doss.xmrbi.com）
```

单 Node.js 进程，Claude Agent 运行在隔离容器中，通过 Python CLI 脚本调用 DOSS 平台接口。

---

## 快速开始

**前提条件：**
- Node.js 20+
- Docker 或 Apple Container（macOS）
- DOSS 平台账号

**启动：**

```bash
git clone https://github.com/ironmonkey98/dossagent.git
cd dossagent
npm install
npm run dev
```

**登录 DOSS：**

```bash
python3 container/skills/doss-auth/scripts/doss_auth.py <用户名> <密码>
```

**访问 Web 界面：**

打开 `http://localhost:9080`，在对话框中输入自然语言指令。

---

## 使用示例

```
查看所有无人机和机场当前状态

起飞，飞到经度117.9438纬度24.5576高度50米，拍照后返航

检查前方3盏路灯，拍照记录异常，完成后返航
```

---

## 安全说明

- 起飞、急停、抢夺控制权等操作均需操作员二次确认
- 飞行前自动检查电量（< 20% 拒绝执行）
- 所有操作输出摘要供确认
- DOSS 平台自身保留限高、限远、避障等硬件级保护

---

## 设计文档

- [系统设计](docs/superpowers/specs/2026-04-17-dossagent-design.md)
- [实现计划](docs/plans/2026-04-17-dossagent.md)

---

## License

MIT
