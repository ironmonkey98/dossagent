/**
 * LLM 服务 - 调用大模型 API 将自然语言解析为飞控指令 JSON
 *
 * 支持：
 *   - 阿里云 (DashScope) - OpenAI 兼容格式
 *   - 智谱 (ChatGLM) - OpenAI 兼容格式
 *   - 自动 fallback：主模型失败切备用模型
 */
'use strict';

const axios = require('axios');
const { decodeApiKey, isApiKeyConfigured } = require('./apikey-helper');
const deviceCache = require('../lib/device-cache');

// ─── 飞控指令解析 Prompt ─────────────────────────────

const SYSTEM_PROMPT = `你是一个无人机飞控指令解析器。将用户的自然语言输入解析为结构化的飞控指令序列。

输出格式（严格 JSON 数组，不要输出任何其他文字）：
[
  {
    "cmd": "takeoffToPoint",
    "address": "软件园三期F06",
    "height": 120.0,
    "takeoffHeight": 120.0,
    "label": "起飞→软件园三期F06"
  }
]

可用指令及参数：
- takeoffToPoint: 起飞（需 address 或 longitude/latitude，需 height 目标高度默认120，可选 takeoffHeight 起飞高度默认与height相同）
- flyToPoint: 飞向目标（需 address 或 longitude/latitude，需 height，默认120）
- cameraLookAt: 云台对准目标（需 address 或 longitude/latitude，需 height 目标高度默认0）
- cameraPhotoTake: 拍照
- cameraModeSwitch: 切换相机传感器模式（需 cameraMode: "visible"=可见光 "ir"=红外热成像 "night_vision"=夜视模式）
- cameraRecordingStart: 开始录像
- cameraRecordingStop: 停止录像
- returnHome: 返航
- droneEmergencyStop: 急停
- flightAuthorityGrab: 抓取飞行控制权
- lightModeSet: 探照灯控制（需 lightMode: "on"=开 "off"=关 "strobe"=频闪）
- lightBrightnessSet: 亮度调节（需 brightness: 1-100）
- speakerTtsPlayStart: 喊话（需 text 文本内容，可选 voiceType 语音类型）
- gimbalReset: 云台回中（需 resetMode: "0"=回中 "1"=向下）
- cameraScreenDrag: 云台拖拽控制（需 screenX:0-1, screenY:0-1）
- flightTaskPause: 暂停飞行
- flightTaskRecovery: 恢复飞行

解析规则：
1. "起飞"用 takeoffToPoint，"飞到/飞向"用 flyToPoint
2. 从机场起飞飞到某地 = takeoffToPoint（包含起飞和飞行）
3. height 默认 120.0 米，用户指定则用用户值
4. "上升N米" = flyToPoint，height 在当前高度基础上加 N
5. "前进N米" = flyToPoint，保持当前高度，需换算坐标偏移
6. "切换红外/热成像" = cameraModeSwitch(cameraMode:"ir")，"切换可见光" = cameraModeSwitch(cameraMode:"visible")，"切换夜视" = cameraModeSwitch(cameraMode:"night_vision")
7. "云台对准/看向" = cameraLookAt（对准建筑）或 cameraScreenDrag（拖拽控制）
8. "云台回中" = gimbalReset(resetMode:"0")
9. "云台向下" = gimbalReset(resetMode:"1") 或 cameraScreenDrag(y:0.8)
10. "打开探照灯" = lightModeSet(lightMode:"on")，"关闭探照灯" = lightModeSet(lightMode:"off")，"频闪" = lightModeSet(lightMode:"strobe")
11. "喊话/广播" = speakerTtsPlayStart，text 取引号内内容
12. "开始录像" = cameraRecordingStart，"停止录像" = cameraRecordingStop
13. "返航" = returnHome（总是放在最后）
14. 地点不含市级地名时默认厦门市
15. 每个 action 必须有 cmd 和 label 字段
16. takeoffToPoint 后自动插入 flightAuthorityGrab（抓取飞行控制权），除非用户明确说了"抢控"
17. 只输出 JSON 数组，不要 markdown 代码块标记`;

// ─── 阿里云 (DashScope) 调用 ───────────────────────

async function callDashscope(userMessage, systemPrompt) {
  const apiKey = decodeApiKey(process.env.DASHSCOPE_API_KEY);
  const model  = process.env.DASHSCOPE_MODEL || 'qwen-plus';

  if (!apiKey || !isApiKeyConfigured(process.env.DASHSCOPE_API_KEY)) {
    throw new Error('阿里云 API Key 未配置');
  }

  const resp = await axios.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const content = resp.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('阿里云返回内容为空');
  return content;
}

// ─── 智谱 (ChatGLM) 调用 ────────────────────────────

