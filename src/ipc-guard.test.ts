import { describe, it, expect } from 'vitest';
import { classifyAction, type IpcAction } from './ipc-guard.js';

describe('classifyAction', () => {
  it('should classify message IPC as safe', () => {
    const action: IpcAction = { type: 'message', payload: { text: 'hello' } };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('safe');
    expect(result.verdict).toBe('pass');
  });

  it('should classify register_group as safe', () => {
    const action: IpcAction = {
      type: 'register_group',
      payload: { jid: 'test@g.us' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('safe');
    expect(result.verdict).toBe('pass');
  });

  it('should classify schedule_task as risky', () => {
    const action: IpcAction = {
      type: 'schedule_task',
      payload: { prompt: 'check status' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.verdict).toBe('pass');
  });

  it('should classify unknown type as risky (fail-closed)', () => {
    const action: IpcAction = { type: 'unknown_action', payload: {} };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
  });

  it('should block IPC with oversized payload', () => {
    const bigPayload = { text: 'x'.repeat(200_001) };
    const action: IpcAction = { type: 'message', payload: bigPayload };
    const result = classifyAction(action);
    expect(result.verdict).toBe('blocked');
    expect(result.detail).toContain('oversized');
  });

  it('should flag script injection patterns', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { text: '<script>alert("xss")</script>' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
    expect(result.detail).toContain('injection');
  });

  it('should classify ask_user as safe', () => {
    const action: IpcAction = {
      type: 'ask_user',
      payload: { question: 'continue?' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('safe');
    expect(result.verdict).toBe('pass');
  });

  it('should classify delete_task as risky', () => {
    const action: IpcAction = {
      type: 'delete_task',
      payload: { taskId: 'task-123' },
    };
    const result = classifyAction(action);
    expect(result.riskLevel).toBe('risky');
  });

  it('should allow normal-sized payloads', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { text: '无人机已安全返航' },
    };
    const result = classifyAction(action);
    expect(result.verdict).toBe('pass');
  });

  it('should detect javascript: protocol injection', () => {
    const action: IpcAction = {
      type: 'message',
      payload: { text: 'javascript:void(0)' },
    };
    const result = classifyAction(action);
    expect(result.detail).toContain('injection');
  });
});
