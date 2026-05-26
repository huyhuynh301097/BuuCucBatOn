$url = 'https://docs.google.com/spreadsheets/d/1odUPX5mWpUYUUQOrhX_k8kXWV7drMUdQ58DRwgSQNS8/gviz/tq?tqx=out:csv&sheet=Data%20DB'
$resp = Invoke-WebRequest -UseBasicParsing -Uri $url
$csv = ConvertFrom-Csv $resp.Content
$dates = $csv | ForEach-Object { $_.ngay -split ' ' | Select-Object -First 1 } | Sort-Object -Unique -Descending
$latestDate = $dates[0]
Write-Host "Latest Date: $latestDate"
$latestData = $csv | Where-Object { $_.ngay -like "$latestDate*" }
Write-Host "Total records latest date: $($latestData.Count)"

$ratios = @()
foreach ($d in $latestData) {
    $lmVal = [double]($d.'BL LM' -replace '[^\d\.]', '0')
    $gtcVal = [double]($d.gtc_avg_7ngay -replace '[^\d\.]', '0')
    if ($gtcVal -gt 0) {
        $ratio = ($lmVal / $gtcVal) - 1
        $ratios += [PSCustomObject]@{
            name = $d.kho_giao_name
            lm = $lmVal
            gtc = $gtcVal
            ratio = $ratio
        }
    }
}

$ratios = $ratios | Sort-Object ratio -Descending
Write-Host "Total with gtc > 0: $($ratios.Count)"
$m40 = ($ratios | Where-Object { $_.ratio -ge 0.40 }).Count
$m50 = ($ratios | Where-Object { $_.ratio -ge 0.50 }).Count
$m60 = ($ratios | Where-Object { $_.ratio -ge 0.60 }).Count
Write-Host "Exceeds >= 40%: $m40"
Write-Host "Exceeds >= 50%: $m50"
Write-Host "Exceeds >= 60%: $m60"

Write-Host "Top 25 exceeding:"
$ratios | Select-Object -First 25 | ForEach-Object {
    Write-Host "$($_.name) LM=$($_.lm) GTC=$($_.gtc) Exceeds=$(($_.ratio * 100).ToString('F1'))%"
}
