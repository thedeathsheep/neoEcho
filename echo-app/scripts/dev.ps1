# Echo Development Startup Script (Windows PowerShell)
# Usage: .\scripts\dev.ps1

param(
    [switch]$Tauri,
    [switch]$Web
)

$ErrorActionPreference = "Stop"

Write-Host "`n  Echo - Development Server`n" -ForegroundColor Cyan

if (-not (Test-Path ".env.development")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env.development"
        Write-Host "  [!] Created .env.development from .env.example" -ForegroundColor Yellow
        Write-Host "  [!] Please configure your AI_API_KEY in .env.development`n" -ForegroundColor Yellow
    }
}

if ($Tauri) {
    Write-Host "  Starting Tauri dev mode...`n" -ForegroundColor Green
    pnpm tauri:dev
} else {
    Write-Host "  Starting Next.js dev server...`n" -ForegroundColor Green
    pnpm dev
}
