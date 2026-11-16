# Finds files by words in the name through the Windows search index (fast).
# Prints one line of JSON, newest files first.
param(
  [string]$Query = "",
  [string]$Ext = "",
  [string]$Folders = "",       # semicolon-separated; default: Desktop, Documents, Downloads
  [int]$Max = 8
)
$ErrorActionPreference = "Stop"
function Esc([string]$s) { $s.Replace("'", "''").Replace("%", "").Replace("[", "").Replace("]", "") }
try {
  if (-not $Folders) {
    $Folders = (@('Desktop', 'MyDocuments') | ForEach-Object { [Environment]::GetFolderPath($_) }) -join ';'
    $Folders += ';' + (Join-Path $env:USERPROFILE 'Downloads')
  }
  $where = @()
  foreach ($word in ($Query -split '\s+' | Where-Object { $_ })) { $where += "System.FileName LIKE '%$(Esc $word)%'" }
  if ($Ext) {
    $exts = $Ext -split '[,; ]+' | Where-Object { $_ } | ForEach-Object { "System.FileExtension = '.$(Esc $_.TrimStart('.'))'" }
    $where += "(" + ($exts -join " OR ") + ")"
  }
  $scopes = $Folders -split ';' | Where-Object { $_ } | ForEach-Object { "SCOPE='file:$(Esc ($_ -replace '\\','/'))'" }
  $where += "(" + ($scopes -join " OR ") + ")"
  $sql = "SELECT TOP $Max System.ItemPathDisplay, System.DateModified, System.Size FROM SYSTEMINDEX WHERE " +
         ($where -join " AND ") + " ORDER BY System.DateModified DESC"
  $c = New-Object -ComObject ADODB.Connection
  $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $rs = $c.Execute($sql)
  $files = @()
  while (-not $rs.EOF) {
    $files += @{
      path     = [string]$rs.Fields.Item(0).Value
      modified = ([datetime]$rs.Fields.Item(1).Value).ToLocalTime().ToString("yyyy-MM-dd HH:mm")
      sizeKb   = [int]([double]$rs.Fields.Item(2).Value / 1kb)
    }
    $rs.MoveNext()
  }
  $c.Close()
  @{ ok = $true; files = @($files) } | ConvertTo-Json -Compress -Depth 4
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
