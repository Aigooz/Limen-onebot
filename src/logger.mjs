const scalar = new Set(['state', 'code', 'count', 'port', 'driver', 'attempt', 'reason', 'action',
  'message_type', 'notice_type', 'request_type', 'group', 'user', 'duration_ms', 'timeout_ms',
  'bytes', 'status', 'phase', 'version', 'retcode']);

/**
 * One JSON object per line. Message bodies, credentials, QQ numbers in free
 * text and driver exception text are deliberately excluded; callers pass
 * short machine-readable fields instead.
 */
export function createLogger(write = line => process.stdout.write(`${line}\n`)) {
  return (level, event, fields = {}) => {
    const safe = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!scalar.has(key)) continue;
      if (['string', 'number', 'boolean'].includes(typeof value) || value === null) safe[key] = value;
    }
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...safe }));
  };
}
