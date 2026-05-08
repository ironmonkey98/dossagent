/**
 * VLM 客户端 — 视觉语言模型调用抽象层
 *
 * 提供 searchTarget / trackTarget 两个专用方法，
 * 输出离散语义标签（非像素坐标），映射到确定性 stickControl 动作。
 *
 * 后端切换：VLM_PROVIDER 环境变量控制（qwen/local/openai）
 */
'use strict';

const axios = require('axios');

const VLM_PROVIDER = process.env.VLM_PROVIDER || 'qwen';
const VLM_BASE_URL = process.env.VLM_BASE_URL || 'https://dashscope.aliyuncs.com';
const VLM_API_KEY  = process.env.VLM_API_KEY  || process.env.DASHSCOPE_API_KEY || '';
const VLM_MODEL    = process.env.VLM_MODEL    || 'qwen-vl-max';
const VLM_MAX_TOKENS = parseInt(process.env.VLM_MAX_TOKENS, 10) || 500;

// ─── 搜索分析 Prompt ─────────────────────────────────

const SEARCH_SYSTEM_PROMPT = `你是无人机视觉搜索分析系统。分析当前画面，判断目标是否可见。
严格按 JSON 格式输出，不要添加任何其他文字：
{
  "found": true/false,
  "direction": "left" | "center" | "right" | "unknown",
  "distance": "very_close" | "close" | "medium" | "far" | "unknown",
  "confidence": 0.0-1.0,
  "suggestion": "一句话描述建议的下一步动作"
}

距离判断参考：
- very_close: 目标在画面中很大，距离 < 20m
- close: 目标清晰可见，距离 20-50m
- medium: 目标可辨识，距离 50-200m
- far: 目标很小但可识别，距离 > 200m
- unknown: 未找到目标时

方向判断：目标在画面中的水平位置
- left: 画面左侧 1/3
- center: 画面中间 1/3
- right: 画面右侧 1/3`;

// ─── 跟踪分析 Prompt ─────────────────────────────────

const TRACK_SYSTEM_PROMPT = `你是无人机视觉目标跟踪系统。分析当前画面中目标的位置和状态。
严格按 JSON 格式输出，不要添加任何其他文字：
{
  "found": true/false,
  "horizontal": "left" | "center" | "right",
  "vertical": "up" | "center" | "down",
  "distance": "too_close" | "good" | "too_far",
  "movingDirection": "left" | "right" | "toward" | "away" | "stationary" | "unknown"
}

判断标准：
- horizontal: 目标在画面中的水平位置
  - left: 需要左偏航让目标居中
  - right: 需要右偏航让目标居中
  - center: 目标已居中
- vertical: 目标在画面中的垂直位置
  - up: 目标偏上，需要升高
  - down: 目标偏下，需要降低
  - center: 目标高度合适
- distance:
  - too_close: 目标太大，需要后退（< keepDistance）
  - good: 距离合适（≈ keepDistance）
  - too_far: 目标太小，需要前进（> keepDistance）`;

// ─── 通用 VLM 调用 ───────────────────────────────────

/**
 * 调用 VLM API（OpenAI 兼容格式）
 * @param {string} imageBase64 - base64 编码的图像
 * @param {string} systemPrompt - 系统提示词
 * @param {string} instruction - 用户指令（如"红色水塔"）
 * @returns {Promise<object>} VLM 原始文本输出
 */
async function callVlmApi(imageBase64, systemPrompt, instruction) {
  const imageUrl = `data:image/jpeg;base64,${imageBase64}`;

  // 构建请求体（OpenAI vision 格式）
  const payload = {
    model: VLM_MODEL,
    max_tokens: VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: instruction },
        ],
      },
    ],
  };

  let url, headers;

  switch (VLM_PROVIDER) {
    case 'qwen':
      // 阿里云 DashScope OpenAI 兼容格式（base_url 已含 /compatible-mode/v1）
      url = `${VLM_BASE_URL}/chat/completions`;
      headers = {
        'Authorization': `Bearer ${VLM_API_KEY}`,
        'Content-Type': 'application/json',
      };
      break;

    case 'openai':
      url = `${VLM_BASE_URL}/v1/chat/completions`;
      headers = {
        'Authorization': `Bearer ${VLM_API_KEY}`,
        'Content-Type': 'application/json',
      };
      break;

    case 'local':
      // 本地 VLM 服务（预留）
      url = `${VLM_BASE_URL}/v1/chat/completions`;
      headers = { 'Content-Type': 'application/json' };
      break;

    default:
      throw new Error(`不支持的 VLM_PROVIDER: ${VLM_PROVIDER}`);
  }

  const resp = await axios.post(url, payload, {
    headers,
    timeout: 15000,
  });

  const content = resp.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('VLM 返回内容为空');
  return content;
}

// ─── 输出解析 ────────────────────────────────────────

/**
 * 解析 VLM 输出为结构化 JSON
 * 容错处理：提取 JSON 块、去除 markdown 标记
 */
function parseVlmOutput(raw) {
  let text = raw.trim();
  // 去除 markdown 代码块
  if (text.includes('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(text);
  } catch {
    // 尝试提取第一个 JSON 对象
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error(`VLM 输出无法解析: ${text.substring(0, 200)}`);
  }
}

// ─── 公开方法 ────────────────────────────────────────

/**
 * 搜索目标分析
 * @param {string} imageBase64 - base64 图像
 * @param {string} instruction - 目标描述（如"红色水塔"）
 * @returns {Promise<{found, direction, distance, confidence, suggestion}>}
 */
async function searchTarget(imageBase64, instruction) {
  const raw = await callVlmApi(imageBase64, SEARCH_SYSTEM_PROMPT, `搜索目标：${instruction}`);
  const parsed = parseVlmOutput(raw);
  return {
    found: !!parsed.found,
    direction: parsed.direction || 'unknown',
    distance: parsed.distance || 'unknown',
    confidence: parseFloat(parsed.confidence) || 0,
    suggestion: parsed.suggestion || '',
  };
}

/**
 * 跟踪目标分析
 * @param {string} imageBase64 - base64 图像
 * @param {string} instruction - 目标描述（如"穿红衣服的人"）
 * @returns {Promise<{found, horizontal, vertical, distance, movingDirection}>}
 */
async function trackTarget(imageBase64, instruction) {
  const raw = await callVlmApi(imageBase64, TRACK_SYSTEM_PROMPT, `跟踪目标：${instruction}`);
  const parsed = parseVlmOutput(raw);
  return {
    found: !!parsed.found,
    horizontal: parsed.horizontal || 'center',
    vertical: parsed.vertical || 'center',
    distance: parsed.distance || 'good',
    movingDirection: parsed.movingDirection || 'unknown',
  };
}

module.exports = { searchTarget, trackTarget };
