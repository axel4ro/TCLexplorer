[CmdletBinding()]
param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\data\tcl-analytics.json")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$coinUrl = "https://api.cryptorank.io/v0/coins/the-cursed-land"
$quarterlyUrl = "https://api.cryptorank.io/v0/coins/the-cursed-land/quarterly-history"
$monthlyUrl = "https://api.cryptorank.io/v0/coins/the-cursed-land/monthly-history"
$listingDateOverride = "2024-06-13T00:00:00.000Z"

function Get-JsonFromUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 30 -Headers @{
      "User-Agent" = "TCLExplorerAnalyticsSync/1.0"
      "Accept" = "application/json"
    }
  } catch {
    throw "Failed to fetch $Url. $($_.Exception.Message)"
  }

  if ($null -eq $response) {
    throw "Empty response from $Url"
  }

  return $response
}

function Get-PercentChange {
  param(
    [double]$Open,
    [double]$Close
  )

  if ($Open -eq 0) {
    return $null
  }

  return [Math]::Round((($Close / $Open) - 1) * 100, 8)
}

function Get-Average {
  param(
    [double[]]$Values
  )

  if (-not $Values -or -not $Values.Count) {
    return $null
  }

  $average = ($Values | Measure-Object -Average).Average
  return [Math]::Round([double]$average, 2)
}

function Get-Median {
  param(
    [double[]]$Values
  )

  if (-not $Values -or -not $Values.Count) {
    return $null
  }

  $sorted = @($Values | Sort-Object)
  $middle = [Math]::Floor($sorted.Count / 2)

  if ($sorted.Count % 2 -eq 1) {
    return [Math]::Round([double]$sorted[$middle], 2)
  }

  return [Math]::Round(([double]$sorted[$middle - 1] + [double]$sorted[$middle]) / 2, 2)
}

function New-MatrixRow {
  param(
    [string]$Label,
    [object[]]$Cells
  )

  return [PSCustomObject]@{
    label = $Label
    cells = $Cells
  }
}

