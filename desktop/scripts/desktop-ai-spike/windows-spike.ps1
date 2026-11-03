# Windows half of the desktop AI spike (PR 1/6): run it in PowerShell on a PC that has the Claude desktop app; it needs no Jobadabra and no Claude account of ours.
# What it does: records the facts, tests Windows' own secret protection (DPAPI), opens the test helper file the way Jobadabra will, asks you 4 short questions,
# and writes spike-result.txt on your Desktop to send back. It never signs in, never changes Claude's settings, installs nothing by itself (you press Install in Claude's own dialog).
# Usage:  powershell -ExecutionPolicy Bypass -File .\windows-spike.ps1      (keep manifest.json and the server folder beside it, or put jobadabra-spike.mcpb beside it)
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'spike-result.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Say($t) { Write-Host $t; $lines.Add($t) }

Say "== Jobadabra spike, Windows, $(Get-Date -Format s) =="
Say "Windows: $([Environment]::OSVersion.VersionString), PowerShell $($PSVersionTable.PSVersion), .NET $([Runtime.InteropServices.RuntimeInformation]::FrameworkDescription)"

# 1. Is Claude Desktop here, and does Windows know the .mcpb file type?
$claude = @()
$claude += Get-ChildItem "$env:LOCALAPPDATA\AnthropicClaude", "$env:LOCALAPPDATA\Programs\claude*", "$env:LOCALAPPDATA\Claude" -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { $_.FullName }
$pkg = Get-AppxPackage -Name '*Claude*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pkg) { $claude += "Store package $($pkg.Name) $($pkg.Version)" }
Say "Claude Desktop found: $(if ($claude) { $claude -join '; ' } else { 'NO (install it first)' })"
$assoc = (cmd /c "assoc .mcpb" 2>&1) -join ' '
Say "File type .mcpb: $assoc"
$cmdKey = Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\.mcpb' -ErrorAction SilentlyContinue
Say "Registry .mcpb default: $(if ($cmdKey) { $cmdKey.'(default)' } else { '(none)' })"

# 2. Windows' own secret protection (DPAPI, current user), as the bridge would use it. The test value is random and never printed.
$secret = 'spike-' + [guid]::NewGuid().ToString('N')
try {
  $blob = $secret | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  $back = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR(($blob | ConvertTo-SecureString)))
  Say "DPAPI round trip: $(if ($back -eq $secret) { 'OK' } else { 'FAILED (value differs)' }); blob hides the value: $(if ($blob -notlike "*$secret*") { 'yes' } else { 'NO' })"
} catch { Say "DPAPI round trip: FAILED ($($_.Exception.Message))" }

# 3. Make the helper file, then open it the way the app will (the default program for .mcpb).
$mcpb = Join-Path $here 'jobadabra-spike.mcpb'
if (-not (Test-Path $mcpb)) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stage = Join-Path $env:TEMP ('jobadabra-spike-stage-' + [guid]::NewGuid().ToString('N'))   # a new folder only this run created, so the cleanup below can never touch anything else
  New-Item -ItemType Directory "$stage\server" | Out-Null
  Copy-Item (Join-Path $here 'manifest.json') $stage
  Copy-Item (Join-Path $here 'server\index.cjs') "$stage\server"
  $zip = Join-Path $env:TEMP 'jobadabra-spike.zip'
  Remove-Item $zip -ErrorAction SilentlyContinue
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
  Move-Item $zip $mcpb -Force
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Say "Built $mcpb from the folder."
}
Say "Opening $mcpb with the default program..."
Start-Process $mcpb
Write-Host ''
Write-Host 'Claude should now show an install window for "Jobadabra spike (safe to remove)". Look at it, then answer:'
$q1 = Read-Host 'Q1. Did a Claude install window appear by itself? (yes / no / Claude opened but no install window)'
$q2 = Read-Host 'Q2. What did the window list as permissions or tools? (type what you see, or "nothing")'
Write-Host 'Now press Install in that window. Then open a NEW chat in Claude and type: Use the ping tool from the Jobadabra spike.'
$q3 = Read-Host 'Q3. Before the tool ran, did Claude ask you to allow it? (yes, every time / yes, once / no)'
Write-Host 'Copy the tool result Claude shows (the JSON with platform, secretStore, loopback) and paste it as ONE line, or type "see file".'
$q4 = Read-Host 'Q4. Result'
Say "Q1 install window appeared: $q1"
Say "Q2 window listed: $q2"
Say "Q3 asked before the tool ran: $q3"
Say "Q4 ping result: $q4"

# 4. Clean up what the helper may have left, and tell the person how to remove it.
# The helper removes its own files; here only an EMPTY leftover folder of the helper is removed (never a folder with anything in it), then each path is checked and reported as it really is.
$spikeFolders = @((Join-Path $env:USERPROFILE '.jobadabra-spike'), (Join-Path $env:USERPROFILE '.jobadabra-spike-write'))
foreach ($f in $spikeFolders) { if ((Test-Path $f) -and -not (Get-ChildItem $f -Force -ErrorAction SilentlyContinue)) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
$still = $spikeFolders | Where-Object { Test-Path $_ }
Say "Left behind in your user folder: $(if ($still) { $still -join '; ' } else { 'none' })"
$lines | Set-Content -Encoding UTF8 $out
Write-Host ''
Write-Host "Done. Please send $out back. To remove the helper: Claude > Settings > Extensions > Jobadabra spike > Uninstall."
