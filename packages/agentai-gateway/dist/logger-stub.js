/**
 * Logger Stub - 简单日志, 后续可替换为 pino
 */
export const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => {
        if (process.env.DEBUG)
            console.log(`[DEBUG] ${msg}`);
    },
};
