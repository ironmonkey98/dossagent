# UAVClaw 系统设计文档

> 基于北航 UAVClaw 论文的二次开发方案 —— 通用自然语言飞控平台
>
> 日期：2026-04-11
> 状态：Draft

## 1. 项目定位

### 1.1 目标

构建一个**通用自然语言飞控平台**，用户通过自然语言指令即可控制大疆无人机完成复杂任务（巡检、搜索、拍摄、侦察等），无需遥控器或航点编程。

### 1.2 核心约束

| 维度 | 决策 |
|---|---|
| 硬件平台 | 大疆无人机（通过上云 API 控制） |
| 部署方式 | 全云端部署（Agent / VLA / 大疆上云通信均在云端） |
| 架构模式 | Claude + MCP 直连大疆上云（方案 A） |
| 三层架构 | LLM（认知）+ MCP（连接）+ VLA（执行）一步到位 |

### 1.3 参考论文 & 开源项目

- UAVClaw 项目页：https://prince687028.github.io/UAV-Claw/
- UAV-Flow Colosseo (arXiv:2505.15725) — 北航团队 VLA 无人机基准
- AeroDuo (arXiv:2508.15232) — 双无人机协作 + Pilot-LLM
- AutoFly (arXiv:2602.09657) — 端到端 VLA 自主导航
- AerialVLA (arXiv:2603.14363) — 极简端到端 3-DoF 控制
- OpenVLA (https://github.com/openvla/openvla) — 开源 VLA 基座模型
- OpenClaw (https://github.com/openclaw/openclaw) — Agent 运行时参考架构

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    用户接口层                         │
│  Web UI / IM Bot (飞书/钉钉) / CLI                   │
│  输入：自然语言指令   输出：执行结果 + 媒体            │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               认知层 (Claude Agent)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ 任务规划器 │ │ 上下文记忆 │ │ 工具调度器 │             │
│  │(Task Plan)│ │(Memory)  │ │(MCP Call)│              │
│  └──────────┘ └──────────┘ └──────────┘              │
│  Claude API + System Prompt + MCP Client              │
└──────────────────────┬──────────────────────────────┘
                       │ MCP (JSON-RPC over HTTP/SSE)
┌──────────────────────▼──────────────────────────────┐
│              连接层 (MCP Server 集群)                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │大疆上云 MCP │ │视觉感知 MCP│ │ VLA MCP    │        │
│  │飞控/相机/航线│ │检测/分割/OCR│ │动作策略生成│        │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘        │
└────────┼──────────────┼──────────────┼────────────────┘
         │              │              │
┌────────▼──────────────▼──────────────▼────────────────┐
│                    执行层                               │
│  大疆上云 API ──────▶ 大疆无人机                        │
│  (MQTT/HTTPS)      (仅飞行执行 + 图传)                 │
│  VLA 推理服务 ────▶ 动作策略 → 飞控指令                  │
└───────────────────────────────────────────────────────┘
```

### 2.2 四层职责

| 层级 | 职责 | 技术选型 |
|---|---|---|
| 用户接口层 | 接收自然语言、展示结果 | FastAPI + WebSocket |
| 认知层 | 任务拆解、上下文推理、工具调度 | Claude API + MCP Client |
| 连接层 | 统一工具接口、协议适配 | MCP Server (FastMCP, HTTP/SSE) |
| 执行层 | 飞行执行、图传、VLA 推理 | 大疆上云 API + VLA GPU 推理 |

## 3. MCP 工具层详细设计

### 3.1 MCP Server 1：大疆上云飞控服务 (`dji-cloud-mcp-server`)

**技术栈**：Python + FastMCP + 大疆 Cloud API SDK

#### 工具清单

| 工具名 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `list_devices` | `{}` | `[{sn, model, status, battery, location}]` | 列出所有在线无人机 |
| `get_device_status` | `{sn}` | `{battery, gps, altitude, speed, flight_mode, ...}` | 实时遥测 |
| `takeoff` | `{sn, altitude}` | `{task_id, status}` | 起飞到指定高度 |
| `land` | `{sn}` | `{task_id, status}` | 降落 |
| `return_to_home` | `{sn}` | `{task_id, status}` | 返航 |
| `emergency_stop` | `{sn}` | `{status}` | 急停（最高优先级） |
| `fly_to_waypoint` | `{sn, lng, lat, alt, speed}` | `{task_id, status}` | 飞向指定坐标 |
| `fly_path` | `{sn, waypoints: [{lng,lat,alt}], speed}` | `{task_id, status}` | 多航点航线飞行 |
| `set_gimbal` | `{sn, pitch, yaw}` | `{status}` | 云台角度控制 |
| `take_photo` | `{sn, camera_type}` | `{image_url}` | 拍照并返回 URL |
| `start_recording` | `{sn}` | `{status}` | 开始录像 |
| `stop_recording` | `{sn}` | `{video_url}` | 停止录像返回 URL |
| `get_live_stream` | `{sn}` | `{stream_url}` | 获取直播流地址 |
| `get_task_status` | `{task_id}` | `{status, progress, result}` | 查询异步任务状态 |

#### 实现要点

- 底层调用大疆上云 API（MQTT 下发指令 + MQTT/HTTP 获取状态）
- 所有异步操作返回 `task_id`，配合 `get_task_status` 轮询
- 急停工具不带确认，Claude System Prompt 强制优先响应
- 飞行高度限制、禁飞区检查在工具内部校验

### 3.2 MCP Server 2：视觉感知服务 (`vision-perception-mcp-server`)

**技术栈**：Python + FastMCP + Claude Vision / GroundingDINO / SAM

#### 工具清单

| 工具名 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `analyze_image` | `{image_url, prompt}` | `{description}` | 用 VLM 描述图像内容 |
| `detect_objects` | `{image_url, classes?}` | `[{class, bbox, confidence}]` | 目标检测（GroundingDINO） |
| `segment_image` | `{image_url, prompt}` | `{mask_url, regions}` | 语义分割（SAM） |
| `ocr_image` | `{image_url}` | `{text, regions}` | 文字识别（如读标牌） |
| `compare_images` | `{url_before, url_after}` | `{differences}` | 前后对比（巡检场景） |

#### 实现要点

- 图片直接从大疆云存储 URL 获取，无需中转
- VLM（Claude Vision / GPT-4o）做图像理解
- GroundingDINO + SAM 做目标检测和分割
- 推理可 CPU/GPU 混合（VLM 用 API，检测用本地 GPU）

### 3.3 MCP Server 3：VLA 动作策略服务 (`vla-strategy-mcp-server`)

**技术栈**：Python + FastMCP + AerialVLA 推理引擎

#### 工具清单

| 工具名 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `plan_actions` | `{instruction, current_image_url?, context}` | `{action_sequence: [{action, params}]}` | 从自然语言生成动作序列 |
| `get_next_action` | `{instruction, current_image_url, state}` | `{action, params}` | 单步动作生成（闭环控制） |
| `evaluate_safety` | `{planned_action, current_image_url}` | `{safe: bool, risk_level, suggestion}` | 安全评估 |

#### 实现要点

- 封装 VLA 模型推理（AerialVVA / AutoFly）
- `plan_actions` 是开环模式（一次规划全部步骤）
- `get_next_action` 是闭环模式（每步观察后决策下一步）
- `evaluate_safety` 是安全检查门

### 3.4 MCP Server 部署规格

| Server | 计算资源 | 传输协议 |
|---|---|---|
| dji-cloud-mcp | 2 CPU / 4G RAM | HTTP + SSE |
| vision-perception-mcp | 4 CPU / 8G RAM (+ GPU for detection) | HTTP + SSE |
| vla-strategy-mcp | GPU 实例 (T4/A10) | HTTP + SSE |

## 4. VLA 集成方案

### 4.1 模型选型

| 模型 | 参数量 | 适合场景 | 推荐度 |
|---|---|---|---|
| AerialVLA | 基于 OpenVLA 7B | 端到端 3-DoF 控制，TravelUAV 数据适配 | 首选 |
| AutoFly | 自定义 VLA | 野外自主导航，带伪深度编码 | 备选 |
| 自建 VLA | 基于 OpenVLA 微调 | 针对大疆无人机特性定制 | 长期目标 |

**起步选择**：AerialVLA，已有开源代码（https://github.com/XuPeng23/AerialVLA），端到端 3-DoF 控制。

### 4.2 VLA 输出到飞控指令映射

VLA 模型输出 3-DoF 连续动作（前后/左右/上下 + 偏航），需映射为大疆上云 API 的航点偏移量：

```
VLA 输出                    大疆上云 API 指令
──────────                  ─────────────────
velocity_x (+1.0)    ──▶   fly_to_waypoint(前方 N 米)
velocity_y (-0.5)    ──▶   fly_to_waypoint(左方 M 米)
velocity_z (+0.3)    ──▶   调整高度 +3 米
yaw_rate (+0.2)      ──▶   set_gimbal(偏航调整)
land_signal (1)      ──▶   land()
```

映射策略：将 VLA 连续速度指令量化为航点偏移量，通过大疆上云 `fly_to_waypoint` 下发。

### 4.3 VLA 推理服务 API

```python
# FastAPI + GPU 推理服务
POST /v1/plan_actions
  Body: { instruction: str, image_url?: str, context?: dict }
  Response: { actions: [{type: str, params: dict}] }

POST /v1/next_action
  Body: { instruction: str, image_url: str, state: dict }
  Response: { action: {type: str, params: dict}, confidence: float }

GET /v1/health
  Response: { model_loaded: bool, gpu_memory: str, avg_latency_ms: float }
```

- GPU 实例部署（推荐 T4 16G 或 A10 24G）
- 模型加载时预热，推理延迟目标 < 500ms
- 通过 VLA MCP Server 包装为标准 MCP 工具

## 5. 数据流 & 典型场景

### 5.1 任务执行数据流（"巡检路灯"示例）

```
用户: "检查前方3盏路灯，拍照记录并返航"

Claude Agent 思考链:
  1. 解析任务 → [起飞 → 飞向路灯1 → 拍照 → 飞向路灯2 → 拍照 → 飞向路灯3 → 拍照 → 返航]
  2. list_devices → 获取在线无人机
  3. takeoff → 起飞到50米
  4. get_device_status → 确认起飞完成
  5. vision.analyze_image(直播帧, "找到路灯位置") → 获取路灯坐标
  6. fly_to_waypoint(路灯1坐标)
  7. take_photo → 获取图片URL
  8. vision.compare_images(基准图, 拍摄图) → 检查异常
  9. 重复 5-8 完成其余路灯
  10. return_to_home → 返航
  11. 汇总报告返回用户
```

### 5.2 VLA 闭环控制数据流（"穿梭树木并翻滚"）

```
用户: "依次右-左-右穿梭树木并翻滚"

Claude Agent → vla.plan_actions("右-左-右穿梭", context)
  → [右转飞行 → 左转飞行 → 右转飞行 → 翻滚]

循环每步:
  Claude → vla.get_next_action(instruction, current_frame, state)
    → {action: "turn_right", params: {angle: 30, speed: 5}}
  Claude → vla.evaluate_safety(action, frame)
    → {safe: true, risk: "low"}
  Claude → dji.fly_to_waypoint(translated_params)
  Claude → dji.get_device_status → 确认完成
  (下一步)
```

### 5.3 紧急停止数据流

```
用户: "停！" / "急停！"

Claude System Prompt 识别紧急指令 → 立即调用 dji.emergency_stop(sn)
  → 不经过任何安全评估，直接下发
  → 通知用户："已执行紧急停止，无人机悬停中"
```

## 6. 安全机制

### 6.1 三层防护体系

| 层级 | 机制 | 说明 |
|---|---|---|
| Agent 层 | System Prompt 约束 | 禁止低电量/信号弱时下发任务；强制每次飞前检查状态 |
| MCP 层 | 工具参数校验 | 飞行高度限制、禁飞区检查、电量阈值检查 |
| 执行层 | 大疆上云内置安全 | 大疆自身限高、限远、避障、低电返航等硬件级保护 |

### 6.2 关键安全规则

1. `emergency_stop` 优先级最高，System Prompt 标注 "ALWAYS execute immediately when user says 停/急停/停止"
2. 每次飞控操作前自动调用 `get_device_status`，电量 < 20% 拒绝执行并触发返航
3. VLA 生成的动作策略必须通过 `evaluate_safety` 评估后才执行
4. 所有飞控操作记录审计日志（操作人、时间、指令、结果）

## 7. 项目结构

```
uavagent/
├── README.md
├── docs/
│   └── superpowers/specs/2026-04-11-uavclaw-design.md
├── src/
│   ├── agent/                      # Claude Agent 配置
│   │   ├── system_prompt.py        # System Prompt 模板
│   │   └── mcp_config.json         # MCP Server 连接配置
│   ├── mcp_servers/                # MCP Server 集群
│   │   ├── dji_cloud/              # 大疆上云 MCP Server
│   │   │   ├── server.py
│   │   │   ├── dji_api_client.py   # 大疆上云 API 封装
│   │   │   └── tools.py
│   │   ├── vision/                 # 视觉感知 MCP Server
│   │   │   ├── server.py
│   │   │   ├── detectors.py        # GroundingDINO/SAM
│   │   │   └── tools.py
│   │   └── vla/                    # VLA 策略 MCP Server
│   │       ├── server.py
│   │       ├── model_loader.py     # AerialVLA 模型加载
│   │       └── tools.py
│   ├── vla_engine/                 # VLA 推理引擎
│   │   ├── inference.py
│   │   ├── action_mapper.py        # VLA动作→大疆指令映射
│   │   └── safety_checker.py
│   └── api/                        # 用户接口
│       ├── app.py                  # FastAPI 主应用
│       ├── routes/
│       └── websocket.py            # 实时状态推送
├── config/
│   ├── dji_cloud_config.yaml       # 大疆上云连接配置
│   ├── vla_config.yaml             # VLA 模型配置
│   └── safety_rules.yaml           # 安全规则配置
├── tests/
├── docker-compose.yml              # 一键部署
└── requirements.txt
```

## 8. 实施路线图

### Phase 1: 最小闭环（2 周）

- 搭建 `dji-cloud-mcp-server`：实现 `list_devices`, `takeoff`, `land`, `fly_to_waypoint`, `take_photo`, `return_to_home`
- 配置 Claude Agent：System Prompt + MCP 连接
- 基础 CLI 接口：通过命令行发送自然语言指令
- **验收**：通过自然语言完成"起飞 → 飞到某点 → 拍照 → 返航"

### Phase 2: 视觉感知集成（2 周）

- 实现 `vision-perception-mcp-server`：`analyze_image`, `detect_objects`
- 集成 Claude Vision 做图像理解
- **验收**：自然语言完成"飞到路灯 → 拍照 → 识别是否有损坏"

### Phase 3: VLA 集成（3 周）

- 部署 AerialVLA 推理服务
- 实现 `vla-strategy-mcp-server`：`plan_actions`, `get_next_action`, `evaluate_safety`
- 实现 `action_mapper`：VLA 输出 → 大疆航点指令
- **验收**：自然语言完成"穿梭障碍物并拍摄"

### Phase 4: 安全加固 + Web UI（2 周）

- 实现三层安全机制
- 添加审计日志
- Web UI 面板（任务状态、实时图传、操作日志）
- **验收**：完整的安全机制 + 可操作的 Web 界面

### Phase 5: 高级能力（持续）

- 多机协同（多无人机任务分配）
- 任务模板库（巡检/搜索/拍摄预设模板）
- IM Bot 集成（飞书/钉钉/微信）
- VLA 微调（基于大疆无人机数据定制）

## 9. 技术风险

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| 大疆上云 API 能力边界 | 无法做底层特技/精细控制 | 按大疆 API 能力设计工具，不承诺不支持的操作 |
| VLA 模型泛化性 | 模型在新场景表现差 | 先用 AerialVLA 验证，后期针对大疆数据微调 |
| 云端延迟 | 飞控响应 > 1s | 大疆上云自身有安全保护；非实时操控场景可接受 |
| Claude MCP 工具数量 | 工具过多影响推理质量 | 每个 MCP Server 保持 5-8 个核心工具 |
