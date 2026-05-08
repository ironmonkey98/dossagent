import { describe, it, expect } from 'vitest';
import { classifyAction, type IpcAction } from './ipc-guard.js';

describe('IPC Guard integration scenarios', () => {
  it('should pass normal message flow', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { chatJid: 'test@g.us', text: '无人机已起飞' },
    };
    const result = classifyAction(action);
    expect(result.verdict).toBe('pass');
    expect(result.riskLevel).toBe('safe');
  });

  it('should block oversized message (potential DoS)', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { chatJid: 'test@g.us', text: 'A'.repeat(500_000) },
    };
    const result = classifyAction(action);
    expect(result.verdict).toBe('blocked');
  });

  it('should flag XSS injection in message text', () => {
    const action: IpcAction = {
      type: 'message',
      payload: {
        chatJid: 'test@g.us',
        text: '<script>document.cookie</script>',
      },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.detail).toContain('injection');
  });

  it('should classify schedule_task as risky but pass', () => {
    const action: IpcAction = {
      type: 'schedule_task',
      payload: {
        prompt: '每日检查无人机状态',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        targetJid: 'main@g.us',
      },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.verdict).toBe('pass');
  });
});
