import { readFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const installer = resolve('f:/agentai-platform/packages/agentai-desktop/src-tauri/target/release/bundle/nsis/PulseFlow_0.1.0_x64-setup.exe');
const tempDir = join(tmpdir(), `pulseflow-verify-${Date.now()}`);

console.log('=== Verifying installer ===');
const st = statSync(installer);
console.log(`Path: ${installer}`);
console.log(`Size: ${(st.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Created: ${st.mtime.toISOString()}`);

mkdirSync(tempDir, { recursive: true });
const zipPath = join(tempDir, 'installer.zip');
execSync(`copy "${installer}" "${zipPath}"`, { stdio: 'inherit', shell: 'cmd.exe' });

try {
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${tempDir}')"`, { stdio: 'inherit' });
} catch (e) {
    console.error('Extract failed:', e.message);
    process.exit(1);
}

function findFiles(dir, regex) {
    const results = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) results.push(...findFiles(p, regex));
        else if (regex.test(f.name)) results.push(p);
    }
    return results;
}

const indexFiles = findFiles(tempDir, /^index-.*\.js$/).filter(p => p.includes('assets') && p.includes('js'));
console.log(`\nFound ${indexFiles.length} index-*.js files in dist/assets/js`);

const main = indexFiles
    .map(p => ({ p, size: statSync(p).size }))
    .sort((a, b) => b.size - a.size)[0];

if (main) {
    console.log(`Main bundle: ${main.p.split('\\').pop()} (${(main.size / 1024).toFixed(0)} KB)`);
    const c = readFileSync(main.p, 'utf8');

    const checks = [
        { n: 'NavGroupDropdown (maxHeight: 480)', p: /maxHeight:\s*480/ },
        { n: 'absolute positioning (replace antd Dropdown)', p: /position:\s*["']?absolute/ },
        { n: '--vscode-editor-background', p: /--vscode-editor-background/ },
        { n: '--vscode-input-background', p: /--vscode-input-background/ },
        { n: '--vscode-editorSuggestWidget', p: /--vscode-editorSuggestWidget/ },
        { n: '--vscode-sideBar-background', p: /--vscode-sideBar-background/ },
        { n: 'agentai.lastPage defensive init', p: /agentai\.lastPage/ },
        { n: 'Tauri transparent (component check)', p: /transparent/ },
        { n: 'PictureOutlined (media group icon)', p: /PictureOutlined/ },
        { n: 'VS Code diff colors', p: /--vscode-diffEditor/ },
        { n: 'VS Code tab styling', p: /--vscode-tab-activeBackground/ },
    ];
    console.log('\n=== Key fixes check ===');
    for (const chk of checks) {
        const m = c.match(new RegExp(chk.p.source, 'g'));
        const cnt = m ? m.length : 0;
        const status = cnt > 0 ? '[OK]' : '[--]';
        console.log(`  ${status} ${chk.n}: ${cnt} hits`);
    }
} else {
    console.log('No main bundle found');
}

rmSync(tempDir, { recursive: true, force: true });
console.log('\n=== Verification complete ===');
