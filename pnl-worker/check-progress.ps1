# TCL Sync Progress Checker
# Rulare: .\check-progress.ps1
# Rulare continua (refresh la 60s): .\check-progress.ps1 -Watch

param([switch]$Watch)

$WORKER_URL = "https://tcl-pnl-sync.axel4ro.workers.dev"
$MVX_TOTAL  = 354875

function Show-Progress {
    $s = Invoke-RestMethod -Uri "$WORKER_URL/api/status" -ErrorAction Stop

    $pct       = [math]::Round($s.total_transfers / $MVX_TOTAL * 100, 2)
    $ramas     = $MVX_TOTAL - $s.total_transfers
    $perOra    = 500 * 6
    $oreRamase = [math]::Round($ramas / $perOra, 1)
    $zileRamase= [math]::Round($oreRamase / 24, 1)
    $eta       = (Get-Date).AddHours($oreRamase).ToString("yyyy-MM-dd HH:mm")

    $barLen = 40
    $filled = [math]::Round($pct / 100 * $barLen)
    $bar    = ("#" * $filled) + ("-" * ($barLen - $filled))

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " TCL Sync Progress  $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " In Supabase : $($s.total_transfers) / $MVX_TOTAL ($pct%)"
    Write-Host " Backfill    : offset=$($s.backfill_offset)  done=$($s.backfill_done)"
    Write-Host " Newest date : $($s.newest_date)"
    Write-Host " [$bar] $pct%" -ForegroundColor Yellow
    if ($s.backfill_done -eq $true) {
        Write-Host " STATUS : COMPLET" -ForegroundColor Green
    } else {
        Write-Host " Ramas  : ~$ramas transferuri"
        Write-Host " ETA    : ~$zileRamase zile  (aprox $eta)" -ForegroundColor Magenta
    }
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

if ($Watch) {
    Write-Host "Mod Watch - refresh la 60s. Ctrl+C pentru stop." -ForegroundColor Gray
    while ($true) {
        Show-Progress
        Start-Sleep -Seconds 60
    }
} else {
    Show-Progress
}
