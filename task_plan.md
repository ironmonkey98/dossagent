# Task Plan: DOSSAgent 视觉导航与目标跟踪

## Goal
为 UAV Agent 新增视觉搜索抵近和视觉持续跟踪两个能力，基于现有 Qwen VLM + stickControl 组合方案，不依赖端到端 VLA 模型。

## Phases
- [x] Phase 1: 阅读设计文档，了解项目结构
- [x] Phase 2: 实现基础层（frame-extractor.js + vlm-client.js）
- [x] Phase 3: 实现核心层（visual-nav-service.js）
- [x] Phase 4: 实现 API 层（visual.js + index.js 修改 + .env）
- [x] Phase 5: 实现 NanoClaw Skill（SKILL.md + doss_visual_nav.py）
- [ ] Phase 6: 集成验证（语法检查通过，实际对接待补充）

## Key Questions
1. ✅ callCockpitApi 未导出 → 自包含实现，不修改 flight-service
2. ⏳ 视频流地址从哪里获取？→ 预留接口，需对接 DOSS 图传 API
3. ⏳ stickControl 的 API 参数格式？→ 按 cockpit API 约定 { yaw, pitch, throttle, roll }

## Decisions Made
- cockpit API 自包含：visual-nav-service 内部实现 httpRequest + callCockpitApi，不改动 flight-service.js
- VLM 语义标签：输出离散标签（left/center/right）而非像素坐标，映射到确定性 stickControl 值
- 双抽帧模式：FFmpeg RTSP 抽帧（主） + HTTP 截图（备），适应不同视频源

## Errors Encountered
- callCockpitApi 未导出：初始实现依赖 flightService.callCockpitApi，发现未导出后改为自包含
- 全部修复，6 个 JS 文件 + 1 个 Python 文件语法检查通过

## File Map
```
新增文件：
  uav-agent/server/lib/frame-extractor.js             ✅ 3.6KB
  uav-agent/server/services/vlm-client.js              ✅ 6.8KB
  uav-agent/server/services/visual-nav-service.js      ✅ 20.8KB
  uav-agent/server/routes/visual.js                    ✅ 5.2KB
  container/skills/doss-visual-nav/SKILL.md            ✅ 3.6KB
  container/skills/doss-visual-nav/scripts/doss_visual_nav.py ✅ 5.7KB

修改文件：
  uav-agent/server/index.js   +2行（visualRouter 注册）
  uav-agent/.env              +8行（7个视觉导航环境变量）

不动文件：
  flight-service.js, uav-status.js, device-cache.js, simulate-config.js, llm-service.js
```

## Status
**Phase 5 完成** — 所有代码已编写并通过语法检查，等待实际对接验证
