<#
.SYNOPSIS
  Despliega la arquitectura Medallion (fabric/kql/01-03) en un Eventhouse de Fabric usando TU sesion de az.
  Alternativa sin service principal al CI/CD automatico. Los scripts KQL son idempotentes.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File fabric\scripts\desplegar_kql.ps1 -Entorno test
  powershell -ExecutionPolicy Bypass -File fabric\scripts\desplegar_kql.ps1 -Entorno prd

.NOTES
  Requiere: az login (cuenta con permiso en el workspace) y fabric\entornos.local.json (no se versiona):
  { "test": { "queryUri": "https://<cluster>.kusto.fabric.microsoft.com", "database": "eh_finanzas" },
    "prd":  { "queryUri": "https://<cluster>.kusto.fabric.microsoft.com", "database": "eh_finanzas" } }
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("test", "prd")][string]$Entorno,
  [switch]$SoloVerificar
)

$raiz = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $raiz "entornos.local.json"
if (-not (Test-Path $cfgPath)) { throw "Falta $cfgPath (copia entornos.local.json.example y completa los queryUri)." }
$cfg = (Get-Content $cfgPath -Raw | ConvertFrom-Json).$Entorno
if (-not $cfg) { throw "No hay configuracion para el entorno '$Entorno' en $cfgPath" }

if ($Entorno -eq "prd" -and -not $SoloVerificar) {
  $ok = Read-Host "Vas a desplegar en PRODUCCION ($($cfg.queryUri)). Escribe PRD para continuar"
  if ($ok -ne "PRD") { Write-Host "Cancelado."; exit 1 }
}

$token = az account get-access-token --resource "https://kusto.kusto.windows.net" --query accessToken -o tsv
if ($LASTEXITCODE -ne 0 -or -not $token) { throw "No se pudo obtener token de Kusto. Ejecuta 'az login'." }
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Kusto([string]$csl, [string]$tipo) {
  $body = @{ db = $cfg.database; csl = $csl } | ConvertTo-Json -Compress
  $req = [System.Net.HttpWebRequest]::Create("$($cfg.queryUri)/v1/rest/$tipo")
  $req.Method = "POST"; $req.ContentType = "application/json; charset=utf-8"
  $req.Headers.Add("Authorization", "Bearer $token"); $req.ServicePoint.Expect100Continue = $false
  $bytes = $utf8.GetBytes($body); $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  try {
    $resp = $req.GetResponse(); $txt = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); $resp.Close()
    return ($txt | ConvertFrom-Json)
  } catch [System.Net.WebException] {
    $err = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
    throw "Kusto respondio error: $err"
  }
}

# Separa un .kql en comandos de control (cada uno empieza con "." en la columna 0; se ignoran comentarios //)
function Get-Comandos([string]$archivo) {
  $cmds = @(); $actual = $null
  foreach ($l in [System.IO.File]::ReadAllLines($archivo, $utf8)) {
    if ($l -match '^\s*//') { continue }
    if ($l -match '^\.') { if ($actual) { $cmds += , ($actual -join "`n").Trim() }; $actual = New-Object System.Collections.Generic.List[string] }
    if ($null -ne $actual) { $actual.Add($l) }
  }
  if ($actual) { $cmds += , ($actual -join "`n").Trim() }
  return $cmds
}

if (-not $SoloVerificar) {
  foreach ($nombre in "01_bronze.kql", "02_silver.kql", "03_gold.kql") {
    Write-Host "== $nombre" -ForegroundColor Cyan
    $i = 0
    foreach ($c in Get-Comandos (Join-Path $raiz "kql\$nombre")) {
      $i++; $titulo = ($c -split "`n")[0]; if ($titulo.Length -gt 80) { $titulo = $titulo.Substring(0, 80) + "..." }
      Invoke-Kusto $c "mgmt" | Out-Null
      Write-Host ("  [{0}] OK  {1}" -f $i, $titulo)
    }
  }
}

Write-Host "== Verificacion ($Entorno)" -ForegroundColor Cyan
$v = Invoke-Kusto "print bronze = toscalar(raw_gastos | count), silver = toscalar(gastos_silver | count), vigentes = toscalar(fn_gastos_actuales() | count)" "query"
$t = $v.Tables[0]
for ($k = 0; $k -lt $t.Columns.Count; $k++) { Write-Host ("  {0,-10} {1}" -f $t.Columns[$k].ColumnName, $t.Rows[0][$k]) }
