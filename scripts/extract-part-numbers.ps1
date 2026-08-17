param(
  [string]$SourceDir = "C:\Users\redbu\Projects\telecomstore\telecom_material",
  [string]$OutputCsv = "C:\Users\redbu\Projects\telecomstore\docs\telecom-material-part-number-ocr.csv",
  [string]$UniqueCsv = "C:\Users\redbu\Projects\telecomstore\docs\telecom-material-part-number-unique.csv"
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

function Await($AsyncTask, $ResultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethodDefinition -and
      $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  $generic = $asTask.MakeGenericMethod($ResultType)
  $task = $generic.Invoke($null, @($AsyncTask))
  $task.Wait()
  return $task.Result
}

function Get-OcrText($Path, $Engine) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])

  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    return $result.Text
  } finally {
    $stream.Dispose()
  }
}

function Get-Candidates($Text) {
  if (-not $Text) { return @() }

  $normalized = $Text.ToUpperInvariant()
  $normalized = $normalized -replace "[\u2010\u2011\u2012\u2013\u2014\u2212]", "-"
  $normalized = $normalized -replace "[,:;()\[\]{}""'``]", " "
  $normalized = $normalized -replace "\s+", " "

  $stopContains = @(
    "SELLER", "MANUFACTUR", "WARRANT", "PURPOSE", "CUSTOMER", "WARNING",
    "PRODUCT", "IMPLIED", "INCLUDING", "LIABLE", "DAMAGES", "CONTRACT",
    "BREACH", "NOTICE", "EMPTY", "QTY/BU", "OTY/B", "PAIR", "PAII",
    "LOT", "DATE", "MADE", "CHINA", "MEXICO", "PAGE", "INSIDE"
  )

  $patterns = @(
    "\b\d{2}-\d{4}-\d{4}-\d\b",
    "\b[A-Z]{1,10}\d[A-Z0-9]*(?:[-/\.][A-Z0-9]{2,})+\b",
    "\b\d{2,8}[A-Z]{1,8}(?:[-/\.][A-Z0-9]{2,})+\b",
    "\b[A-Z0-9]{2,10}[-/][A-Z0-9]{2,14}(?:[-/][A-Z0-9]{2,14})?\b",
    "\b[A-Z]{1,8}\d[A-Z0-9]{3,24}\b",
    "\b\d{2,8}[A-Z]{1,8}[A-Z0-9]{0,18}\b",
    "\b\d{7,14}\b"
  )

  $list = [System.Collections.Generic.List[string]]::new()

  foreach ($pattern in $patterns) {
    foreach ($match in [regex]::Matches($normalized, $pattern)) {
      $token = $match.Value.Trim(".-_/ ")

      if ($token.Length -lt 4 -or $token.Length -gt 32) { continue }
      if ($token -match "^202\d") { continue }
      if ($token -match "^\d{1,6}$") { continue }
      if ($token -match "^[A-Z]+$") { continue }

      $bad = $false
      foreach ($stop in $stopContains) {
        if ($token.Contains($stop)) {
          $bad = $true
          break
        }
      }
      if ($bad) { continue }

      if (-not $list.Contains($token)) {
        $list.Add($token)
      }
    }
  }

  return $list
}

function Get-Score($Token) {
  if (-not $Token) { return 0 }

  $score = 0
  if ($Token -match "^\d{2}-\d{4}-\d{4}-\d$") { $score += 100 }
  if ($Token -match "^80-") { $score += 20 }
  if ($Token -match "[A-Z]" -and $Token -match "\d") { $score += 35 }
  if ($Token -match "[-/]") { $score += 25 }
  if ($Token -match "^\d{7,14}$") { $score += 10 }
  if ($Token.Length -ge 6 -and $Token.Length -le 18) { $score += 10 }
  if ($Token -match "^(\d{2}-\d{2}-\d{2}|\d{1,3}-PAIR)$") { $score -= 80 }
  if ($Token -match "^(QTY|OTY|MTY|IN)-") { $score -= 60 }

  return $score
}

function Get-BestCandidate($Candidates) {
  if (-not $Candidates -or $Candidates.Count -eq 0) { return "" }

  return ($Candidates |
    Sort-Object @{ Expression = { Get-Score $_ }; Descending = $true }, @{ Expression = { $_.Length }; Descending = $true } |
    Select-Object -First 1)
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw "Windows OCR engine is not available." }

$tempDir = Join-Path $env:TEMP ("telecom_ocr_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
  $files = Get-ChildItem -LiteralPath $SourceDir -Filter *.heic -File | Sort-Object Name
  $rows = [System.Collections.Generic.List[object]]::new()
  $index = 0

  foreach ($file in $files) {
    $index += 1
    Write-Host "OCR $index / $($files.Count): $($file.Name)"

    $jpg = Join-Path $tempDir ($file.BaseName + ".jpg")
    $ffmpeg = Start-Process -FilePath "ffmpeg" -ArgumentList @("-hide_banner", "-loglevel", "error", "-y", "-i", $file.FullName, "-frames:v", "1", $jpg) -Wait -PassThru -NoNewWindow

    if ($ffmpeg.ExitCode -ne 0 -or -not (Test-Path $jpg)) {
      $rows.Add([pscustomobject]@{
        file = $file.Name
        best_guess = ""
        confidence = "none"
        candidates = ""
        raw_text = ""
        source = "conversion-failed"
      })
      continue
    }

    try {
      $text = Get-OcrText $jpg $engine
      $bestText = (($text -replace "`r|`n", " ") -replace "\s+", " ").Trim()
      $bestCandidates = Get-Candidates $text
      $bestGuess = Get-BestCandidate $bestCandidates
      $bestScore = if ($bestGuess) { Get-Score $bestGuess } else { 0 }
      $bestSource = "ocr"
    } catch {
      $bestText = ""
      $bestCandidates = @()
      $bestGuess = ""
      $bestScore = 0
      $bestSource = $_.Exception.Message
    }

    $confidence = if ($bestScore -ge 100) {
      "high"
    } elseif ($bestScore -ge 60) {
      "medium"
    } elseif ($bestScore -gt 0) {
      "low"
    } else {
      "none"
    }

    $rows.Add([pscustomobject]@{
      file = $file.Name
      best_guess = $bestGuess
      confidence = $confidence
      candidates = ($bestCandidates -join "; ")
      raw_text = $bestText
      source = $bestSource
    })
  }

  $rows | Export-Csv -LiteralPath $OutputCsv -NoTypeInformation -Encoding UTF8

  $allCandidates = [System.Collections.Generic.List[object]]::new()
  foreach ($row in $rows) {
    foreach ($candidate in ($row.candidates -split "; " | Where-Object { $_ })) {
      $allCandidates.Add([pscustomobject]@{
        part_number = $candidate
        file = $row.file
        confidence = $row.confidence
      })
    }
  }

  $allCandidates |
    Group-Object part_number |
    Sort-Object @{ Expression = "Count"; Descending = $true }, Name |
    ForEach-Object {
      [pscustomobject]@{
        part_number = $_.Name
        image_count = $_.Count
        files = (($_.Group | Select-Object -ExpandProperty file -Unique) -join "; ")
      }
    } |
    Export-Csv -LiteralPath $UniqueCsv -NoTypeInformation -Encoding UTF8

  Write-Host "Output: $OutputCsv"
  Write-Host "Unique: $UniqueCsv"
  Write-Host "Rows: $($rows.Count)"
  Write-Host "With best guess: $(($rows | Where-Object { $_.best_guess }).Count)"
  Write-Host "No candidate: $(($rows | Where-Object { -not $_.best_guess }).Count)"
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
