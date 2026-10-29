$ErrorActionPreference = 'Stop'

function Invoke-MagpieCommand {
    param([string]$Executable, [string[]]$TaskArguments)
    $outputFile = [IO.Path]::GetTempFileName()
    $errorFile = [IO.Path]::GetTempFileName()
    try {
        $arguments = @($TaskArguments | ForEach-Object { '"' + $_ + '"' })
        $process = Start-Process -FilePath $Executable -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
        $outputText = Get-Content -LiteralPath $outputFile -Raw -Encoding UTF8
        if ($process.ExitCode -ne 0) {
            $errorText = Get-Content -LiteralPath $errorFile -Raw -Encoding UTF8
            throw "Magpie failed (exit $($process.ExitCode)): $errorText"
        }
        return $outputText
    } finally {
        Remove-Item -LiteralPath $outputFile, $errorFile -Force -ErrorAction SilentlyContinue
    }
}

try {
    $magpieCommand = Get-Command magpie -ErrorAction SilentlyContinue
    $magpieExe = if ($magpieCommand) { $magpieCommand.Source } else { $null }
    if (-not $magpieExe) {
        $magpieExe = Get-Process -Name 'magpie-windows-amd64' -ErrorAction SilentlyContinue |
            Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path
    }
    if (-not $magpieExe) {
        $downloadedMagpie = Join-Path $env:USERPROFILE 'Downloads\magpie-windows-amd64.exe'
        if (Test-Path -LiteralPath $downloadedMagpie) { $magpieExe = $downloadedMagpie }
    }
    if (-not $magpieExe) { throw 'Magpie was not found. Start Magpie and run this installer again.' }

    Write-Host 'Installing the Agnes provider into Magpie...'
    $installOutput = Invoke-MagpieCommand -Executable $magpieExe -TaskArguments @('plugin', 'add', $PSScriptRoot)
    Write-Host $installOutput
    $listing = Invoke-MagpieCommand -Executable $magpieExe -TaskArguments @('plugin', 'list', '--json') | ConvertFrom-Json
    $provider = $listing.providers | Where-Object { $_.spec -eq $PSScriptRoot -and $_.id -in @('agnes', 'agnes-plugin') }
    if (-not $provider) { throw 'Magpie did not load the Agnes provider. See the installation output above.' }
    Write-Host ''
    Write-Host 'Installed. In Magpie, open Plugins, find Agnes AI, and sign in with your Agnes API key.'
    Write-Host 'Video requires Magpie 0.1.2077 or later.'
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
