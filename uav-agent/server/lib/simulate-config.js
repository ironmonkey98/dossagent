/**
 * 飞控指令配置常量
 *
 * 从 uav-nlp-control/scripts/simulate-executor.js 提取，
 * 包含指令延时、状态描述、中文名称、真实等待时间、飞行类指令集合等配置。
 */
'use strict';

// ─── 各指令模拟延时配置（毫秒）─────────────────────────────────────────────

const CMD_DELAYS = {
  takeoffToPoint:       3000,  // 起飞爬升中...
  flyToPoint:           3000,  // 飞行中...
  cameraLookAt:         1500,  // 云台转向中...
  cameraPhotoTake:      1000,  // 快门...
  cameraRecordingStart: 500,   // 开始录像
  cameraRecordingStop:  500,   // 停止录像
  returnHome:           3000,  // 返航中...
  droneEmergencyStop:   500,   // 急停
  flightTaskPause:      500,   // 暂停
  flightTaskRecovery:   500,   // 恢复
  flightAuthorityGrab:  500,   // 抢控
  lightModeSet:         500,   // 灯光控制
  speakerTtsPlayStart:  1500,  // TTS 播报
  _default:             1000,
};

// ─── 各指令模拟状态描述 ────────────────────────────────────────────────────

const CMD_STATUS = {
  takeoffToPoint:       '🛫 无人机正在起飞，爬升至目标高度...',
  flyToPoint:           '✈️  无人机飞行中，正在前往目标坐标...',
  cameraLookAt:         '🎥 云台转向目标点中...',
  cameraPhotoTake:      '📷 快门触发，图片已存储至机载存储...',
  cameraRecordingStart: '🔴 录像已开始...',
  cameraRecordingStop:  '⏹️  录像已停止...',
  returnHome:           '🏠 无人机已收到返航指令，正在飞回机场...',
  droneEmergencyStop:   '🛑 急停指令已执行，无人机悬停中...',
  flightTaskPause:      '⏸️  飞行任务已暂停...',
  flightTaskRecovery:   '▶️  飞行任务已恢复...',
  flightAuthorityGrab:  '🔑 已抢夺飞行控制权...',
  lightModeSet:         '💡 探照灯状态已切换...',
  speakerTtsPlayStart:  '📢 喊话器正在播报...',
  gimbalReset:          '🔄 云台已回中...',
  cameraScreenDrag:     '📱 云台拖拽控制中...',
  _default:             '⚙️  指令执行中...',
};

// ─── 指令中文名称表 ───────────────────────────────────────────

const CMD_NAMES = {
  takeoffToPoint:       '起飞/一键起飞',
  flyToPoint:           '飞向目标点',
  flyToPointUpdate:     '更新飞向目标',
  flyToPointStop:       '停止飞行',
  cameraLookAt:         '云台对准目标',
  cameraPhotoTake:      '拍照',
  cameraRecordingStart: '开始录像',
  cameraRecordingStop:  '停止录像',
  returnHome:           '返航',
  droneEmergencyStop:   '紧急急停',
  flightTaskPause:      '暂停飞行',
  flightTaskRecovery:   '恢复飞行',
  flightAuthorityGrab:  '抓取飞行控制权',
  payloadAuthorityGrab: '抓取负载控制权',
  lightModeSet:         '探照灯控制',
  lightBrightnessSet:   '探照灯亮度调节',
  speakerTtsPlayStart:  '喊话器播报',
  speakerPlayStop:      '喊话器停止',
  gimbalReset:          '云台复位',
  cameraScreenDrag:     '云台拖拽控制',
  cameraModeSwitch:     '相机模式切换',
  _default:             '执行指令',
};

// ─── 真实飞控等待时间配置（毫秒）────────────────────────────────────────────
// 指令发出后等待无人机真正完成该动作所需的时间
// 可在动作 JSON 中通过 waitSec 字段覆盖（优先级：action.waitSec > REAL_WAIT_MS > 0）
const REAL_WAIT_MS = {
  takeoffToPoint:       30000,  // 起飞爬升至目标高度，约30秒
  flyToPoint:           30000,  // 飞向目标点，根据距离不同，默认30秒
  flyToPointUpdate:     10000,  // 更新目标点，等待调整
  cameraLookAt:          5000,  // 云台转向目标，约5秒
  gimbalReset:           3000,  // 云台回中，约3秒
  cameraScreenDrag:      3000,  // 云台拖拽，约3秒
  cameraModeSwitch:      2000,  // 相机模式切换，约2秒
  cameraPhotoTake:       5000,  // 拍照（含快门+存储），约5秒
  cameraRecordingStart:  3000,  // 开始录像确认，约3秒
  cameraRecordingStop:   3000,  // 停止录像并保存，约3秒
  speakerTtsPlayStart:   5000,  // TTS播报完成（约5秒，视文本长度）
  lightModeSet:          2000,  // 探照灯切换，约2秒
  lightBrightnessSet:    1000,  // 亮度调节，约1秒
  flightAuthorityGrab:   2000,  // 抢控确认，约2秒
  payloadAuthorityGrab:  2000,  // 负载抢控，约2秒
  flightTaskPause:       3000,  // 暂停飞行，约3秒
  flightTaskRecovery:    3000,  // 恢复飞行，约3秒
  returnHome:           30000,  // 返航，需等待到达机场（长任务，默认30秒提示后不阻塞）
  droneEmergencyStop:    2000,  // 急停响应，约2秒
  _default:              3000,  // 其他指令默认等待3秒
};

// ─── 需要等待飞机真正到达才能继续的飞行类指令 ──────────────────────────────
// 这些指令会发出飞行目标，需通过 WebSocket 实时状态轮询确认飞机真正到达（速度归零+高度一致）
// 而不是依赖固定的 waitSec 秒数
const FLIGHT_MOVE_CMDS = new Set([
  'takeoffToPoint',
  'flyToPoint',
  'flyToPointUpdate',
]);

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  CMD_DELAYS,
  CMD_STATUS,
  CMD_NAMES,
  REAL_WAIT_MS,
  FLIGHT_MOVE_CMDS,
  sleep,
};
