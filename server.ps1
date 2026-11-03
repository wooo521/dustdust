# 로컬 개발용 경량 웹 서버 (Node.js 설치 없이 윈도우 기본 PowerShell로 구동)
$port = 3000
$root = $PSScriptRoot

# .env.local 에서 AIRKOREA_KEY 읽기
$envFile = Join-Path $root ".env.local"
$apiKey = ""
if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
        if ($_ -match "^\s*AIRKOREA_KEY\s*=\s*(.+)$") {
            $apiKey = $matches[1].Trim()
        }
    }
}

if (-not $apiKey) {
    Write-Host "[경고] .env.local 파일에서 AIRKOREA_KEY를 찾을 수 없습니다." -ForegroundColor Yellow
} else {
    Write-Host "[확인] API 키 로드 완료" -ForegroundColor Green
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "[오류] 포트 $port 를 열 수 없습니다: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [대기오염 모니터링] 로컬 개발 서버가 시작되었습니다!" -ForegroundColor Cyan
Write-Host " 브라우저 주소: $prefix" -ForegroundColor Yellow
Write-Host " 종료하려면 터미널 창을 닫거나 Ctrl+C를 누르세요." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# 기본 웹 브라우저에서 사이트 자동 열기
Start-Process $prefix

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = $request.Url.LocalPath

    # 1. /api/dust 요청 처리 (Vercel api/dust.js 와 동일한 프록시 로직)
    if ($path -eq "/api/dust") {
        # 브라우저 요청 URL(RawUrl)에서 sido 파라미터를 직접 추출하여 한글 깨짐 방지
        $encodedSido = "%EC%84%9C%EC%9A%B8" # 기본값: 서울
        if ($request.RawUrl -match "[?&]sido=([^&]+)") {
            $rawVal = $matches[1]
            try {
                $decoded = [System.Uri]::UnescapeDataString($rawVal)
                $encodedSido = [System.Uri]::EscapeDataString($decoded)
            } catch {
                $encodedSido = $rawVal
            }
        }

        try {
            $encodedKey = [System.Uri]::EscapeDataString([System.Uri]::UnescapeDataString($apiKey))
            $targetUrl = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=$encodedKey&returnType=json&numOfRows=100&pageNo=1&sidoName=$encodedSido&ver=1.3"

            $webClient = New-Object System.Net.WebClient
            $buffer = $webClient.DownloadData($targetUrl)
            $rawText = [System.Text.Encoding]::UTF8.GetString($buffer)

            if ($rawText.Trim().StartsWith("<")) {
                $errJson = @{ message = "인증키 또는 요청값을 확인해주세요."; errorDetail = $rawText } | ConvertTo-Json
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $response.StatusCode = 400
            } else {
                $response.StatusCode = 200
            }
        } catch {
            $errJson = @{ message = "API 호출 중 오류 발생: $($_.Exception.Message)" } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($errJson)
            $response.StatusCode = 500
        }

        $response.ContentType = "application/json; charset=utf-8"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.OutputStream.Close()
        continue
    }

    # 2. 정적 파일 서빙 (index.html, style.css, script.js 등)
    if ($path -eq "/") { $path = "/index.html" }
    $filePath = Join-Path $root ($path.TrimStart("/").Replace("/", "\"))

    if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        switch ($ext) {
            ".html" { $response.ContentType = "text/html; charset=utf-8" }
            ".css"  { $response.ContentType = "text/css; charset=utf-8" }
            ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
            ".json" { $response.ContentType = "application/json; charset=utf-8" }
            ".png"  { $response.ContentType = "image/png" }
            default { $response.ContentType = "application/octet-stream" }
        }

        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.StatusCode = 200
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $response.OutputStream.Write($msg, 0, $msg.Length)
    }

    $response.OutputStream.Close()
}
