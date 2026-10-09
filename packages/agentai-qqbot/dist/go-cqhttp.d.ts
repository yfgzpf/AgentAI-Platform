/**
 * go-cqhttp 子进程管理
 * -----------------------------------------------------------
 * 真 go-cqhttp 二进制从 https://github.com/Mrs4s/go-cqhttp 下载
 * 用户需自己下载并放入 packages/agentai-qqbot/bin/
 *
 * 文档: docs/QQBOT_SETUP.md 详细说明
 */
import { ChildProcess } from 'child_process';
interface GoCqHttpOpts {
    binaryPath: string;
    configPath: string;
    qq: number;
    password?: string;
}
export declare const goCqHttpManager: {
    start(opts: GoCqHttpOpts): Promise<ChildProcess>;
};
export {};
