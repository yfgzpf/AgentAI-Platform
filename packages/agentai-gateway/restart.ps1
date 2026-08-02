$used = $null
try { $used = (Get-NetTCPConnection -LocalPort 18789 -ErrorAction Stop).OwningProcess } catch {}
if ($used) { Stop-Process -Id $used -Force; Start-Sleep 2 }
Set-Location "F:\agentai-platform\packages\agentai-gateway"
node dist/index.js
