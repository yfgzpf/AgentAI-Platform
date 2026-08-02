// @ts-nocheck
/**
 * MCP Skill Market Server
 * 
 * 通过MCP协议将SkillMarket暴露给AI
 * 让AI能够真正发现和获取技能
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getSkillMarketClient } from './skill-market-client.js';

// ═══════════════════════════════════════════════════════════
// MCP服务器配置
// ═══════════════════════════════════════════════════════════

const server = new Server(
  {
    name: 'skill-market-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ═══════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'search_skills',
    description: '在SkillMarket搜索技能。当用户需要某种能力但没有对应技能时，使用此工具搜索。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，如 "SEO", "automation", "data analysis"',
        },
        category: {
          type: 'string',
          description: '分类筛选，如 "data-ai", "devops", "marketing"',
        },
        limit: {
          type: 'number',
          description: '返回数量，默认10，最多100',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'discover_skill',
    description: '智能发现技能。当AI需要某个特定能力时，自动发现最佳匹配技能。这是首选的发现方式。',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: '需要的能力描述，如 "3D建模", "网页抓取", "数据分析"',
        },
        auto_install: {
          type: 'boolean',
          description: '是否自动安装发现的技能',
        },
      },
      required: ['capability'],
    },
  },
  {
    name: 'get_skill_detail',
    description: '获取技能详细信息。在决定安装前查看技能详情。',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: '技能ID',
        },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'install_skill',
    description: '安装指定技能。安装后AI获得该技能的能力。',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: '要安装的技能ID',
        },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'get_installed_skills',
    description: '获取已安装的技能列表。查看AI当前拥有的所有技能。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ═══════════════════════════════════════════════════════════
// 工具处理器
// ═══════════════════════════════════════════════════════════

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const client = getSkillMarketClient();
  const { name, arguments: args } = request.params;

  console.error(`[MCP] 调用工具: ${name}`, args);

  try {
    switch (name) {
      case 'search_skills': {
        const result = await client.searchSkills({
          query: args.query as string,
          category: args.category as string,
          pageSize: args.limit as number || 10,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                total: result.total,
                skills: result.skills.map(s => ({
                  id: s.id,
                  name: s.name,
                  author: s.author,
                  description: s.description?.slice(0, 200),
                  stars: s.stars,
                })),
              }, null, 2),
            },
          ],
        };
      }

      case 'discover_skill': {
        const discovery = await client.discoverSkillForCapability(args.capability as string);

        if (!discovery.found) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  found: false,
                  message: `未找到匹配 "${args.capability}" 的技能`,
                }, null, 2),
              },
            ],
          };
        }

        // 自动安装
        let installed = false;
        if (args.auto_install && discovery.skill) {
          const installResult = await client.installSkill(discovery.skill.id);
          installed = installResult.success;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                found: true,
                skill: discovery.skill ? {
                  id: discovery.skill.id,
                  name: discovery.skill.name,
                  description: discovery.skill.description,
                  author: discovery.skill.author,
                  stars: discovery.skill.stars,
                } : null,
                alternatives: discovery.alternatives?.map(s => ({
                  id: s.id,
                  name: s.name,
                })),
                installed,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_skill_detail': {
        const skill = await client.getSkillDetail(args.skill_id as string);

        if (!skill) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: '技能不存在',
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                skill: {
                  id: skill.id,
                  name: skill.name,
                  description: skill.description,
                  author: skill.author,
                  githubUrl: skill.githubUrl,
                  skillUrl: skill.skillUrl,
                  stars: skill.stars,
                  updatedAt: skill.updatedAt,
                },
              }, null, 2),
            },
          ],
        };
      }

      case 'install_skill': {
        const result = await client.installSkill(args.skill_id as string);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                message: result.message,
                skill_id: result.skillId,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_installed_skills': {
        const skills = client.getInstalledSkills();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: skills.length,
                skills: skills.map(s => ({
                  id: s.id,
                  name: s.name,
                  version: s.version,
                })),
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error: any) {
    console.error(`[MCP] 工具调用错误:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ═══════════════════════════════════════════════════════════
// 启动服务器
// ═══════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Skill Market MCP Server running on stdio');
}

main().catch(console.error);

export { server };
