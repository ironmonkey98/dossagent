<template>
  <div id="app">
    <el-container class="app-container">
      <!-- 顶部导航 -->
      <el-header class="app-header" height="60px">
        <div class="header-left">
          <span class="logo-icon">🛸</span>
          <span class="app-title">无人机自然语言飞控智能体</span>
        </div>
        <div class="header-right">
          <el-tag :type="wsConnected ? 'success' : 'danger'" size="small">
            {{ wsConnected ? 'WS 已连接' : 'WS 未连接' }}
          </el-tag>
          <el-tag :type="authStatus.hasToken ? 'success' : 'warning'" size="small" style="margin-left:8px">
            {{ authStatus.hasToken ? '已认证' : '未认证' }}
          </el-tag>
          <el-button type="text" @click="showAuthDialog = true" style="margin-left:12px;color:#fff">
            认证设置
          </el-button>
        </div>
      </el-header>

      <el-main class="app-main">
        <!-- 自然语言输入 -->
        <el-card class="input-card" shadow="hover">
          <div slot="header" class="card-header">
            <span>📋 指令输入</span>
            <el-radio-group v-model="flightMode" size="mini" style="margin-left:16px">
              <el-radio-button label="simulate">模拟飞行</el-radio-button>
              <el-radio-button label="real">真实飞控</el-radio-button>
            </el-radio-group>
          </div>
          <div style="position: relative;">
            <el-input
              v-model="nlpInput"
              type="textarea"
              :rows="3"
              placeholder="请输入飞控指令，如：软件园三期F06机场起飞，飞到软件园三期F09栋，拍照后返航"
              @keydown.ctrl.enter.native="handleParse"
            />
            <el-button
              :type="isRecording ? 'danger' : transcribing ? 'warning' : 'info'"
              circle
              size="small"
              class="voice-input-btn"
              :class="{ 'recording': isRecording }"
              @click="toggleRecording"
              :loading="transcribing"
              :title="isRecording ? '点击停止录音' : transcribing ? '正在识别中...' : '点击开始语音输入'"
            >
              <i v-if="!transcribing" class="el-icon-microphone"></i>
            </el-button>
          </div>
          <div class="input-actions">
            <el-button type="primary" :loading="parsing" @click="handleParse" icon="el-icon-magic-stick">
              解析指令
            </el-button>
            <el-button :disabled="!parsedActions.length" type="success" :loading="executing" @click="handleExecute" icon="el-icon-video-play">
              执行任务
            </el-button>
            <span class="input-hint">
              <template v-if="transcribing">
                🔄 AI 识别中...
              </template>
              <template v-else>
                🎤 语音输入 | Ctrl+Enter 解析
              </template>
            </span>
          </div>
        </el-card>

        <!-- 任务预览 -->
        <el-card v-if="parsedActions.length" class="preview-card" shadow="hover">
          <div slot="header" class="card-header">
            <span>🎯 解析结果（{{ parsedActions.length }} 条指令，模型: {{ usedModel }}）</span>
          </div>
          <el-table :data="parsedActions" stripe size="small" style="width:100%">
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="label" label="指令" min-width="180" />
            <el-table-column prop="cmd" label="API指令" width="160" />
            <el-table-column label="地点/坐标" min-width="160">
              <template slot-scope="{row}">
                <span v-if="row.address">{{ row.address }}</span>
                <span v-else-if="row.longitude" style="font-size:12px;color:#999">
                  {{ row.longitude.toFixed(4) }}, {{ row.latitude.toFixed(4) }}
                </span>
                <span v-else style="color:#ccc">-</span>
              </template>
            </el-table-column>
            <el-table-column label="高度" width="80" align="center">
              <template slot-scope="{row}">
                {{ row.height ? row.height + 'm' : '-' }}
              </template>
            </el-table-column>
          </el-table>
          <div v-if="geocoded.length" style="margin-top:10px;color:#67C23A;font-size:12px">
            📍 地理编码: {{ geocoded.map(g => g.name).join(' → ') }}
          </div>
        </el-card>

        <!-- 实时状态 -->
        <el-card v-if="taskRunning" class="status-card" shadow="hover">
          <div slot="header" class="card-header">
            <span>📡 实时状态</span>
            <el-tag size="small" :type="taskRunning ? 'warning' : 'info'">
              {{ taskRunning ? '执行中...' : '已完成' }}
            </el-tag>
          </div>
          <el-progress
            :percentage="taskProgress"
            :status="taskProgress === 100 ? 'success' : ''"
            :format="() => `${currentStep}/${totalSteps}`"
          />
          <div class="status-detail">
            <div v-if="currentStatusText" class="status-text">{{ currentStatusText }}</div>
          </div>
          <!-- 实时遥测数据 -->
          <div v-if="telemetry && taskRunning" class="telemetry-panel">
            <div class="telemetry-grid">
              <div class="telemetry-item">
                <span class="telemetry-label">高度</span>
                <span class="telemetry-value">{{ telemetry.height != null ? telemetry.height.toFixed(1) + 'm' : '--' }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">速度</span>
                <span class="telemetry-value">{{ telemetry.speed != null ? telemetry.speed.toFixed(1) + 'm/s' : '--' }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">距目标</span>
                <span class="telemetry-value" :class="{ 'near-target': telemetry.distToTarget != null && telemetry.distToTarget < 10 }">
                  {{ telemetry.distToTarget != null ? (telemetry.distToTarget < 1000 ? telemetry.distToTarget.toFixed(0) + 'm' : (telemetry.distToTarget / 1000).toFixed(2) + 'km') : '--' }}
                </span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">垂直速度</span>
                <span class="telemetry-value">{{ telemetry.verticalSpeed != null ? telemetry.verticalSpeed.toFixed(1) + 'm/s' : '--' }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">坐标</span>
                <span class="telemetry-value telemetry-coord">{{ telemetry.longitude != null ? telemetry.longitude.toFixed(6) + ', ' + telemetry.latitude.toFixed(6) : '--' }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">已等待</span>
                <span class="telemetry-value">{{ telemetry.elapsed }}s / {{ telemetry.timeout }}s</span>
              </div>
            </div>
          </div>
          <!-- 执行步骤列表 -->
          <div v-if="execSteps.length" class="steps-list">
            <div v-for="step in execSteps" :key="step.index" class="step-item">
              <i :class="step.success ? 'el-icon-success' : 'el-icon-error'" :style="{color: step.success ? '#67C23A' : '#F56C6C'}" />
              <span class="step-label">{{ step.label || step.cmdName }}</span>
              <span v-if="step.error" class="step-error" :title="step.error">⚠ {{ step.error.substring(0, 40) }}</span>
              <span class="step-time">{{ step.durationSec }}s</span>
            </div>
          </div>
        </el-card>

        <!-- 执行报告 -->
        <el-card v-if="finalReport" class="report-card" shadow="hover">
          <div slot="header" class="card-header">
            <span>📊 执行报告</span>
          </div>
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="执行模式">{{ finalReport.mode === 'real' ? '真实飞控' : '模拟飞行' }}</el-descriptions-item>
            <el-descriptions-item label="总指令数">{{ finalReport.totalSteps }}</el-descriptions-item>
            <el-descriptions-item label="成功/失败">
              <span style="color:#67C23A">{{ finalReport.successCount }}</span> /
              <span style="color:#F56C6C">{{ finalReport.failCount }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="总用时">{{ finalReport.totalSec }}秒</el-descriptions-item>
          </el-descriptions>
          <el-table :data="finalReport.steps" stripe size="mini" style="width:100%;margin-top:12px">
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="cmdName" label="指令" min-width="140" />
            <el-table-column prop="status" label="状态说明" min-width="180" />
            <el-table-column prop="durationSec" label="用时" width="80" align="center">
              <template slot-scope="{row}">{{ row.durationSec }}s</template>
            </el-table-column>
            <el-table-column label="结果" width="70" align="center">
              <template slot-scope="{row}">
                <el-tooltip v-if="!row.success && row.error" :content="row.error" placement="top">
                  <i class="el-icon-error" style="color:#F56C6C;cursor:pointer" />
                </el-tooltip>
                <i v-else :class="row.success ? 'el-icon-success' : 'el-icon-error'" :style="{color: row.success ? '#67C23A' : '#F56C6C'}" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-main>
    </el-container>

    <!-- 认证设置弹窗 -->
    <el-dialog title="认证设置" :visible.sync="showAuthDialog" width="500px" @open="handleAuthDialogOpen">
      <el-form label-width="80px" size="small">
        <el-form-item label="用户名">
          <el-input v-model="authUsername" placeholder="输入生产环境用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="authPassword" type="password" placeholder="输入密码" show-password />
        </el-form-item>
        <el-form-item label="验证码">
          <div style="display:flex;align-items:center;gap:8px">
            <el-input v-model="captchaCode" placeholder="输入验证码" style="width:120px" @keyup.enter.native="handleLoginWithCaptcha" />
            <img v-if="captchaImage" :src="captchaImage" style="height:32px;cursor:pointer;border:1px solid #dcdfe6;border-radius:4px" @click="fetchCaptcha" title="点击刷新验证码" />
            <el-button v-else size="small" @click="fetchCaptcha" :loading="captchaLoading">获取验证码</el-button>
          </div>
        </el-form-item>
      </el-form>
      <div slot="footer">
        <el-button size="small" @click="showAuthDialog = false">取消</el-button>
        <el-button type="primary" size="small" @click="handleLoginWithCaptcha" :loading="loginLoading">登录</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { parseNlp, executeTask, getAuthStatus, setCredentials, createWsConnection, speechToText, getCaptcha, loginWithCaptcha } from './api'

export default {
  name: 'App',
  data() {
    return {
      // 输入
      nlpInput: '',
      flightMode: 'simulate',
      // 语音输入
      isRecording: false,
      mediaRecorder: null,
      audioChunks: [],
      transcribing: false,
      // 解析
      parsing: false,
      parsedActions: [],
      geocoded: [],
      usedModel: '',
      // 执行
      executing: false,
      taskRunning: false,
      taskId: null,
      currentStep: 0,
      totalSteps: 0,
      taskProgress: 0,
      currentStatusText: '',
      execSteps: [],
      finalReport: null,
      // 飞行遥测
      telemetry: null,
      // WebSocket
      ws: null,
      wsConnected: false,
      // 认证
      authStatus: { hasCredentials: false, hasToken: false },
      showAuthDialog: false,
      authUsername: '',
      authPassword: '',
      // 验证码
      captchaImage: '',
      captchaSession: '',
      captchaCode: '',
      captchaLoading: false,
      loginLoading: false,
    }
  },
  mounted() {
    this.connectWs()
    this.refreshAuthStatus()
  },
  beforeDestroy() {
    if (this.ws) this.ws.close()
  },
  methods: {
    // ─── 语音录音（MediaRecorder + 后端大模型转写）──────────
    toggleRecording() {
      if (this.transcribing) {
        this.$message.warning('正在识别中，请稍候...')
        return
      }

      if (this.isRecording) {
        this.stopRecording()
      } else {
        this.startRecording()
      }
    },

    async startRecording() {
      // 检查浏览器是否支持 MediaRecorder 和 getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.$message.error('当前环境不支持录音。请使用 localhost 或 HTTPS 访问页面。')
        console.error('[语音] navigator.mediaDevices 不可用，可能是非安全上下文(非HTTPS/非localhost)')
        return
      }
      if (typeof MediaRecorder === 'undefined') {
        this.$message.error('当前浏览器不支持录音功能，请使用 Chrome 浏览器')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        this.audioChunks = []
        this.mediaRecorder = new MediaRecorder(stream)

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data)
          }
        }

        this.mediaRecorder.onstop = () => {
          // 停止所有音轨
          stream.getTracks().forEach(track => track.stop())
          // 生成音频文件并发送给后端
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' })
          this.sendAudioToBackend(audioBlob)
        }

        this.mediaRecorder.start()
        this.isRecording = true
        this.$message.success('开始录音，请说话...')
        console.log('[语音] 开始录音')
      } catch (error) {
        console.error('[语音] 启动录音失败:', error)
        if (error.name === 'NotAllowedError') {
          this.$message.error('请允许麦克风访问权限')
        } else if (error.name === 'NotFoundError') {
          this.$message.error('未找到麦克风设备')
        } else {
          this.$message.error('启动录音失败: ' + error.message)
        }
      }
    },

    stopRecording() {
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop()
        this.isRecording = false
        console.log('[语音] 停止录音，准备发送识别...')
      }
    },

    async sendAudioToBackend(audioBlob) {
      this.transcribing = true
      console.log(`[语音] 发送音频到后端，大小: ${(audioBlob.size / 1024).toFixed(1)}KB`)

      try {
        const { data } = await speechToText(audioBlob)
        if (data.success && data.text) {
          this.nlpInput = data.text
          this.$message.success('语音识别完成')
          console.log('[语音] 识别成功:', data.text)
        } else {
          this.$message.warning(data.error || '语音识别返回为空')
        }
      } catch (err) {
        console.error('[语音] 识别失败:', err)
        this.$message.error('语音识别失败: ' + (err.response?.data?.error || err.message))
      } finally {
        this.transcribing = false
      }
    },

    // ─── WebSocket ──────────────────────────────────
    connectWs() {
      this.ws = createWsConnection((msg) => {
        if (msg.type === 'connected') {
          this.wsConnected = true
          return
        }
        if (msg.type === 'flight_status') {
          this.handleWsEvent(msg.data)
        }
        if (msg.type === 'flight_telemetry') {
          this.telemetry = msg.data
        }
      })
      this.ws.onopen = () => { this.wsConnected = true }
      this.ws.onclose = () => { this.wsConnected = false }
    },

    handleWsEvent(event) {
      switch (event.type) {
        case 'task_start':
          this.taskRunning = true
          this.totalSteps = event.totalSteps
          this.currentStep = 0
          this.taskProgress = 0
          this.execSteps = []
          this.finalReport = null
          break
        case 'step_start':
          this.currentStep = event.index
          this.taskProgress = Math.round(((event.index - 1) / this.totalSteps) * 100)
          this.currentStatusText = event.status
          break
        case 'step_complete':
          this.taskProgress = Math.round((event.index / this.totalSteps) * 100)
          this.execSteps.push(event)
          this.currentStatusText = ''
          break
        case 'step_auto':
        case 'step_waiting':
        case 'step_countdown':
        case 'warning':
          this.currentStatusText = event.message || (event.remaining != null ? `等待中... ${event.remaining}s` : event.type)
          break
        case 'task_complete':
          this.taskRunning = false
          this.executing = false
          this.taskProgress = 100
          this.finalReport = event.report
          this.currentStatusText = ''
          break
        case 'task_error':
          this.taskRunning = false
          this.executing = false
          this.currentStatusText = '❌ ' + event.error
          this.$message.error('任务执行错误: ' + event.error)
          break
      }
    },

    // ─── 解析自然语言 ──────────────────────────────
    async handleParse() {
      if (!this.nlpInput.trim()) {
        this.$message.warning('请输入飞控指令')
        return
      }
      this.parsing = true
      this.parsedActions = []
      try {
        const { data } = await parseNlp(this.nlpInput)
        if (data.success) {
          this.parsedActions = data.actions
          this.geocoded = data.geocoded || []
          this.usedModel = data.model || ''
          this.$message.success(`解析成功：${data.actions.length} 条指令`)
        } else {
          this.$message.error(data.error || '解析失败')
        }
      } catch (err) {
        this.$message.error('解析失败: ' + (err.response?.data?.error || err.message))
      } finally {
        this.parsing = false
      }
    },

    // ─── 执行飞控任务 ──────────────────────────────
    async handleExecute() {
      this.executing = true
      this.finalReport = null
      this.execSteps = []
      try {
        const { data } = await executeTask(this.parsedActions, this.flightMode)
        if (data.success) {
          this.taskId = data.taskId
          this.$message.info('任务已启动')
        } else {
          this.$message.error(data.error || '启动失败')
          this.executing = false
        }
      } catch (err) {
        this.$message.error('执行失败: ' + (err.response?.data?.error || err.message))
        this.executing = false
      }
    },

    // ─── 认证 ──────────────────────────────────────
    async refreshAuthStatus() {
      try {
        const { data } = await getAuthStatus()
        this.authStatus = data
      } catch (e) { /* ignore */ }
    },

    handleAuthDialogOpen() {
      this.captchaCode = ''
      this.captchaImage = ''
      this.captchaSession = ''
      this.fetchCaptcha()
    },

    async fetchCaptcha() {
      this.captchaLoading = true
      try {
        const { data } = await getCaptcha()
        if (data.success) {
          this.captchaImage = data.imageBase64
          this.captchaSession = data.sessionCookie
        }
      } catch (e) {
        this.$message.error('获取验证码失败')
      } finally {
        this.captchaLoading = false
      }
    },

    async handleLoginWithCaptcha() {
      if (!this.authUsername || !this.authPassword) {
        this.$message.warning('请输入用户名和密码')
        return
      }
      if (!this.captchaCode) {
        this.$message.warning('请输入验证码')
        return
      }
      if (!this.captchaSession) {
        this.$message.warning('请先获取验证码')
        return
      }
      this.loginLoading = true
      try {
        const { data } = await loginWithCaptcha(
          this.authUsername, this.authPassword,
          this.captchaCode, this.captchaSession
        )
        if (data.success) {
          this.$message.success('登录成功！Token 已缓存')
          this.showAuthDialog = false
          this.refreshAuthStatus()
        } else {
          this.$message.error(data.error || '登录失败')
          this.fetchCaptcha()
        }
      } catch (err) {
        const errMsg = (err.response && err.response.data && err.response.data.error) || err.message
        this.$message.error('登录失败: ' + errMsg)
        // 验证码失效，刷新
        this.fetchCaptcha()
      } finally {
        this.loginLoading = false
      }
    },

    async handleSetCredentials() {
      if (!this.authUsername || !this.authPassword) {
        this.$message.warning('请输入用户名和密码')
        return
      }
      try {
        await setCredentials(this.authUsername, this.authPassword)
        this.$message.success('凭据已保存')
        this.showAuthDialog = false
        this.refreshAuthStatus()
      } catch (err) {
        this.$message.error('保存失败: ' + err.message)
      }
    },
  },
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; font-family: 'Microsoft YaHei', sans-serif; }

