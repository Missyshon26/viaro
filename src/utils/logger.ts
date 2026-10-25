/**
 * Minimal structured-ish logger. Swap for pino/winston later without touching call sites.
 * Timestamps here are operational, not business logic — business time always goes
 * through config/timezone.ts.
 */
type Level = 'info' | 'warn' | 'error' | 'debug';

function emit(level: Level, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') {
    console.error(line, meta ?? '');
  } else if (level === 'warn') {
    console.warn(line, meta ?? '');
  } else {
    console.log(line, meta ?? '');
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
};
