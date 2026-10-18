$used = $null
try { $used = (Get-NetTCPConnection -LocalPort 18789 -ErrorAction Stop).OwningProcess } catch {}
if ($used) { Stop-Process -Id $used -Force; Start-Sleep 2 }
# 2026-10-18: 去掉写死的 F:\ —— 用脚本自身所在目录, 换盘符/换机器都能跑
Set-Location -LiteralPath $PSScriptRoot
node dist/index.js
