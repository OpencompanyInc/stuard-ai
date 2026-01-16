# PowerShell script to upload .env values to Google Secret Manager
# Project: stuard-ai
# Usage: Run in PowerShell from the directory containing your .env file

$envFile = "C:/Users/solar/StuardAI-V2/apps/cloud-ai/.env"
$project = "stuard-ai"

if (!(Test-Path $envFile)) {
    Write-Error ".env file not found at $envFile"
    exit 1
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    if ($line -match "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
        $key = $matches[1]
        $val = $matches[2]
        # Remove surrounding quotes if present
        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        if ($val -eq "") { return }
        $tmp = "./tmp_secret.txt"
        Set-Content -Path $tmp -Value $val
        Write-Host "Uploading $key..."
        gcloud secrets versions add $key --data-file=$tmp --project=$project
        Remove-Item $tmp
    }
}
Write-Host "All .env values uploaded to Google Secret Manager."