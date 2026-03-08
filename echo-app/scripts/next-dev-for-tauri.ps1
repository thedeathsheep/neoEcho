# Start Next.js dev server for Tauri (cleans port 3000 and lock first)
$ErrorActionPreference = "Stop"

$Port = 3000
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$lockPath = [System.IO.Path]::Combine($projectRoot, ".next", "dev", "lock")

function Remove-NextDevLock {
  if (Test-Path $lockPath) {
    try {
      Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
      Write-Host "[Echo] Removed .next/dev/lock" -ForegroundColor Yellow
    } catch {
      Write-Host "[Echo] Failed to remove .next/dev/lock (will retry)" -ForegroundColor Yellow
    }
  }
}

function Stop-NextDevProcessesInProject {
  # Kill any "next dev" processes that point to this projectRoot (best-effort).
  try {
    $escapedRoot = $projectRoot.Replace('\', '\\')
    $procs = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -like "*next*dev*" -and
        ($_.CommandLine -like "*$projectRoot*" -or $_.CommandLine -like "*$escapedRoot*")
      }

    foreach ($p in $procs) {
      $procId = $p.ProcessId
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "[Echo] Stopped next dev process $procId" -ForegroundColor Yellow
    }
  } catch {
    # ignore
  }
}

function Free-Port($portNumber) {
  $conn = Get-NetTCPConnection -LocalPort $portNumber -ErrorAction SilentlyContinue
  if (-not $conn) { return }

  $procIds = $conn.OwningProcess | Sort-Object -Unique
  foreach ($procId in $procIds) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "[Echo] Stopped process $procId on port $portNumber" -ForegroundColor Yellow
  }
}

# 1) Stop leftover next dev processes (if any)
Stop-NextDevProcessesInProject

# 2) Free the port that Tauri expects
Free-Port $Port

# 3) Remove stale Next dev lock (after killing processes)
Remove-NextDevLock

# Small wait for OS to release file handles/ports
Start-Sleep -Milliseconds 500

# 4) Start Next.js on 3000 (Tauri expects this port)
Set-Location $projectRoot
& pnpm exec next dev --turbopack -p $Port
