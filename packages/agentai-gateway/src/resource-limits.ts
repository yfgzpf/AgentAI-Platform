/**
 * 资源上限配置 (Resource Limits)
 * ----------------------------------------------------
 * 解决元模式 4 (资源无上限):
 *   - MAX_STREAM_TOOL_CALLS: 流式 tool_calls 累积上限
 *   - SUBAGENT_TIMEOUT: 子代理超时
 *   - SESSION_TTL: Session 生命周期
 *   - MAX_MEMORY_ENTRIES: 记忆条目上限
 *   - MAX_FILES_SEARCH: 语义搜索文件数上限
 *
 * @see 第四层诊断: 架构预防 - 元模式 4
 */

/**
 * 流式响应中的 tool_calls 累积上限
 * 超过此数量后丢弃后续 delta
 */
export const MAX_STREAM_TOOL_CALLS = 10;

/**
 * 流式响应中单个 tool_call 的参数字符串上限
 * 防止恶意超长参数导致内存溢出
 */
export const MAX_TOOL_CALL_ARGS_LENGTH = 50000;

/**
 * 子代理 (Agent Spawner) 超时时间
 */
export const SUBAGENT_TIMEOUT_MS = 60_000;

/**
 * 子代理最大迭代次数
 */
export const SUBAGENT_MAX_ITERATIONS = 10;

/**
 * Session 空闲超时 (30 分钟)
 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 最大活跃 session 数
 * 超过后触发旧 session 清理
 */
export const MAX_ACTIVE_SESSIONS = 50;

/**
 * 记忆条目上限 (每个用户)
 */
export const MAX_MEMORY_ENTRIES_PER_USER = 500;

/**
 * 记忆条目上限 (每个工作空间)
 */
export const MAX_MEMORY_ENTRIES_PER_WORKSPACE = 200;

/**
 * 语义搜索最大文件数
 */
export const MAX_SEARCH_FILES = 200;

/**
 * 语义搜索最大结果数
 */
export const MAX_SEARCH_RESULTS = 20;

/**
 * Bash 命令超时 (秒)
 */
export const BASH_TIMEOUT_SECONDS = 30;

/**
 * Bash 最大输出长度
 */
export const BASH_MAX_OUTPUT_LENGTH = 50000;

/**
 * Python 桥接超时 (秒)
 */
export const PYTHON_BRIDGE_TIMEOUT_SECONDS = 30;

/**
 * web_fetch 最大输出长度
 */
export const WEB_FETCH_MAX_LENGTH = 30000;

/**
 * web_search 最大结果数
 */
export const WEB_SEARCH_MAX_RESULTS = 5;

/**
 * 单次 tool call 的最大参数键数
 * 防止过大的参数对象
 */
export const MAX_TOOL_PARAM_KEYS = 50;

/**
 * 单次 multi_edit 的最大编辑数
 */
export const MAX_MULTI_EDIT_COUNT = 50;

/**
 * 单次 code_review 的最大文件数
 */
export const MAX_CODE_REVIEW_FILES = 20;

/**
 * 代码文件大小上限 (字节)
 */
export const MAX_FILE_SIZE_FOR_ANALYSIS = 1_000_000; // 1 MB

/**
 * 内存中的 session 清理间隔 (秒)
 */
export const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 工具描述最大长度 (system prompt 中)
 */
export const MAX_TOOL_DESCRIPTION_LENGTH = 500;

/**
 * 系统提示总长度软限制
 */
export const MAX_SYSTEM_PROMPT_LENGTH = 20000;
