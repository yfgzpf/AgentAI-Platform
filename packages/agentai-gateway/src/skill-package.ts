/**
 * skill-package.ts — 技能包导入/导出 (2026-10-14 P1)
 * =====================================================
 * 对应 4 篇公众号文章落地方案 P1: agent-skills 周涨 4.9 万星 (技能包分发)。
 * 让"跑出来的好技能" 能像 npm 包一样跨 workspace / 跨项目复用。
 *
 * 设计:
 *   - 包格式: tar.gz (与 npm 包 .tgz 同构, 不引入新依赖)
 *   - 包内容: <skill>/SKILL.md + 可选 <skill>/reference/*.md + 可选 <skill>/handler.ts
 *   - 导入: 拉 URL / 读本地 .skill 文件 → 解压到 targetDir → 调 skillOrchestrator.scanDirectory
 *   - 导出: 把指定 skill 目录打包成 .skill 文件
 *
 * 安全: 导入的包**只**写文件, 不执行包内任何代码 (handler.ts 等由
 * skill-orchestrator 现有的 AST 安全扫描把关, 不在本模块引入新风险)。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as os from 'os';

export interface ImportResult {
  success: boolean;
  skillDir: string;
  skillsFound: number;
  message: string;
}

export interface ExportResult {
  success: boolean;
  archivePath: string;
  skillName: string;
  message: string;
}

/**
 * 从 URL (http/https) 或本地文件路径导入技能包。
 * @param source URL 或本地 .skill / .tgz 文件路径
 * @param targetDir 解压目标 (默认: .agentai/skills/{source-skill-name}/)
 * @param skillOrchestrator 技能编排器实例 (导入后自动 scanDirectory 注册)
 */
export async function importSkillPackage(
  source: string,
  targetDir: string,
  skillOrchestrator: { scanDirectory: (d: string) => number },
): Promise<ImportResult> {
  // 1. 拉包到临时文件
  const tmpPath = path.join(os.tmpdir(), `skill-pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    if (/^https?:\/\//i.test(source)) {
      // URL 拉取
      const resp = await fetch(source, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) return { success: false, skillDir: '', skillsFound: 0, message: `❌ 拉包失败: HTTP ${resp.status} (${source.slice(0, 100)})` };
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(tmpPath, buf);
    } else if (fs.existsSync(source)) {
      fs.copyFileSync(source, tmpPath);
    } else {
      return { success: false, skillDir: '', skillsFound: 0, message: `❌ 源不存在: ${source}` };
    }
  } catch (e: any) {
    return { success: false, skillDir: '', skillsFound: 0, message: `❌ 拉包失败: ${e.message}` };
  }

  // 2. 解压到 targetDir (tar.gz, 逐行读 tar header)
  let extractedFiles = 0;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    extractedFiles = extractTarGz(tmpPath, targetDir);
    if (extractedFiles === 0) {
      return { success: false, skillDir: targetDir, skillsFound: 0, message: '❌ 包里没有找到文件 (或包格式错误, 需含 SKILL.md)' };
    }
  } catch (e: any) {
    return { success: false, skillDir: targetDir, skillsFound: 0, message: `❌ 解压失败: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* tmp cleanup optional */ }
  }

  // 3. 调 skillOrchestrator 扫描注册
  let skillsFound = 0;
  try {
    skillsFound = skillOrchestrator.scanDirectory(targetDir);
  } catch { /* scan 失败不致命, 用户可手动重启 gateway */ }

  return {
    success: true,
    skillDir: targetDir,
    skillsFound,
    message: `✅ 已导入 ${extractedFiles} 个文件到 ${targetDir}${skillsFound > 0 ? ` (注册了 ${skillsFound} 个技能, smartDispatch 可路由)` : ' (建议重启 gateway 让 scanDirectory 重新扫描)'}`,
  };
}

/**
 * 导出指定技能目录为 .skill 包 (tar.gz)。
 * @param skillDir 技能目录 (含 SKILL.md)
 * @param outPath 输出 .skill 文件路径 (默认: .agentai/skill-packages/{name}.skill)
 */
