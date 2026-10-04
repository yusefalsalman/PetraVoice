[CmdletBinding()]
param (
    [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   PetraVoice Demo: Cloudflare Quick Tunnel + QR Setup    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check if cloudflared is installed
Write-Host "`n[1/4] Checking for cloudflared..." -ForegroundColor Yellow

$cloudflaredExe = $null

$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cmd) {
    $cloudflaredExe = $cmd.Source
} else {
    $candidates = @(
        "$env:ProgramFiles (x86)\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
    )
    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            $cloudflaredExe = $cand
            break
        }
    }
}

$useNpxFallback = $false

if (-not $cloudflaredExe) {
    Write-Host "cloudflared not detected. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
        
        $candidates = @(
            "$env:ProgramFiles (x86)\cloudflared\cloudflared.exe",
            "$env:ProgramFiles\cloudflared\cloudflared.exe",
            "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
        )
        foreach ($cand in $candidates) {
            if (Test-Path $cand) {
                $cloudflaredExe = $cand
                break
            }
        }
    } catch {
        Write-Warning "winget installation failed or was cancelled."
    }

    if (-not $cloudflaredExe) {
        Write-Host "Using npx cloudflared as fallback..." -ForegroundColor Yellow
        $useNpxFallback = $true
    }
}

if ($cloudflaredExe) {
    Write-Host "[OK] Using cloudflared binary: $cloudflaredExe" -ForegroundColor Green
} else {
    Write-Host "[OK] Using npx cloudflared fallback" -ForegroundColor Green
}

# 2. Start the tunnel pointing to http://localhost:5173
Write-Host "`n[2/4] Starting tunnel pointing to http://localhost:$Port ..." -ForegroundColor Yellow

$demoDir = Join-Path $PSScriptRoot "demo"
$stdoutFile = [System.IO.Path]::GetTempFileName()
$stderrFile = [System.IO.Path]::GetTempFileName()
$capturedUrl = $null

function ReadSharedText($path) {
    try {
        if (-not (Test-Path $path)) { return "" }
        $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = [System.IO.StreamReader]::new($fs)
        $text = $sr.ReadToEnd()
        $sr.Close()
        $fs.Close()
        return $text
    } catch {
        return ""
    }
}

if ($useNpxFallback) {
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx --yes cloudflared tunnel --url http://localhost:$Port" -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru -NoNewWindow
} else {
    $proc = Start-Process -FilePath $cloudflaredExe -ArgumentList "tunnel --url http://localhost:$Port" -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru -NoNewWindow
}

try {
    # 3. Automatically capture the generated https://*.trycloudflare.com URL
    Write-Host "`n[3/4] Capturing generated https://*.trycloudflare.com URL..." -ForegroundColor Yellow
    $timeoutSec = 30
    $elapsed = 0
    while (-not $capturedUrl -and $elapsed -lt $timeoutSec -and -not $proc.HasExited) {
        foreach ($f in @($stderrFile, $stdoutFile)) {
            $content = ReadSharedText $f
            if ($content -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
                $capturedUrl = $Matches[0]
                break
            }
        }
        if ($capturedUrl) { break }
        Start-Sleep -Milliseconds 500
        $elapsed += 0.5
    }

    if (-not $capturedUrl) {
        throw "Failed to capture Cloudflare tunnel URL within $timeoutSec seconds."
    }

    Write-Host "[OK] Captured Tunnel URL: $capturedUrl" -ForegroundColor Green

    # Point the permanent link (https://yusefalsalman.github.io/PromptRider/) at this tunnel.
    node (Join-Path $demoDir 'publish-link.js') $capturedUrl

    # 4. Pass that tunnel URL into npm run qr -- inside demo directory
    Write-Host "`n[4/4] Printing QR code via demo directory (npm run qr -- $capturedUrl)...`n" -ForegroundColor Yellow
    Push-Location $demoDir
    try {
        npm run qr -- $capturedUrl
    } finally {
        Pop-Location
    }

    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "   Tunnel is LIVE! Keep this terminal open during demo    " -ForegroundColor Green
    Write-Host "   Judges can scan the QR code above or open:             " -ForegroundColor White
    Write-Host "   $capturedUrl                                           " -ForegroundColor Cyan
    Write-Host "   Press Ctrl+C to close the tunnel.                      " -ForegroundColor DarkGray
    Write-Host "==========================================================`n" -ForegroundColor Green

    while (-not $proc.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    if ($proc -and -not $proc.HasExited) {
        Write-Host "`nStopping Cloudflare tunnel..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $stdoutFile) { Remove-Item $stdoutFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stderrFile) { Remove-Item $stderrFile -Force -ErrorAction SilentlyContinue }
}
