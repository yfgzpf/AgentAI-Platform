/**
 * AI自操作系统核心工具处理器
 * ----------------------------------------------------
 * 实现AI主动获取密钥、联网查找接口地址、自动补全配置文件的能力
 */

export const discover_model_api_handler = async (args: any, ctx?: any) => {
  try {
    const { model_name, model_type, provider } = args;
    const fs = await import('fs/promises');
    const path = await import('path');

    // 1. 构建搜索查询
    const searchQuery = `${model_name} API 文档 官方 ${model_type === 'video' ? '视频生成' : model_type === 'image' ? '图像生成' : model_type}`;
    console.log(`[discover_model_api] 搜索: ${searchQuery}`);

    // 2. 联网搜索官方文档（调用web_search工具）
    // 注意：这里需要通过ctx调用其他工具，或者直接实现搜索逻辑
    // 简化版：返回提示信息，让AI调用web_search
    return {
      success: true,
      output: `🔍 需要联网查找${model_name}官方文档。\n\n请AI调用web_search工具搜索: "${searchQuery}"\n然后使用web_fetch抓取文档内容。\n最后使用write_file更新配置文件: ~/.agentai/config/MODEL_API_SPEC.md`,
      data: {
        model_name,
        model_type,
        provider,
        searchQuery,
        nextSteps: [
          '调用web_search搜索官方文档',
          '调用web_fetch抓取文档内容',
          '提取API接口地址、密钥获取方式、费用信息',
          '调用write_file更新MODEL_API_SPEC.md',
        ],
      },
    };
  } catch (e: any) {
    return { success: false, output: `discover_model_api 错误: ${e.message}` };
  }
};

export const save_api_key_handler = async (args: any, ctx?: any) => {
  try {
    const { key_name, key_value, trust, provider } = args;
    const fs = await import('fs/promises');
    const path = await import('path');

    // 1. 检查密钥格式（基本验证）
    if (!key_value || key_value.length < 10) {
      return { success: false, output: '密钥格式无效（长度不足）' };
    }

    // 2. 读取现有.env文件
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch {
      envContent = '# AgentAI 环境变量配置\n\n';
    }

    // 3. 检查是否已存在该密钥
    const existingKeyMatch = envContent.match(new RegExp(`^${key_name}=.*$`, 'm'));
    if (existingKeyMatch) {
      // 更新现有密钥
      envContent = envContent.replace(existingKeyMatch[0], `${key_name}=${key_value}`);
    } else {
      // 添加新密钥
      envContent += `\n${key_name}=${key_value}\n`;
    }

    // 4. 写入.env文件
    await fs.writeFile(envPath, envContent, 'utf-8');

    // 5. 更新环境变量（立即生效）
    process.env[key_name] = key_value;

    // 6. 如果用户勾选"信任此密钥"，添加到白名单
    if (trust) {
      const trustedPath = path.join(process.env.HOME || '~', '.agentai', 'trusted_keys.json');
      let trustedKeys: any[] = [];
      try {
        trustedKeys = JSON.parse(await fs.readFile(trustedPath, 'utf-8'));
      } catch {
        trustedKeys = [];
      }
      trustedKeys.push({
        key_name,
        provider: provider || 'unknown',
        added_at: new Date().toISOString(),
        trusted: true,
      });
      await fs.mkdir(path.dirname(trustedPath), { recursive: true });
      await fs.writeFile(trustedPath, JSON.stringify(trustedKeys, null, 2), 'utf-8');
    }

    return {
      success: true,
      output: `✅ 密钥已保存！\n\n密钥名: ${key_name}\n保存位置: ${envPath}\n信任状态: ${trust ? '已添加到信任白名单，后续不再询问' : '未添加到白名单'}\n\n密钥已立即生效，可直接使用。`,
      data: {
        key_name,
        envPath,
        trusted: trust,
      },
    };
  } catch (e: any) {
    return { success: false, output: `save_api_key 错误: ${e.message}` };
  }
};