/**
 * API 封装 - 前端与后端通信
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

// ─── 解析自然语言 ──────────────────────────────────
export function parseNlp(message) {
  return api.post('/parse', { message })
}

// ─── 语音转文字 ──────────────────────────────────
export function speechToText(audioBlob) {
  const formData = new FormData()
  formData.append('audio', audioBlob, 'recording.webm')
  return api.post('/speech-to-text', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000, // 语音识别可能较慢
  })
}

// ─── 执行飞控任务 ──────────────────────────────────
export function executeTask(actions, mode = 'simulate', dockCode = '8UUXN6A00A0ALQ') {
  return api.post('/execute', { actions, mode, dockCode })
}

// ─── 地理编码 ──────────────────────────────────────
export function geocode(address) {
  return api.post('/geocode', { address })
}

// ─── 认证状态 ──────────────────────────────────────
export function getAuthStatus() {
  return api.get('/auth/status')
}

export function setCredentials(username, password) {
  return api.post('/auth/credentials', { username, password })
}

export function login() {
  return api.post('/auth/login')
}

// ─── 验证码登录 ──────────────────────────────
export function getCaptcha() {
  return api.get('/auth/captcha')
}

export function loginWithCaptcha(username, password, captcha, sessionCookie) {
  return api.post('/auth/login-with-captcha', { username, password, captcha, sessionCookie })
}

// ─── 健康检查 ──────────────────────────────────────
export function healthCheck() {
  return api.get('/health')
}

// ─── WebSocket 连接 ────────────────────────────────
export function createWsConnection(onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // 开发模式直连后端，绕过 Vue dev server 的 WS 代理（代理会导致帧损坏）
  const isDev = process.env.NODE_ENV === 'development'
  const host = isDev ? 'localhost:8699' : window.location.host
  const wsUrl = `${protocol}//${host}/ws`
  const ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log('[WS] 已连接')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      onMessage(msg)
    } catch (e) {
      console.error('[WS] 消息解析失败:', e)
    }
  }

  ws.onclose = () => {
    console.log('[WS] 已断开')
  }

  ws.onerror = (err) => {
    console.error('[WS] 错误:', err)
  }

  return ws
}

export default api
