param(
  [string]$OutputDir = (Join-Path $PSScriptRoot '..' '.vercel' 'output')
)

function Copy-FuncTree {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      $resolved = $_.Target
      if ($resolved -is [string[]]) { $resolved = $resolved[0] }
      $resolvedPath = Join-Path $Source.Parent.FullName $resolved
      Copy-FuncTree -Source $resolvedPath -Destination $target
    } elseif ($_.PSIsContainer) {
      Copy-FuncTree -Source $_.FullName -Destination $target
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

Get-ChildItem -Path $OutputDir -Recurse -Force -Attributes ReparsePoint | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
  $parent = $_.Parent.FullName
  $name = $_.Name
  $temp = Join-Path $parent ("__tmp__" + [Guid]::NewGuid().ToString('N'))
  if ($_.PSIsContainer) {
    Copy-FuncTree -Source $_.FullName -Destination $temp
  } else {
    $resolved = $_.Target
    if ($resolved -is [string[]]) { $resolved = $resolved[0] }
    $resolvedPath = Join-Path $parent $resolved
    Copy-Item -LiteralPath $resolvedPath -Destination $temp -Force
  }
  Remove-Item -LiteralPath $_.FullName -Force -Recurse
  Rename-Item -LiteralPath $temp -NewName $name
}

Write-Host "Dereferenced symlinks under $OutputDir"