#app {
  min-height: 100vh;
  background: #f0f2f5;
}

.app-container { min-height: 100vh; }

.app-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
}

.header-left { display: flex; align-items: center; }
.logo-icon { font-size: 28px; margin-right: 12px; }
.app-title { font-size: 18px; font-weight: 600; letter-spacing: 1px; }
.header-right { display: flex; align-items: center; }

.app-main { max-width: 960px; margin: 0 auto; padding: 20px; }

.input-card, .preview-card, .status-card, .report-card { margin-bottom: 16px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }

.input-actions { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
.input-hint { color: #999; font-size: 12px; margin-left: 8px; }

.voice-input-btn {
  position: absolute !important;
  right: -10px;
  top: 10px;
  z-index: 10;
  transition: all 0.3s ease;
}

.voice-input-btn.recording {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(245, 108, 108, 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(245, 108, 108, 0);
  }
}

.status-detail { margin-top: 12px; }
.status-text { font-size: 14px; color: #606266; line-height: 1.6; }

.telemetry-panel {
  margin-top: 12px;
  background: #1a1a2e;
  border-radius: 8px;
  padding: 12px 16px;
  color: #e0e0e0;
}
.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 16px;
}
.telemetry-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.telemetry-label {
  font-size: 11px;
  color: #909399;
  margin-bottom: 2px;
}
.telemetry-value {
  font-size: 16px;
  font-weight: 600;
  font-family: 'Consolas', 'Courier New', monospace;
  color: #67C23A;
}
.telemetry-value.near-target { color: #E6A23C; }
.telemetry-coord { font-size: 13px; color: #409EFF; }

.steps-list { margin-top: 12px; max-height: 300px; overflow-y: auto; }
.step-item {
  display: flex; align-items: center; padding: 6px 0;
  border-bottom: 1px solid #f0f0f0; font-size: 13px;
}
.step-label { flex: 1; margin-left: 8px; }
.step-error { color: #F56C6C; font-size: 12px; margin-right: 8px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-time { color: #999; font-size: 12px; }

.el-card__header { padding: 12px 20px; }
</style>
