/**
 * 语音转文字路由 - POST /api/speech-to-text
 *
 * 接收前端录制的音频文件，调用语音识别服务转为文字
 */
'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const sttService = require('../services/stt-service');

// 配置 multer 用于接收音频文件（内存存储，不写磁盘）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 最大 10MB
});

// POST /api/speech-to-text
router.post('/speech-to-text', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '缺少音频文件' });
    }

    // 从 FormData field 中提取 token（multer 会将普通字段放入 req.body）
    if (req.body && req.body.token && !req.externalToken) {
      req.externalToken = req.body.token;
      if (req.externalToken) {
        console.log(`[auth] 从 FormData 收到外部 token: ${req.externalToken.substring(0, 20)}...`);
      }
    }

    // 从文件的 mimetype 推断音频格式
    const mimetype = req.file.mimetype || '';
    let format = 'webm';
    if (mimetype.includes('wav')) format = 'wav';
    else if (mimetype.includes('mp3')) format = 'mp3';
    else if (mimetype.includes('ogg')) format = 'ogg';
    else if (mimetype.includes('webm')) format = 'webm';
    else if (mimetype.includes('mp4')) format = 'mp4';

    console.log(`[/api/speech-to-text] 收到音频: ${req.file.originalname}, 大小: ${(req.file.size / 1024).toFixed(1)}KB, 格式: ${format}`);

    const text = await sttService.transcribeAudio(req.file.buffer, format);

    res.json({
      success: true,
      text: text,
      format: format,
      size: req.file.size,
    });
  } catch (err) {
    console.error('[/api/speech-to-text] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
