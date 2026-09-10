import { describe, expect, it, vi } from 'vitest';
import { sendTaskAction } from '../taskMutation';

describe('HTTP task mutation', () => {
  it('returns a successful action receipt', async () => {
    const requestJson = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: 0, err_tips: '' } });
    const result = await sendTaskAction({ requestJson } as never, { actionKey: 'capcut_web_design_chat', opId: 'capcut_web_design_chat_user_2026-09-07' });
    expect(result.errNo).toBe(0);
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({ effect: 'mutation', body: { action_key: 'capcut_web_design_chat', op_id: 'capcut_web_design_chat_user_2026-09-07' } }));
  });

  it('rejects malformed operation identity before HTTP', async () => {
    const requestJson = vi.fn();
    await expect(sendTaskAction({ requestJson } as never, { actionKey: 'bad', opId: 'bad' })).rejects.toThrow('TASK_ACTION_INPUT_INVALID');
    expect(requestJson).not.toHaveBeenCalled();
  });

  it.each(['0', false, null, undefined, NaN, 1])('rejects non-numeric-zero err_no value: %s', async (badErrNo) => {
    const requestJson = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { err_no: badErrNo, err_tips: '' } });
    await expect(
      sendTaskAction({ requestJson } as never, {
        actionKey: 'capcut_web_design_chat',
        opId: 'capcut_web_design_chat_user_2026-09-07',
      })
    ).rejects.toThrow('TASK_ACTION_REJECTED');
  });
});
