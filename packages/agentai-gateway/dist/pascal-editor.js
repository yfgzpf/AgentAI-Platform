/**
 * pascal-editor.ts — Pascal Editor MCP Server 集成
 * ----------------------------------------------------
 * 让 AI 通过自然语言操作 3D 建筑模型
 *
 * 功能:
 *   - 启动/停止 Pascal Editor MCP Server
 *   - 提供 19 个建筑操作工具 (墙体/门窗/屋顶/楼层等)
 *   - 支持 CSG 布尔运算 (墙体开洞)
 *   - 支持 IFC 模型导入
 *   - 支持导出为 GLB/OBJ/USDZ
 *
 * 依赖: @pascal-app/mcp (需要用户安装)
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
class PascalEditorManager extends EventEmitter {
    serverProcess = null;
    isRunning = false;
    port = 3100;
    workspace = process.cwd();
    models = new Map();
    /**
     * 启动 Pascal Editor MCP Server
     */
    async start(options = {}) {
        if (this.isRunning) {
            return { success: true, message: `Pascal Editor MCP Server 已在运行 (端口 ${this.port})` };
        }
        this.port = options.port || 3100;
        this.workspace = options.workspace || process.cwd();
        try {
            // 检查 @pascal-app/mcp 是否已安装
            const { execSync } = await import('child_process');
            try {
                execSync('npm list -g @pascal-app/mcp', { stdio: 'pipe' });
            }
            catch {
                return {
                    success: false,
                    message: '❌ @pascal-app/mcp 未安装\n\n请运行: npm install -g @pascal-app/mcp\n\n或让 AI 调用: npm_install({package:"@pascal-app/mcp", mode:"global"})',
                };
            }
            // 启动 MCP Server
            this.serverProcess = spawn('pascal-mcp-server', ['--port', String(this.port)], {
                cwd: this.workspace,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PASCAL_WORKSPACE: this.workspace },
            });
            this.serverProcess.stdout?.on('data', (data) => {
                const msg = data.toString();
                this.emit('log', msg);
                if (msg.includes('Server started')) {
                    this.isRunning = true;
                    this.emit('ready');
                }
            });
            this.serverProcess.stderr?.on('data', (data) => {
                this.emit('error', data.toString());
            });
            this.serverProcess.on('exit', (code) => {
                this.isRunning = false;
                this.serverProcess = null;
                this.emit('exit', code);
            });
            // 等待服务器启动
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('MCP Server 启动超时'));
                }, 10000);
                this.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(new Error(err));
                });
            });
            return {
                success: true,
                message: `✅ Pascal Editor MCP Server 已启动\n端口: ${this.port}\n工作区: ${this.workspace}\n\n现在可以使用建筑编辑工具了`,
            };
        }
        catch (e) {
            return { success: false, message: `❌ 启动失败: ${e.message}` };
        }
    }
    /**
     * 停止 MCP Server
     */
    async stop() {
        if (!this.isRunning || !this.serverProcess) {
            return { success: true, message: 'MCP Server 未在运行' };
        }
        try {
            this.serverProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 3000);
                this.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            this.isRunning = false;
            this.serverProcess = null;
            return { success: true, message: '✅ MCP Server 已停止' };
        }
        catch (e) {
            return { success: false, message: `❌ 停止失败: ${e.message}` };
        }
    }
    /**
     * 调用 MCP 工具
     */
    async callTool(toolName, args) {
        if (!this.isRunning) {
            return { success: false, error: 'MCP Server 未运行，请先调用 pascal_start' };
        }
        try {
            // 通过 HTTP 调用 MCP Server
            const response = await fetch(`http://localhost:${this.port}/tools/${toolName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args),
            });
            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `工具调用失败: ${error}` };
            }
            const data = await response.json();
            return { success: true, data };
        }
        catch (e) {
            return { success: false, error: `调用异常: ${e.message}` };
        }
    }
    /**
     * 创建墙体
     */
    async createWall(args) {
        const result = await this.callTool('create_wall', args);
        if (result.success && result.data?.id) {
            return { success: true, wallId: result.data.id };
        }
        return { success: false, error: result.error };
    }
    /**
     * 放置门窗
     */
    async placeOpening(args) {
        const result = await this.callTool('place_opening', args);
        if (result.success && result.data?.id) {
            return { success: true, openingId: result.data.id };
        }
        return { success: false, error: result.error };
    }
    /**
     * 生成屋顶
     */
    async generateRoof(args) {
        const result = await this.callTool('generate_roof', args);
        if (result.success && result.data?.id) {
            return { success: true, roofId: result.data.id };
        }
        return { success: false, error: result.error };
    }
    /**
     * 创建楼层
     */
    async createFloor(args) {
        const result = await this.callTool('create_floor', args);
        if (result.success && result.data?.id) {
            return { success: true, floorId: result.data.id };
        }
        return { success: false, error: result.error };
    }
    /**
     * 导出模型
     */
    async exportModel(args) {
        const result = await this.callTool('export_model', args);
        if (result.success && result.data?.path) {
            return { success: true, filePath: result.data.path };
        }
        return { success: false, error: result.error };
    }
    /**
     * 导入 IFC 模型
     */
    async importIFC(args) {
        const result = await this.callTool('import_ifc', args);
        if (result.success && result.data?.modelId) {
            return { success: true, modelId: result.data.modelId };
        }
        return { success: false, error: result.error };
    }
    /**
     * 获取当前建筑模型
     */
    async getCurrentModel() {
        const result = await this.callTool('get_model', {});
        if (result.success && result.data) {
            return { success: true, model: result.data };
        }
        return { success: false, error: result.error };
    }
    /**
     * 检查服务器状态
     */
    getStatus() {
        return {
            running: this.isRunning,
            port: this.port,
            workspace: this.workspace,
        };
    }
}
// 单例导出
export const pascalEditor = new PascalEditorManager();
