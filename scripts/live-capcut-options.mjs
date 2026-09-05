export function assertBillableEmailAllowed(source, env) {
  if (source.mode !== 'api') return;
  const flag = source.provider === 'gmail94'
    ? 'VERIFY_GMAIL94_BUY'
    : 'VERIFY_DONGVANFB_BUY';
  if (env[flag] !== '1') {
    throw new Error(
      'Nguồn ' + source.provider + ' có trả phí; chỉ được chạy khi đã có phê duyệt và ' +
      flag + '=1.'
    );
  }
}

export function terminalAccountCount(progress) {
  return Number(progress?.accountsCompleted ?? 0) +
    Number(progress?.accountsFailed ?? 0) +
    Number(progress?.accountsStopped ?? 0);
}

export function isTerminalRunState(state) {
  return state === 'completed' || state === 'stopped' ||
    state === 'blocked' || state === 'failed';
}
