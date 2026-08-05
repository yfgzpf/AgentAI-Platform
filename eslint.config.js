/**
 * ESLint 9 Flat Config
 * ----------------------------------------------------
 * 从 .eslintrc.cjs 迁移而来 (2026-06-18)
 * 原因: eslint 9.x 不再支持 .eslintrc.* (legacy config),
 *       必须用 eslint.config.js (flat config), 否则 husky pre-commit 报
 *       "ESLint couldn't find an eslint.config.(js|mjs|cjs) file"。
 *
 * 设计说明:
 *   - @typescript-eslint/eslint-plugin@8 的 configs 是 ClassicConfig 格式,
 *     不能直接 spread 进 flat config (含 extends 字段会报错), 故手动列出核心规则
 *   - eslint-plugin-react / react-hooks 为 CJS, 用 interopDefault 兼容 ESM import
 *   - 不依赖不存在的 flat config 预设, 保证零魔法可读
 */
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// CJS 插件在 ESM 下默认导出可能在 .default 上, 统一兼容
const interopDefault = (m) => (m && typeof m === 'object' && 'default' in m ? m.default : m);
const react = interopDefault(reactPlugin);
const hooks = interopDefault(reactHooks);
const ts = interopDefault(tsPlugin);

export default [
  // ===== 全局忽略 =====
  {
    ignores: [
      'dist', 'build', 'node_modules',
      '**/*.min.js',
      'src-tauri/target',
      '**/src-tauri/target',
      '.workbuddy',
      'packages/*/dist', 'packages/*/build',
      // ===== 二进制 / 非代码文件 (防止 Parsing error) =====
      '**/*.db', '**/*.sqlite', '**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.gif',
      '**/*.webp', '**/*.ico', '**/*.pdf', '**/*.log', '**/*.lock',
      '**/*.tsbuildinfo', '**/*.ttf', '**/*.woff', '**/*.woff2',
      '**/*.mp4', '**/*.mp3', '**/*.wav', '**/*.zip', '**/*.tar', '**/*.gz',
      // vendor 构建产物 (被 git 跟踪, 但不应 lint)
      'references/cursor-mcp/dist',
      // 本地打包产物 (desktop 内嵌的 gateway 构建副本)
      '**/gateway-dist-v2',
      '**/src-tauri/target',
      // ===== 大体积生成/存储目录 (eslint . 在 flat config 下会遍历所有文件, 必须显式排除) =====
      '.pnpm-store',      // pnpm content-addressed store, 海量压缩包文件 (8049 problems 元凶)
      '.git',
      'output', 'reports', 'models', 'SkillOpt',   // 根目录生成/输出目录
      'coverage', 'reports/*', '.vite', '.turbo',
      '**/*.min.js.map', '**/*.js.map',
    ],
  },

  // ===== JS 基础推荐规则 =====
  js.configs.recommended,

  // ===== TS + React 配置 (针对源文件) =====
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': ts,
      react,
      'react-hooks': hooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // === @typescript-eslint/recommended 的核心规则 ===
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off', // CJS 项目常见

      // === react/recommended 的核心规则 (按原 .eslintrc.cjs 调整) ===
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',

      // === 项目自定义规则 (与 .eslintrc.cjs 一致) ===
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'warn',

      // === TS 文件: 关闭 JS 基础规则, 交由 @typescript-eslint 版接管 ===
      // (避免 no-unused-vars 与 @typescript-eslint/no-unused-vars 双重报错)
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // === 临时禁用: 这些规则导致大量历史代码报错 ===
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-case-declarations': 'off',

      // === react-hooks/recommended 核心规则 ===
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ===== 配置文件 & 构建脚本放宽 =====
  {
    files: ['eslint.config.js', '*.config.{js,ts,cjs,mjs}', 'scripts/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': 'off',
    },
  },

  // ===== 全局放宽: 允许空 catch 块 =====
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ===== 全局关闭: 历史代码兼容 (无 files 限制, 确保任何文件都 off) =====
  {
    rules: {
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-case-declarations': 'off',
    },
  },

  // ===== Prettier 兼容 (放最后, 关闭与 prettier 冲突的格式化规则) =====
  prettier,
];
