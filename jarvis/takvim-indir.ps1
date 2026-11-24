# ayarlar.js icindeki TAKVIM_URL adres(ler)ini indirip takvim.js dosyasina yazar.
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'ayarlar.js')

if ($cfg -match '(?m)^\s*TAKVIM_URL\s*:\s*"([^"]*)"') {
  $urls = $Matches[1] -split ',' | ForEach-Object { $_.Trim() -replace '^webcal://', 'https://' } | Where-Object { $_ }
  if (-not $urls) { exit }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $all = New-Object System.Collections.Generic.List[byte]
  foreach ($u in $urls) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 15
      $all.AddRange($r.RawContentStream.ToArray())
      $all.AddRange([byte[]](13, 10))
    } catch { }
  }
  if ($all.Count -gt 0) {
    $b64 = [Convert]::ToBase64String($all.ToArray())
    Set-Content -Encoding ASCII -Path (Join-Path $dir 'takvim.js') -Value ('window.TAKVIM_ICS_B64 = "' + $b64 + '";')
  }
}