function Get-PropertyValue {
  param(
    [Parameter(Mandatory = $true)]
    [object]$InputObject,
    [Parameter(Mandatory = $true)]
    [string]$PropertyName
  )

  if ($null -eq $InputObject) {
    return $null
  }

  $property = $InputObject.PSObject.Properties[$PropertyName]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

$coin = (Get-JsonFromUrl -Url $coinUrl).data
$quarterlyData = (Get-JsonFromUrl -Url $quarterlyUrl).data
$monthlyData = (Get-JsonFromUrl -Url $monthlyUrl).data

$performanceMap = @(
  @{ label = "1W"; key = "7D" },
  @{ label = "1M"; key = "30D" },
  @{ label = "3M"; key = "3M" },
  @{ label = "6M"; key = "6M" },
  @{ label = "YTD"; key = "YTD" },
  @{ label = "1Y"; key = "1Y" }
)

$performance = foreach ($metric in $performanceMap) {
  $periodKey = [string]$metric.key
  $startPrice = [double]$coin.histPrices.$periodKey.USD
  $currentPrice = [double]$coin.price.USD
  $high = if ($coin.histData.high.PSObject.Properties.Name -contains $periodKey) { [double]$coin.histData.high.$periodKey.USD } else { $null }
  $low = if ($coin.histData.low.PSObject.Properties.Name -contains $periodKey) { [double]$coin.histData.low.$periodKey.USD } else { $null }
  $change = if ($startPrice -ne 0) { [Math]::Round($currentPrice - $startPrice, 12) } else { $null }
  $changePct = if ($startPrice -ne 0) { Get-PercentChange -Open $startPrice -Close $currentPrice } else { $null }

  [PSCustomObject]@{
    label = [string]$metric.label
    key = $periodKey
    startPrice = $startPrice
    currentPrice = $currentPrice
    change = $change
    changePct = $changePct
    high = $high
    low = $low
  }
}

$quarterColumns = @("Q1", "Q2", "Q3", "Q4")
$quarterlyReturnsRows = foreach ($entry in @($quarterlyData | Sort-Object year -Descending)) {
  $cells = foreach ($quarterIndex in 1..4) {
    $quarter = Get-PropertyValue -InputObject $entry -PropertyName "q$quarterIndex"
    if ($null -eq $quarter) {
      $null
      continue
    }

    Get-PercentChange -Open ([double]$quarter.openUSD) -Close ([double]$quarter.closeUSD)
  }

  New-MatrixRow -Label ([string]$entry.year) -Cells $cells
}

$quarterlyClosingRows = foreach ($entry in @($quarterlyData | Sort-Object year -Descending)) {
  $cells = foreach ($quarterIndex in 1..4) {
    $quarter = Get-PropertyValue -InputObject $entry -PropertyName "q$quarterIndex"
    if ($null -eq $quarter -or -not [bool]$quarter.isFull) {
      $null
      continue
    }

    [double]$quarter.closeUSD
  }

  New-MatrixRow -Label ([string]$entry.year) -Cells $cells
}

$monthColumns = @("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
$monthValuesByIndex = @{}
foreach ($monthIndex in 1..12) {
  $monthValuesByIndex[$monthIndex] = New-Object System.Collections.Generic.List[double]
}

$monthlyRows = foreach ($year in @($monthlyData.PSObject.Properties.Name | Sort-Object {[int]$_} -Descending)) {
  $yearData = Get-PropertyValue -InputObject $monthlyData -PropertyName $year
  $yearMonths = Get-PropertyValue -InputObject $yearData -PropertyName "months"
  $cells = foreach ($monthIndex in 1..12) {
    $monthEntry = Get-PropertyValue -InputObject $yearMonths -PropertyName "$monthIndex"
    if ($null -eq $monthEntry) {
      $null
      continue
    }

    $changePct = Get-PercentChange -Open ([double]$monthEntry.openUSD) -Close ([double]$monthEntry.closeUSD)
    if ($null -ne $changePct) {
      $monthValuesByIndex[$monthIndex].Add([double]$changePct)
    }

    $changePct
  }

  New-MatrixRow -Label ([string]$year) -Cells $cells
}

$averageCells = foreach ($monthIndex in 1..12) {
  $values = @($monthValuesByIndex[$monthIndex].ToArray())
  if (-not $values.Count) {
    $null
    continue
  }

  Get-Average -Values $values
}

$medianCells = foreach ($monthIndex in 1..12) {
  $values = @($monthValuesByIndex[$monthIndex].ToArray())
  if (-not $values.Count) {
    $null
    continue
  }

  Get-Median -Values $values
}

$outputPayload = [PSCustomObject]@{
  meta = [PSCustomObject]@{
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    source = "CryptoRank"
    endpoints = [PSCustomObject]@{
      coin = $coinUrl
      quarterly = $quarterlyUrl
      monthly = $monthlyUrl
    }
  }
  coin = [PSCustomObject]@{
    name = [string]$coin.name
    symbol = [string]$coin.symbol
    key = [string]$coin.key
    image = [PSCustomObject]@{
      x60 = [string]$coin.image.x60
      x150 = [string]$coin.image.x150
    }
  }
  market = [PSCustomObject]@{
    currentPriceUsd = [double]$coin.price.USD
    marketCapUsd = [double]$coin.marketCap
    volume24hUsd = [double]$coin.volume24h
    athPriceUsd = [double]$coin.athPrice.USD
    atlPriceUsd = [double]$coin.atlPrice.USD
    listingDate = $listingDateOverride
    historyStartDay = [string]$coin.historyStartDay
    historyEndDay = [string]$coin.historyEndDay
  }
  performance = $performance
  quarterlyReturns = [PSCustomObject]@{
    columns = $quarterColumns
    rows = $quarterlyReturnsRows
  }
  quarterlyClosing = [PSCustomObject]@{
    columns = $quarterColumns
    rows = $quarterlyClosingRows
  }
  monthlyReturns = [PSCustomObject]@{
    columns = $monthColumns
    rows = $monthlyRows
    summary = @(
      (New-MatrixRow -Label "Average" -Cells $averageCells),
      (New-MatrixRow -Label "Median" -Cells $medianCells)
    )
  }
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Path $resolvedOutputPath -Parent
$resolvedScriptOutputPath = Join-Path $outputDirectory "tcl-analytics.js"
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$serializedPayload = $outputPayload | ConvertTo-Json -Depth 8
$serializedPayload | Set-Content -LiteralPath $resolvedOutputPath -Encoding UTF8
("window.TCL_ANALYTICS_SNAPSHOT = " + $serializedPayload + ";") | Set-Content -LiteralPath $resolvedScriptOutputPath -Encoding UTF8

Write-Output "Updated analytics snapshot: $resolvedOutputPath"
Write-Output "Updated analytics script: $resolvedScriptOutputPath"
