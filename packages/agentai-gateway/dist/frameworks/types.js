/**
 * Framework Adapter 接口
 * ----------------------------------------------------
 * 自研双适配器运行时热切换: agentai (主框架) / pulseflow (强注入防御配置)
 *
 * 设计:
 *   - **runtime 切换**: 不重启 Gateway, 仅换 active adapter
 *   - **统一接口**: 抹平两个适配器内部机制差异
 *   - **能力查询**: 调用方按能力而非框架名选 adapter (decoupling)
 */
export {};
