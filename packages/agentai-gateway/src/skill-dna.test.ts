// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillDNAEvolution, SkillDNA, SkillGenome, HybridizationRequest } from './skill-dna.js';

describe('SkillDNAEvolution', () => {
  let evolution: SkillDNAEvolution;

  beforeEach(() => {
    evolution = new SkillDNAEvolution();
  });

  describe('extractDNA', () => {
    it('should extract capability DNA from skill code', () => {
      const code = `
        async function processPDF(args) {
          const { filePath } = args;
          const content = await fs.readFile(filePath);
          return { success: true, output: content };
        }
        module.exports = processPDF;
      `;

      const dnas = evolution.extractDNA('pdf-processor', code, 'PDF处理技能');

      expect(dnas.length).toBeGreaterThan(0);
      const capabilityDNA = dnas.find(d => d.type === 'capability');
      expect(capabilityDNA).toBeDefined();
      expect(capabilityDNA?.name).toContain('pdf-processor');
    });

    it('should extract pattern DNA from code patterns', () => {
      const code = `
        async function handler(args) {
          try {
            const result = await fetch(args.url);
            return { success: true, output: result };
          } catch (e) {
            return { success: false, output: e.message };
          }
        }
      `;

      const dnas = evolution.extractDNA('http-client', code, 'HTTP客户端');

      const patternDNAs = dnas.filter(d => d.type === 'pattern');
      expect(patternDNAs.length).toBeGreaterThan(0);
      // 应该检测到 async-await 和 error-handling 模式
    });

    it('should extract knowledge DNA from description', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const description = '使用正则表达式匹配文本模式，应用算法优化性能';

      const dnas = evolution.extractDNA('text-matcher', code, description);

      const knowledgeDNA = dnas.find(d => d.type === 'knowledge');
      expect(knowledgeDNA).toBeDefined();
    });

    it('should extract constraint DNA from validation code', () => {
      const code = `
        async function handler(args) {
          if (!args.input) throw new Error('Input required');
          if (args.input.length > 1000) throw new Error('Too long');
          return { success: true };
        }
      `;

      const dnas = evolution.extractDNA('validator', code, '验证器');

      const constraintDNA = dnas.find(d => d.type === 'constraint');
      expect(constraintDNA).toBeDefined();
    });

    it('should store extracted DNA in library', () => {
      const code = `module.exports = async () => ({ success: true });`;

      evolution.extractDNA('test-skill', code, '测试技能');

      const stats = evolution.getStats();
      expect(stats.totalDNA).toBeGreaterThan(0);
    });
  });

  describe('createGenome', () => {
    it('should create genome from DNA IDs', () => {
      // 先提取DNA
      const code = `
        async function handler(args) {
          return { success: true, output: 'done' };
        }
      `;
      const dnas = evolution.extractDNA('test-skill', code, '测试');
      const dnaIds = dnas.map(d => d.id);

      const genome = evolution.createGenome('genome-1', '测试基因组', dnaIds);

      expect(genome.skillId).toBe('genome-1');
      expect(genome.dnaFragments).toEqual(dnaIds);
      expect(genome.generation).toBe(1);
      expect(genome.fitness).toBe(0.5);
    });

    it('should update DNA usage stats', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const dnas = evolution.extractDNA('test-skill', code, '测试');
      const dnaIds = dnas.map(d => d.id);

      evolution.createGenome('genome-1', '测试基因组1', dnaIds);
      evolution.createGenome('genome-2', '测试基因组2', dnaIds);

      const stats = evolution.getStats();
      expect(stats.totalGenomes).toBe(2);
    });
  });

  describe('hybridize', () => {
    it('should create hybrid from parent skills', () => {
      // 创建父代技能
      const code1 = `module.exports = async () => ({ success: true, output: 'pdf' });`;
      const code2 = `module.exports = async () => ({ success: true, output: 'excel' });`;
      
      const dnas1 = evolution.extractDNA('pdf-skill', code1, 'PDF处理');
      const dnas2 = evolution.extractDNA('excel-skill', code2, 'Excel处理');
      
      evolution.createGenome('pdf-genome', 'PDF基因组', dnas1.map(d => d.id));
      evolution.createGenome('excel-genome', 'Excel基因组', dnas2.map(d => d.id));

      // 杂交
      const request: HybridizationRequest = {
        parentSkillIds: ['pdf-genome', 'excel-genome'],
        targetCapability: 'document-converter',
      };

      const result = evolution.hybridize(request);

      expect(result.success).toBe(true);
      expect(result.newGenome).toBeDefined();
      expect(result.parents).toContain('pdf-genome');
      expect(result.parents).toContain('excel-genome');
      expect(result.dnaUsed.length).toBeGreaterThan(0);
      expect(result.estimatedFitness).toBeGreaterThan(0);
    });

    it('should return error when parents not found', () => {
      const request: HybridizationRequest = {
        parentSkillIds: ['non-existent-1', 'non-existent-2'],
        targetCapability: 'test',
      };

      const result = evolution.hybridize(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('找不到父代技能');
    });

    it('should apply mutations to hybrid', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const dnas = evolution.extractDNA('skill', code, '技能');
      evolution.createGenome('genome', '基因组', dnas.map(d => d.id));

      const request: HybridizationRequest = {
        parentSkillIds: ['genome'],
        targetCapability: 'enhanced-skill',
      };

      const result = evolution.hybridize(request);

      expect(result.mutations.length).toBeGreaterThan(0);
      expect(result.mutations.some(m => m.type === 'add')).toBe(true);
    });
  });

  describe('mutate', () => {
    it('should optimize complex DNA', () => {
      // 创建复杂技能
      const complexCode = `
        async function complexHandler(args) {
          // 复杂逻辑
          const step1 = await doSomething();
          const step2 = await doAnotherThing();
          const step3 = await doMore();
          const step4 = await doEvenMore();
          return { success: true };
        }
      `;
      const dnas = evolution.extractDNA('complex-skill', complexCode, '复杂技能');
      evolution.createGenome('complex-genome', '复杂基因组', dnas.map(d => d.id));

      const mutations = evolution.mutate('complex-genome', 'optimize');

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === 'modify')).toBe(true);
    });

    it('should simplify when too many DNA fragments', () => {
      // 创建有很多DNA的技能
      const code = `module.exports = async () => ({ success: true });`;
      const allDnas: string[] = [];
      
      for (let i = 0; i < 6; i++) {
        const dnas = evolution.extractDNA(`skill-${i}`, code, `技能${i}`);
        allDnas.push(...dnas.map(d => d.id));
      }
      
      evolution.createGenome('bloated-genome', '臃肿基因组', allDnas);

      const mutations = evolution.mutate('bloated-genome', 'simplify');

      expect(mutations.some(m => m.type === 'remove')).toBe(true);
    });

    it('should extend with new capabilities', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const dnas = evolution.extractDNA('skill', code, '技能');
      evolution.createGenome('genome', '基因组', dnas.map(d => d.id));

      const mutations = evolution.mutate('genome', 'extend');

      expect(mutations.some(m => m.type === 'add')).toBe(true);
    });

    it('should increment generation after mutation', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const dnas = evolution.extractDNA('skill', code, '技能');
      evolution.createGenome('genome', '基因组', dnas.map(d => d.id));

      const initialGen = (evolution as any).genomes.get('genome').generation;
      evolution.mutate('genome', 'optimize');
      const newGen = (evolution as any).genomes.get('genome').generation;

      expect(newGen).toBe(initialGen + 1);
    });
  });

  describe('evaluateFitness', () => {
    it('should calculate fitness from execution stats', () => {
      const code = `module.exports = async () => ({ success: true });`;
      const dnas = evolution.extractDNA('skill', code, '技能');
      evolution.createGenome('genome', '基因组', dnas.map(d => d.id));

      const fitness = evolution.evaluateFitness('genome', {
        successRate: 0.9,
        avgLatency: 500,
        userSatisfaction: 0.8,
      });

      expect(fitness).toBeGreaterThan(0);
      expect(fitness).toBeLessThanOrEqual(1);
    });

    it('should return 0 for non-existent genome', () => {
      const fitness = evolution.evaluateFitness('non-existent', {
        successRate: 0.9,
        avgLatency: 100,
        userSatisfaction: 0.9,
      });

      expect(fitness).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      // 创建一些DNA和基因组
      const code = `module.exports = async () => ({ success: true });`;
      
      for (let i = 0; i < 3; i++) {
        const dnas = evolution.extractDNA(`skill-${i}`, code, `技能${i}`);
        evolution.createGenome(`genome-${i}`, `基因组${i}`, dnas.map(d => d.id));
      }

      const stats = evolution.getStats();

      expect(stats.totalDNA).toBeGreaterThan(0);
      expect(stats.totalGenomes).toBe(3);
      expect(stats.dnaByType).toBeDefined();
      expect(stats.avgReusability).toBeGreaterThanOrEqual(0);
      expect(stats.topDNA).toBeInstanceOf(Array);
    });

    it('should categorize DNA by type', () => {
      const code = `
        async function handler(args) {
          try {
            return { success: true };
          } catch (e) {
            return { success: false };
          }
        }
      `;
      evolution.extractDNA('skill', code, '使用正则表达式处理文本');

      const stats = evolution.getStats();

      expect(Object.keys(stats.dnaByType).length).toBeGreaterThan(0);
    });
  });

  describe('DNA metadata', () => {
    it('should track dependencies correctly', () => {
      const code = `
        const fs = require('fs');
        const path = require('path');
        module.exports = async () => ({ success: true });
      `;

      const dnas = evolution.extractDNA('skill-with-deps', code, '有依赖的技能');
      const capabilityDNA = dnas.find(d => d.type === 'capability');

      expect(capabilityDNA?.metadata.dependencies).toContain('fs');
      expect(capabilityDNA?.metadata.dependencies).toContain('path');
    });

    it('should assess complexity correctly', () => {
      const simpleCode = `module.exports = async () => ({ success: true });`;
      const complexCode = `
        async function complex() {
          const a = await step1();
          const b = await step2();
          const c = await step3();
          const d = await step4();
          const e = await step5();
          return { success: true, data: { a, b, c, d, e } };
        }
        module.exports = complex;
      `;

      const simpleDnas = evolution.extractDNA('simple', simpleCode, '简单');
      const complexDnas = evolution.extractDNA('complex', complexCode, '复杂');

      const simpleCap = simpleDnas.find(d => d.type === 'capability');
      const complexCap = complexDnas.find(d => d.type === 'capability');

      expect(simpleCap?.metadata.complexity).toBe('simple');
      expect(complexCap?.metadata.complexity).toBe('complex');
    });
  });
});
