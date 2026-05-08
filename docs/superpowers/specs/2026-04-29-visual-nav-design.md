# DOSSAgent 视觉导航与目标跟踪设计文档

> 日期：2026-04-29
> 状态：已审批

## 1. 概述

为 DOSSAgent UAV Agent 新增视觉搜索抵近和视觉持续跟踪两个能力，基于现有 Qwen VLM + stickControl 组合方案，不依赖端到端 VLA 模型。

### 核心思路

- **VLM 即时决策**：每个控制循环抓帧 → VLM 分析目标位置 → 语义标签 → 控制指令
- **混合控制**：搜索阶段用 flyToPoint 粗定位，抵近阶段切 stickControl 精细调整
- **接口可切换**：VLM 调用抽象为独立模块，支持云端/本地切换

## 2. 两个核心场景

### 2.1 视觉搜索抵近 (`POST /api/visual-search`)

**输入**：`{ dockCode, targetLng, targetLat, targetHeight, instruction, maxSteps }`

**流程**：
1. Phase 1：flyToPoint 飞到大致区域，waitUntilArrived 等待到达
2. Phase 2：VLM 视觉搜索循环（最多 maxSteps 步）
   - 抓帧（前视相机）→ VLM 分析 → 决策
   - 未找到 + 低置信度 → 原地旋转 30° 搜索
   - 未找到 + 高置信度 → flyToPoint 飞向推测方向
   - 找到 + 距离 > 50m → flyToPoint 飞向 VLM 推算坐标
   - 找到 + 距离 <= 50m → stickControl 精细抵近
   - 找到 + 距离 <= 20m → 悬停拍照，返回成功

**终止条件**：目标找到且距离 < 20m / maxSteps 耗尽 / 卡住检测 / 用户中止

### 2.2 视觉持续跟踪 (`POST /api/visual-track`)

**输入**：`{ dockCode, instruction, keepDistance, keepHeight, maxDuration }`

**流程**：~1Hz 控制循环
- 抓帧 → VLM 分析目标水平/垂直偏移 + 距离 + 移动方向
- 语义标签 → stickControl 映射（确定性规则，非学习型）

| VLM 输出 | stick 动作 | 杆量值 |
|----------|-----------|--------|
| 偏右 | 右偏航 | +0.3 |
| 偏左 | 左偏航 | -0.3 |
| 太远 | 前进 | +0.5 |
| 太近 | 后退 | -0.3 |
| 偏上 | 升高 | +0.3 |
| 偏下 | 降低 | -0.3 |

**丢失恢复**：悬停 → 缓慢旋转搜索 → 连续 3 帧丢失 → 暂停通知用户

**终止条件**：maxDuration 耗尽 / 目标连续丢失 10s / 用户中止

## 3. 架构

```
NanoClaw Skill (doss-visual-nav)
    → HTTP → UAV Agent API (:8699)
              ├── routes/visual.js (4 个端点)
              ├── services/visual-nav-service.js (控制循环)
              ├── services/vlm-client.js (VLM 抽象层)
              ├── lib/frame-extractor.js (FFmpeg 抽帧)
              └── 复用: flight-service, uav-status, device-cache
```

## 4. API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/visual-search` | POST | 启动视觉搜索（异步，WS 推送） |
| `/api/visual-track` | POST | 启动视觉跟踪（异步，WS 推送） |
| `/api/visual-stop` | POST | 停止当前视觉任务 |
| `/api/visual-status` | GET | 查询当前视觉任务状态 |

### WebSocket 推送事件

```
visual_search_step  → { step, found, direction, distance, action }
visual_search_found → { step, distance, message }
visual_search_done  → { report }
visual_track_step   → { step, found, horizontal, vertical, sticks }
visual_track_lost   → { step, consecutiveLost }
visual_track_done   → { report }
```

## 5. VLM 客户端接口

### 两个专用方法

```javascript
// 搜索分析
vlmClient.searchTarget(frame, instruction)
→ { found, direction, distance, confidence, suggestion }

// 跟踪分析
vlmClient.trackTarget(frame, instruction)
→ { found, horizontal, vertical, distance, movingDirection }
```

**设计决策**：VLM 输出离散语义标签（left/center/right），不是像素坐标。
- VLM 对语义理解更准确，对精确坐标不够可靠
- 离散标签 → stickControl 映射是确定性的

### 后端切换

环境变量 `VLM_PROVIDER` 控制：`qwen`（默认）/ `local`（后续）/ `openai`（后续）

## 6. 新增文件清单

```
uav-agent/server/services/visual-nav-service.js   核心控制循环
uav-agent/server/services/vlm-client.js            VLM 调用抽象层
uav-agent/server/routes/visual.js                  4 个 API 端点
uav-agent/server/lib/frame-extractor.js            FFmpeg 抽帧封装
container/skills/doss-visual-nav/SKILL.md          NanoClaw Skill
container/skills/doss-visual-nav/scripts/doss_visual_nav.py  Skill 客户端
```

### 现有文件改动

- `uav-agent/server/index.js`：新增一行路由注册
- `.env`：新增 7 个环境变量

### 不改动

flight-service.js, uav-status.js, device-cache.js, simulate-config.js, llm-service.js 等全部复用不动

## 7. 环境变量

```bash
VLM_PROVIDER=qwen
VLM_BASE_URL=https://dashscope.aliyuncs.com
VLM_API_KEY=<复用 DASHSCOPE_API_KEY>
VLM_MODEL=qwen-vl-max
VLM_MAX_TOKENS=500
VISUAL_SEARCH_MAX_STEPS=50
VISUAL_TRACK_MAX_DURATION=300
VISUAL_ARRIVE_DIST=20
```

## 8. 依赖

- npm：无新增
- 系统：ffmpeg（视频抽帧）

## 9. NanoClaw Skill 触发词

| 用户说 | 执行 |
|--------|------|
| 飞过去找到那栋红色水塔 | visual-search --instruction "红色水塔" |
| 在这附近找一下有没有异常 | visual-search --instruction "异常物体" --nearby |
| 跟踪画面中穿红衣服的人 | visual-track --instruction "穿红衣服的人" |
| 停止跟踪 | visual-stop |
