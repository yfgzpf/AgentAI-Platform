; ============================================================
; Atlas NSIS Installer Hooks
; ============================================================
; 安装后自动检测 Node.js / Python, 缺失时静默下载安装
; ============================================================

!macro NSIS_HOOK_POSTINSTALL
  ; ===== 1. 检测 Node.js =====
  Call DetectNodeJS
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[Atlas] Node.js 未检测到, 开始下载安装..."
    ; 下载 Node.js v22 LTS
    NSISdl::download "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi" "$TEMP\node-install.msi"
    Pop $R0
    ${If} $R0 == "success"
      DetailPrint "[Atlas] Node.js 下载完成, 正在安装..."
      ExecWait 'msiexec /i "$TEMP\node-install.msi" /qb ADDLOCAL=ALL' $1
      ${If} $1 == 0
        DetailPrint "[Atlas] Node.js 安装成功"
      ${Else}
        DetailPrint "[Atlas] Node.js 安装失败 (code=$1), 请手动安装: https://nodejs.org"
      ${EndIf}
      Delete "$TEMP\node-install.msi"
    ${Else}
      DetailPrint "[Atlas] Node.js 下载失败, 请手动安装: https://nodejs.org"
    ${EndIf}
  ${Else}
    DetailPrint "[Atlas] Node.js 已安装: $0"
  ${EndIf}

  ; ===== 2. 检测 Python =====
  Call DetectPython
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[Atlas] Python 未检测到, 开始下载安装..."
    ; 下载 Python 3.13
    NSISdl::download "https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe" "$TEMP\python-install.exe"
    Pop $R0
    ${If} $R0 == "success"
      DetailPrint "[Atlas] Python 下载完成, 正在安装..."
      ; /quiet 静默安装, PrependPath=1 自动加入 PATH, InstallAllUsers=1 全局安装
      ExecWait '"$TEMP\python-install.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0' $1
      ${If} $1 == 0
        DetailPrint "[Atlas] Python 安装成功"
      ${Else}
        DetailPrint "[Atlas] Python 安装失败 (code=$1), 请手动安装: https://python.org"
      ${EndIf}
      Delete "$TEMP\python-install.exe"
    ${Else}
      DetailPrint "[Atlas] Python 下载失败, 请手动安装: https://python.org"
    ${EndIf}
  ${Else}
    DetailPrint "[Atlas] Python 已安装: $0"
  ${EndIf}

  ; ===== 3. 检测 WebView2 (Tauri 依赖, 一般 Win10+ 自带) =====
  Call DetectWebView2
  Pop $0
  ${If} $0 == "0"
    DetailPrint "[Atlas] WebView2 未检测到, 开始下载安装..."
    NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\webview2-install.exe"
    Pop $R0
    ${If} $R0 == "success"
      ExecWait '"$TEMP\webview2-install.exe" /silent /install' $1
      Delete "$TEMP\webview2-install.exe"
      DetailPrint "[Atlas] WebView2 安装完成"
    ${Else}
      DetailPrint "[Atlas] WebView2 下载失败, 请手动安装"
    ${EndIf}
  ${Else}
    DetailPrint "[Atlas] WebView2 已安装"
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
