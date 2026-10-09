/**
 * 告警推送: 把清理器异常通过前端 WS / 系统通知 / 审计日志告知用户
 * 目前实现: 调用外部 push 回调(由 CleanerDaemon 注入)
 */
/**
 * 发送清理器告警
 * oversize-file: 单文件超 100MB
 * total-quota: 总占用超 1GB
 */
export async function sendAlert(detail, push) {
    const messages = {
        'oversize-file': `⚠️ 文件过大 (${((detail.size || 0) / 1024 / 1024).toFixed(1)} MB): ${detail.file}`,
        'total-quota': `⚠️ 占用总配额超 1GB: 当前 ${((detail.totalBytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GB`,
    };
    await push({
        type: 'cleaner_alert',
        level: 'warning',
        message: messages[detail.kind],
        meta: detail,
    });
}
