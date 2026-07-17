import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillCodeGenerator, SkillCodeRequest } from './skill-code-generator.js';
import { AgentAIRouter } from './llm-router.js';

// Mock LLM Router
const mockLLMRouter = {
  chat: vi.fn(),
} as unknown as AgentAIRouter;

describe('SkillCodeGenerator', () => {
  let generator: SkillCodeGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new SkillCodeGenerator(mockLLMRouter);
  });

  describe('generate', () => {
    it('should generate code from skill description', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
\`\`\`javascript
async function skillHandler(args) {
  const { input } = args;
  const result = input.toUpperCase();
  return { success: true, output: result };
}
module.exports = skillHandler;
\`\`\`

说明: 将输入转换为大写
`,
      });

      const request: SkillCodeRequest = {
        name: 'uppercase-converter',
        description: '将文本转换为大写',
        category: 'text-processing',
      };

      const result = await generator.generate(request);

      expect(result.success).toBe(true);
      expect(result.code).toContain('async function');
      expect(result.code).toContain('success: true');
      expect(result.code).toContain('output:');
      expect(result.explanation).toContain('大写');
      expect(result.dependencies).toEqual([]);
    });

    it('should extract code from markdown code block', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
这是一个代码生成示例：

\`\`\`javascript
async function handler(args) {
  return { success: true, output: 'done' };
}
\`\`\`

希望对你有帮助！
`,
      });

      const request: SkillCodeRequest = {
        name: 'test-skill',
        description: '测试技能',
        category: 'test',
      };

      const result = await generator.generate(request);

      expect(result.code).toContain('async function handler');
      expect(result.code).not.toContain('这是一个代码');
    });

    it('should handle code without markdown block', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `async function handler(args) { return { success: true }; }`,
      });

      const request: SkillCodeRequest = {
        name: 'simple-skill',
        description: '简单技能',
        category: 'test',
      };

      const result = await generator.generate(request);

      expect(result.success).toBe(true);
      expect(result.code).toContain('async function');
    });

    it('should include parameters in prompt', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: '\`\`\`javascript\nasync function handler(args) { return { success: true }; }\n\`\`\`',
      });

      const request: SkillCodeRequest = {
        name: 'param-skill',
        description: '带参数的技能',
        category: 'test',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: '输入文本' },
            count: { type: 'number', description: '数量' },
          },
        },
      };

      await generator.generate(request);

      const callArgs = (mockLLMRouter.chat as any).mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('input');
      expect(callArgs.messages[1].content).toContain('count');
    });

    it('should include examples in prompt', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: '\`\`\`javascript\nasync function handler(args) { return { success: true }; }\n\`\`\`',
      });

      const request: SkillCodeRequest = {
        name: 'example-skill',
        description: '有示例的技能',
        category: 'test',
        examples: ['输入: "hello" → 输出: "HELLO"', '输入: "world" → 输出: "WORLD"'],
      };

      await generator.generate(request);

      const callArgs = (mockLLMRouter.chat as any).mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('hello');
      expect(callArgs.messages[1].content).toContain('WORLD');
    });

    it('should handle LLM error', async () => {
      mockLLMRouter.chat = vi.fn().mockRejectedValue(new Error('LLM API Error'));

      const request: SkillCodeRequest = {
        name: 'error-skill',
        description: '会出错的技能',
        category: 'test',
      };

      const result = await generator.generate(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM API Error');
      expect(result.code).toBe('');
    });

    it('should use correct model and temperature', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: '\`\`\`javascript\nasync function handler(args) { return { success: true }; }\n\`\`\`',
      });

      const request: SkillCodeRequest = {
        name: 'test-skill',
        description: '测试',
        category: 'test',
      };

      await generator.generate(request);

      const callArgs = (mockLLMRouter.chat as any).mock.calls[0][0];
      expect(callArgs.model).toBe('deepseek');
      expect(callArgs.temperature).toBe(0.3);
      expect(callArgs.maxTokens).toBe(2000);
    });
  });

  describe('validate', () => {
    it('should validate correct code', async () => {
      const code = `
        async function handler(args) {
          return { success: true, output: 'done' };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject code with syntax error', async () => {
      const code = `
        async function handler(args) {
          return { success: true, output: 'done'
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('语法错误');
    });

    it('should reject code with eval', async () => {
      const code = `
        async function handler(args) {
          eval(args.input);
          return { success: true };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('禁止');
    });

    it('should reject code with Function constructor', async () => {
      const code = `
        async function handler(args) {
          const fn = new Function(args.code);
          return { success: true };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
    });

    it('should reject code with child_process', async () => {
      const code = `
        async function handler(args) {
          const { exec } = require('child_process');
          exec(args.cmd);
          return { success: true };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
    });

    it('should reject code without success in return', async () => {
      const code = `
        async function handler(args) {
          return { output: 'done' };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('success');
    });

    it('should reject code without output in return', async () => {
      const code = `
        async function handler(args) {
          return { success: true };
        }
      `;

      const result = await generator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('output');
    });
  });

  describe('extractDependencies', () => {
    it('should detect fs dependency', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
\`\`\`javascript
const fs = require('fs');
async function handler(args) {
  const content = fs.readFileSync(args.path);
  return { success: true, output: content };
}
\`\`\``,
      });

      const request: SkillCodeRequest = {
        name: 'file-reader',
        description: '读取文件',
        category: 'file',
      };

      const result = await generator.generate(request);

      expect(result.dependencies).toContain('fs');
    });

    it('should detect path dependency', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
\`\`\`javascript
const path = require('path');
async function handler(args) {
  const fullPath = path.join(__dirname, args.file);
  return { success: true, output: fullPath };
}
\`\`\``,
      });

      const request: SkillCodeRequest = {
        name: 'path-joiner',
        description: '路径拼接',
        category: 'file',
      };

      const result = await generator.generate(request);

      expect(result.dependencies).toContain('path');
    });

    it('should detect fetch usage', async () => {
      mockLLMRouter.chat = vi.fn().mockResolvedValue({
        content: `
\`\`\`javascript
async function handler(args) {
  const response = await fetch(args.url);
  const data = await response.json();
  return { success: true, output: data };
}
\`\`\``,
      });

      const request: SkillCodeRequest = {
        name: 'http-fetcher',
        description: 'HTTP请求',
        category: 'network',
      };

      const result = await generator.generate(request);

      expect(result.dependencies).toContain('fetch (built-in)');
    });
  });
});
