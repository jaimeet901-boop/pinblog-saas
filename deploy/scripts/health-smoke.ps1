param(
  [string]$BaseUrl = "https://localhost"
)

$healthUrl = ($BaseUrl.TrimEnd('/')) + "/api/health"
Write-Host "Checking $healthUrl"

try {
  $resp = Invoke-RestMethod -Uri $healthUrl -Method Get -SkipCertificateCheck
} catch {
  Write-Error "Health request failed: $($_.Exception.Message)"
  exit 1
}

if (-not $resp.status) {
  Write-Error "Missing status field"
  exit 1
}

if (-not $resp.services) {
  Write-Error "Missing services field"
  exit 1
}

Write-Host "Health smoke check passed"
