# Finds files by name through the Windows search index. Prints one line of JSON.
param(
  [string]$Query = "",
  [string]$Ext = "",
  [string]$Folders = "",       # semicolon-separated list of folders to look in
  [int]$Max = 10
)
$ErrorActionPreference = "Stop"
function Esc([string]$s) { $s.Replace("'", "''").Replace("%", "").Replace("[", "").Replace("]", "") }
try {
  $where = @()
  foreach ($word in ($Query -split '\s+' | Where-Object { $_ })) {
    $where += "System.FileName LIKE '%$(Esc $word)%'"
  }
  if ($Ext) { $where += "System.FileExtension = '.$(Esc $Ext.TrimStart('.'))'" }
  $scopes = @()
  foreach ($f in ($Folders -split ';' | Where-Object { $_ })) {
    $scopes += "SCOPE='file:$(Esc ($f -replace '\\','/'))'"
  }
  if ($scopes.Count -eq 0) { throw "No folders to search in." }
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
