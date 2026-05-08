/**
 * 语音转文字服务 (Speech-to-Text)
 *
 * 使用阿里云 DashScope Paraformer 模型进行语音识别
 * 支持中文语音，准确率高，无需 HTTPS
 */
'use strict';

const axios = require('axios');
const { decodeApiKey, isApiKeyConfigured } = require('./apikey-helper');

/**
 * 将录音文件转为文字（阿里云 DashScope Paraformer）
 * @param {Buffer} audioBuffer - 音频文件二进制数据
 * @param {string} format - 音频格式 (webm/wav/mp3/ogg)
 * @returns {Promise<string>} 转写文本
 */
async function transcribeAudio(audioBuffer, format = 'webm') {
  const apiKey = decodeApiKey(process.env.DASHSCOPE_API_KEY);

  if (!apiKey || !isApiKeyConfigured(process.env.DASHSCOPE_API_KEY)) {
    throw new Error('阿里云 API Key 未配置，无法使用语音识别');
  }

  // 将音频转为 base64 Data URI
  const audioMimeType = format === 'webm' ? 'audio/webm' : format === 'wav' ? 'audio/wav' : format === 'mp3' ? 'audio/mpeg' : 'audio/ogg';
  const audioBase64 = audioBuffer.toString('base64');
  const dataUri = `data:${audioMimeType};base64,${audioBase64}`;

  console.log(`[STT] 开始语音识别，音频大小: ${(audioBuffer.length / 1024).toFixed(1)}KB, 格式: ${format}`);

  // 使用阿里云 Qwen3-ASR-Flash 语音识别（OpenAI 兼容格式）
  // 文档: https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference

  const resp = await axios.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      model: 'qwen3-asr-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: dataUri,
              },
            },
          ],
        },
      ],
      stream: false,
      asr_options: {
        enable_itn: true,
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  // 解析返回结果
  const content = resp.data?.choices?.[0]?.message?.content;
  if (content) {
    const normalized = normalizeNumbers(content.trim());
    console.log(`[STT] 识别结果: ${content.trim()}`);
    if (normalized !== content.trim()) {
      console.log(`[STT] 数字规范化: ${normalized}`);
    }
    return normalized;
  }

  // 兼容其他返回格式
  const results = resp.data?.output?.results;
  if (results && results.length > 0) {
    const text = results.map(r => r.text).join('');
    if (text) {
      console.log(`[STT] 识别结果: ${text}`);
      return text.trim();
    }
  }

  console.log('[STT] 完整响应:', JSON.stringify(resp.data).substring(0, 500));
  throw new Error('语音识别返回格式异常: ' + JSON.stringify(resp.data).substring(0, 200));
}

module.exports = { transcribeAudio };

/**
 * 中文数字规范化：将语音识别输出的中文数字转为阿拉伯数字
 * 例：F零六 → F06, 三栋 → 3栋, 高度一百二十米 → 高度120米
 */
function normalizeNumbers(text) {
  const cnDigits = { '零': '0', '〇': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9' };

  // 规则1：字母后紧跟的中文数字序列 → 阿拉伯数字（如 F零六 → F06）
  text = text.replace(/([A-Za-z])([零〇一二三四五六七八九]+)/g, (match, prefix, nums) => {
    return prefix + nums.split('').map(c => cnDigits[c] || c).join('');
  });

  // 规则2：“栋/号/楼/期/区” 前的中文数字序列 → 阿拉伯数字（如 三栋 → 3栋）
  text = text.replace(/([零〇一二三四五六七八九]+)([栋号楼期区层])/g, (match, nums, suffix) => {
    return nums.split('').map(c => cnDigits[c] || c).join('') + suffix;
  });

  // 规则3：含“十百千万”的完整中文数字序列 → 阿拉伯数字
  // 匹配连续的中文数字+单位组合，如 一百二十、三百五十、八十
  text = text.replace(/[零〇一二三四五六七八九十百千万]+/g, (match) => {
    // 必须含单位字符才算复合数字
    if (/[十百千万]/.test(match)) {
      return cnNumberToArabic(match);
    }
    return match;
  });

  return text;
}

/**
 * 简单中文数字转阿拉伯数字
 * 支持：零~九、十、百、组合如 一百二十三 → 123
 */
function cnNumberToArabic(str) {
  const digitMap = { '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  if (!str) return str;

  let result = 0, section = 0;
  for (const ch of str) {
    const d = digitMap[ch];
    if (d !== undefined) {
      section = d;
    } else {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : ch === '千' ? 1000 : ch === '万' ? 10000 : 0;
      result += (section || 1) * unit;
      section = 0;
    }
  }
  result += section;

  return result > 0 ? String(result) : str;
}