async function callZhipu(userMessage, systemPrompt) {
  const apiKey = decodeApiKey(process.env.ZHIPU_API_KEY);
  const model  = process.env.ZHIPU_MODEL || 'glm-4-flash';

  if (!apiKey || !isApiKeyConfigured(process.env.ZHIPU_API_KEY)) {
    throw new Error('智谱 API Key 未配置');
  }

  const resp = await axios.post(
    process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 2000,  // 增加 token 限制以容纳推理内容+实际输出
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const message = resp.data?.choices?.[0]?.message;
  // glm-5 模型可能返回 reasoning_content，优先使用 content，如果没有则使用 reasoning_content
  const content = message?.content || message?.reasoning_content;
  if (!content) throw new Error('智谱返回内容为空');
  return content;
}

// ─── 解析 LLM 输出为 actions 数组 ────────────────────

function parseLlmOutput(raw) {
  // 去除可能的 markdown 代码块标记
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`LLM 输出无法解析为 JSON: ${text.substring(0, 200)}`);
  }

  // 如果返回的是对象包裹的数组（如 {actions: [...]}），提取数组
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    // 尝试常见的键名
    const keys = ['actions', 'steps', 'commands', 'result', 'data'];
    for (const key of keys) {
      if (Array.isArray(parsed[key])) {
        parsed = parsed[key];
        break;
      }
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM 输出不是 JSON 数组');
  }

  // 校验每个 action 必须有 cmd 字段
  for (const action of parsed) {
    if (!action.cmd) {
      throw new Error(`action 缺少 cmd 字段: ${JSON.stringify(action)}`);
    }
    if (!action.label) {
      action.label = action.cmd;
    }
  }

  return parsed;
}

// ─── 简易词对照表 ─────────────────────────────────────

/**
 * 预处理用户输入，将简易缩写展开为完整地址
 * 规则：独立的字母+数字编号（如 A01、F06、B02），前面没有具体地址前缀时，
 *       自动补上"软件园三期"
 */
function preprocessAliases(text) {
  if (!text) return text;
  // 匹配前面不是"软件园三期"、"软件园"、"厦门"等地点前缀的独立楼栋编号
  // 支持 F06、A01、B02、C12 等格式（1-2个字母 + 1-3位数字）
  return text.replace(
    /(?<![\u4e00-\u9fa5\w])([A-Za-z]{1,2}\d{1,3})(?![\u4e00-\u9fa5\w])/g,
    (match, code) => {
      // 检查前面是否有地点前缀，如果有就不替换
      const idx = text.indexOf(match);
      const prefix = text.substring(Math.max(0, idx - 6), idx);
      if (/软件园|三期|二期|一期/.test(prefix)) return match;
      return `软件园三期${code.toUpperCase()}`;
    }
  );
}

// ─── 构建设备上下文 ─────────────────────────────────────

function buildDeviceContext() {
  const cache = deviceCache.readCache();
  if (!cache || !cache.docks || cache.docks.length === 0) return '';

  let context = '\n\n当前已知机场和无人机：\n';
  for (const dock of cache.docks) {
    // 可用：机场在线+飞机空闲；在线：机场在线但飞机不空闲；离线：机场离线
    let statusStr;
    if (dock.available) {
      statusStr = '可用';
    } else if (dock.online === '1') {
      statusStr = '在线';
    } else {
      statusStr = '离线';
    }
    const zoneStr = dock.zoneName ? `${dock.zoneName}/` : '';
    const aircraftInfo = dock.aircraft
      ? ` → 无人机：${dock.aircraft.deviceName}（编号:${dock.aircraft.deviceCode}${dock.aircraft.online === '1' ? '，在线' : '，离线'}）`
      : ' → 无无人机';
    context += `- ${zoneStr}${dock.dockName}（${statusStr}）${aircraftInfo}\n`;
  }
  context += '\n字段说明：dockCode 是无人机编号（非机场编号），用于 cockpit API 调用。';
  context += '\n当用户提到具体机场或无人机名称时，在 action 中添加 dockCode 字段，值为该机场下对应无人机的编号。';
  context += '\n注意：只有状态为「可用」的机场才能起飞。';
  return context;
}

// ─── 主入口：解析自然语言 → 飞控 actions ──────────────

/**
 * 解析自然语言为飞控指令序列
 * @param {string} userMessage - 用户自然语言输入
 * @returns {Promise<{actions: Array, model: string, raw: string}>}
 */
async function parseNlpToActions(userMessage) {
  // 预处理：展开简易词缩写
  const expanded = preprocessAliases(userMessage);
  if (expanded !== userMessage) {
    console.log(`[别名展开] "${userMessage}" → "${expanded}"`);
  }

  // 构建包含设备信息的完整 system prompt
  const fullPrompt = SYSTEM_PROMPT + buildDeviceContext();

  const errors = [];

  // 1. 尝试阿里云
  try {
    const raw = await callDashscope(expanded, fullPrompt);
    const actions = parseLlmOutput(raw);
    return { actions, model: 'dashscope', raw };
  } catch (err) {
    errors.push(`阿里云: ${err.message}`);
  }

  // 2. fallback: 尝试智谱
  try {
    const raw = await callZhipu(expanded, fullPrompt);
    const actions = parseLlmOutput(raw);
    return { actions, model: 'zhipu', raw };
  } catch (err) {
    errors.push(`智谱: ${err.message}`);
  }

  throw new Error(`所有 LLM 模型均调用失败: ${errors.join('; ')}`);
}

module.exports = { parseNlpToActions, preprocessAliases, buildDeviceContext, SYSTEM_PROMPT };
