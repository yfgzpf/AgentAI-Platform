; ============================================================
; PulseFlow NSIS Installer Hooks
; ============================================================
; 安装后自动检测并安装: Node.js / Python / WebView2 /
;                       Gateway 依赖(npm install) / VSCode 扩展
; ╔══════════════════════════════════════════════════════════╗
; ║ 构建一致性修复 (P0):                                    ║
; ║ 新增 Step 4: 调用 install-deps.bat 安装 Gateway 依赖   ║
; ║ (打包时可能因为环境限制未打包 node_modules, 安装时补上)║
; ╚══════════════════════════════════════════════════════════╝
; ============================================================

!macro NSIS_HOOK_POSTINSTALL
  ; ===== 1. 检测 Node.js =====
  Call DetectNodeJS
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[PulseFlow] ⏳ Node.js 未检测到, 开始下载安装 v22 LTS..."
    NSISdl::download "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi" "$TEMP\node-install.msi"
    Pop $R0
    ${If} $R0 == "success"
      DetailPrint "[PulseFlow] Node.js 下载完成, 正在安装..."
      ExecWait 'msiexec /i "$TEMP\node-install.msi" /qb- ADDLOCAL=ALL' $1
      ${If} $1 == 0
        DetailPrint "[PulseFlow] ✅ Node.js 安装成功"
      ${Else}
        DetailPrint "[PulseFlow] ⚠️ Node.js 安装失败 code=$1 (首次启动会再提示)"
      ${EndIf}
      Delete "$TEMP\node-install.msi"
    ${Else}
      DetailPrint "[PulseFlow] ⚠️ Node.js 下载失败, 首次启动会再引导安装"
    ${EndIf}
  ${Else}
    DetailPrint "[PulseFlow] ✅ Node.js 已安装: $0"
  ${EndIf}

  ; ===== 2. 检测 Python =====
  Call DetectPython
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[PulseFlow] ⏳ Python 未检测到, 开始下载安装 3.13..."
    NSISdl::download "https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe" "$TEMP\python-install.exe"
    Pop $R0
    ${If} $R0 == "success"
      DetailPrint "[PulseFlow] Python 下载完成, 正在安装..."
      ExecWait '"$TEMP\python-install.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0' $1
      ${If} $1 == 0
        DetailPrint "[PulseFlow] ✅ Python 安装成功"
      ${Else}
        DetailPrint "[PulseFlow] ⚠️ Python 安装失败 code=$1 (首次启动会再提示)"
      ${EndIf}
      Delete "$TEMP\python-install.exe"
    ${Else}
      DetailPrint "[PulseFlow] ⚠️ Python 下载失败, 首次启动会再引导安装"
    ${EndIf}
  ${Else}
    DetailPrint "[PulseFlow] ✅ Python 已安装: $0"
  ${EndIf}

  ; ===== 3. 检测 WebView2 (Tauri 依赖, Win10+ 自带) =====
  Call DetectWebView2
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[PulseFlow] ⏳ WebView2 未检测到, 开始下载安装..."
    NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\webview2-install.exe"
    Pop $R0
    ${If} $R0 == "success"
      ExecWait '"$TEMP\webview2-install.exe" /silent /install' $1
      Delete "$TEMP\webview2-install.exe"
      DetailPrint "[PulseFlow] ✅ WebView2 安装完成"
    ${Else}
      DetailPrint "[PulseFlow] ⚠️ WebView2 下载失败, 首次启动会再引导安装"
    ${EndIf}
  ${Else}
    DetailPrint "[PulseFlow] ✅ WebView2 已安装"
  ${EndIf}

  ; ===== 4. 安装 Gateway 依赖 (node_modules) =====
  ; 注意: 必须放在 Node.js 安装之后, 否则 npm 不可用
  DetailPrint "[PulseFlow] ⏳ 检查 Gateway 运行依赖..."
  SetOutPath "$INSTDIR\resources"
  nsExec::ExecToStack '"$INSTDIR\resources\scripts\install-deps.bat"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    DetailPrint "[PulseFlow] ✅ Gateway 依赖检查完成"
  ${Else}
    DetailPrint "[PulseFlow] ⚠️ Gateway 依赖检查返回 code=$0, 首次启动 UI 会自动重试"
  ${EndIf}

  ; ===== 5. 安装 VSCode 扩展 (如果用户机有 code.cmd) =====
  DetailPrint "[PulseFlow] ⏳ 检查 VSCode 扩展..."
  nsExec::ExecToStack 'where code.cmd'
  Pop $0
  ${If} $0 == 0
    Pop $1
    DetailPrint "[PulseFlow] 检测到 VSCode: $1"
    nsExec::ExecToStack 'code.cmd --install-extension "$INSTDIR\resources\agentai-vscode.vsix" --force'
    Pop $0
    ${If} $0 == 0
      DetailPrint "[PulseFlow] ✅ VSCode 扩展安装成功"
    ${Else}
      DetailPrint "[PulseFlow] ⚠️ VSCode 扩展安装失败 code=$0 (可忽略, 后续可手动安装 .vsix)"
    ${EndIf}
  ${Else}
    DetailPrint "[PulseFlow] ℹ️ VSCode 未安装, 跳过扩展安装"
  ${EndIf}

!macroend

; ===== 检测 Node.js =====
Function DetectNodeJS
  nsExec::ExecToStack 'node --version'
  Pop $0  ; exit code
  Pop $1  ; output
  ${If} $0 == 0
    Push $1
  ${Else}
    Push "0"
  ${EndIf}
FunctionEnd

; ===== 检测 Python =====
Function DetectPython
  nsExec::ExecToStack 'python --version'
  Pop $0
  Pop $1
  ${If} $0 == 0
    Push $1
  ${Else}
    ; 尝试 python3
    nsExec::ExecToStack 'python3 --version'
    Pop $0
    Pop $1
    ${If} $0 == 0
      Push $1
    ${Else}
      Push "0"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ===== 检测 WebView2 =====
Function DetectWebView2
  ; 查注册表判断是否安装
  nsExec::ExecToStack 'reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv'
  Pop $0
  Pop $1
  ${If} $0 == 0
    Push $1
  ${Else}
    ; 也检查 32 位注册表
    nsExec::ExecToStack 'reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv'
    Pop $0
    Pop $1
    ${If} $0 == 0
      Push $1
    ${Else}
      Push "0"
    ${EndIf}
  ${EndIf}
FunctionEnd
