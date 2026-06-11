/**
 * Logger Stub - 简单日志, 后续可替换为 pino
 */
export const log = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.log(`[DEBUG] ${msg}`);
  },
};