export async function exportSkillPackage(
  skillDir: string,
  outPath?: string,
): Promise<ExportResult> {
  const skillName = path.basename(skillDir.trim());
  if (!fs.existsSync(skillDir) || !fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
    return { success: false, archivePath: '', skillName, message: `❌ 不是技能目录 (缺 SKILL.md): ${skillDir}` };
  }
  const archivePath = outPath || path.join('.agentai', 'skill-packages', `${skillName}.skill`);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  try {
    const tar = packTar(skillDir, skillName);
    const gz = zlib.gzipSync(tar);
    fs.writeFileSync(archivePath, gz);
    return {
      success: true,
      archivePath,
      skillName,
      message: `✅ 已导出 ${skillName} 到 ${archivePath} (${(gz.length / 1024).toFixed(1)} KB), 可发给其他 workspace / 项目使用`,
    };
  } catch (e: any) {
    return { success: false, archivePath, skillName, message: `❌ 打包失败: ${e.message}` };
  }
}

// ===== 内部工具: 极简 tar.gz 读写 (POSIX ustar, 不依赖外部包) =====

/** 把目录打成 tar (内存 Buffer), 不写 .tar 中间文件 */
function packTar(dir: string, prefix: string): Buffer {
  const chunks: Buffer[] = [];
  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, entry.name);
      const rel = path.join(prefix, path.relative(dir, full));
      if (entry.isDirectory()) {
        // 目录 entry
        chunks.push(tarEntry(rel + '/', 0, 0, 0o755));
        walk(full);
      } else {
        const stat = fs.statSync(full);
        chunks.push(tarEntry(rel, stat.size, stat.ino, 0o644));
        chunks.push(fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  // 结束 marker: 2 个 512B 全 0 块
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarEntry(name: string, size: number, uid: number, mode: number): Buffer {
  const hdr = Buffer.alloc(512);
  hdr.write(name.slice(0, 100), 0, 'utf8');            // name
  hdr.write(mode.toString(8).padStart(6, '0'), 100, 'utf8');  // mode
  hdr.write(uid.toString(8).padStart(8, '0'), 108, 'utf8');   // uid
  hdr.write(uid.toString(8).padStart(8, '0'), 116, 'utf8');   // gid
  hdr.write(size.toString(8).padStart(11, '0'), 124, 'utf8'); // size
  hdr.write(Math.floor(Date.now() / 1000).toString(8).padStart(12, '0'), 136, 'utf8'); // mtime
  hdr.write('\0', 148);                                   // checksum placeholder
  hdr.write('0', 156);                                     // type: 0=regular / 5=dir
  hdr.write('ustar', 257, 'utf8');                        // magic
  hdr.write('00', 263, 'utf8');                            // version
  // checksum = sum of all bytes in header (treating checksum field as 8 spaces)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += hdr[i] === 0 ? 0x20 : hdr[i];
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
  return hdr;
}

/** 解压 tar.gz 到 dir, 返回文件数 */
function extractTarGz(tgzPath: string, destDir: string): number {
  const raw = fs.readFileSync(tgzPath);
  const buf = zlib.gunzipSync(raw);
  let offset = 0;
  let fileCount = 0;
  while (offset + 512 <= buf.length) {
    const name = buf.toString('utf8', offset, offset + 100).replace(/\0+$/, '');
    if (!name || name === '\0'.repeat(100)) break; // 结束
    const sizeStr = buf.toString('utf8', offset + 124, offset + 136).replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(buf[offset + 156]);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const roundUp = (n: number) => Math.ceil(n / 512) * 512;

    if (type === '5') {
      // 目录
      try { fs.mkdirSync(path.join(destDir, name), { recursive: true }); } catch { /* exists */ }
    } else if (type === '0' || type === '\0') {
      const target = path.join(destDir, name);
      // 防路径穿越: 目标必须在 destDir 内
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(destDir) + path.sep) && resolved !== path.resolve(destDir)) {
        throw new Error(`路径穿越被拒: ${name}`);
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, buf.subarray(dataStart, dataEnd));
      fileCount++;
    }
    offset = dataEnd + roundUp(size);
  }
  return fileCount;
}
