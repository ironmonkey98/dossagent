/**
 * FFmpeg 抽帧模块 — 从 RTSP/HTTP 视频流抓取单帧图片
 *
 * 使用 ffmpeg 抓取一帧并返回 base64 编码的 JPEG 图像，
 * 供 VLM 分析使用。
 */
'use strict';

const { execFile } = require('child_process');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * 从视频流 URL 抓取单帧
 * @param {string} streamUrl - RTSP 或 HTTP 视频流地址
 * @param {object} [options] - 可选参数
 * @param {number} [options.timeoutMs=5000] - ffmpeg 超时（毫秒）
 * @param {string} [options.size] - 输出分辨率，如 "640x360"
 * @returns {Promise<string>} base64 编码的 JPEG 图像
 */
function extractFrame(streamUrl, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  // ffmpeg 参数：取 1 帧，输出为 jpeg（pipe:1 = stdout），限制读取时长避免卡住
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', streamUrl,
    '-frames:v', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    '-q:v', '5',            // JPEG 质量（2=最好，31=最差，5=较好且体积小）
    '-an',                  // 禁用音频
    '-y',
    'pipe:1',
  ];

  if (options.size) {
    // 在 -i 后面插入缩放滤镜
    const idx = args.indexOf('-i');
    args.splice(idx + 2, 0, '-vf', `scale=${options.size}`);
  }

  return new Promise((resolve, reject) => {
    const proc = execFile('ffmpeg', args, {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,  // 5MB 缓冲
      encoding: 'buffer',
    }, (err, stdout) => {
      if (err) {
        // ffmpeg 超时或流不可用时返回空帧而非崩溃
        reject(new Error(`抽帧失败: ${err.message}`));
        return;
      }
      if (!stdout || stdout.length < 100) {
        reject(new Error('抽帧结果为空'));
        return;
      }
      resolve(stdout.toString('base64'));
    });

    // 忽略 stderr 噪音（ffmpeg 大量输出 debug 信息）
    proc.stderr?.resume();
  });
}

/**
 * 从 RTSP 流构建 URL
 * 暂不使用，预留后续对接机场 RTSP 地址
 */
function buildRtspUrl(dockCode, token) {
  // 预留：根据 dockCode 和 token 构建 RTSP 地址
  // 实际地址格式需对接 DOSS 平台图传接口
  return null;
}

/**
 * 使用 HTTP 截图接口抓帧（备选方案）
 * 部分机场支持 HTTP 截图 API 而非 RTSP 流
 * @param {string} snapshotUrl - HTTP 截图接口 URL
 * @param {string} token - Bearer token
 * @returns {Promise<string>} base64 编码图像
 */
async function extractFrameHttp(snapshotUrl, token) {
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');

  const parsed = new URL(snapshotUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      rejectUnauthorized: false,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) {
          reject(new Error('HTTP 截图结果为空'));
          return;
        }
        resolve(buf.toString('base64'));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP 截图超时')); });
    req.end();
  });
}

module.exports = { extractFrame, extractFrameHttp, buildRtspUrl };
