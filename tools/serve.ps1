# serve.ps1 — 動作確認用のかんたんな静的サーバ。
#
#   powershell -ExecutionPolicy Bypass -File tools\serve.ps1
#   → http://localhost:8000 を Chrome で開く
#
# localhost は「安全なコンテキスト」として扱われるため、
# ここからなら Geolocation API も Service Worker も動く。
# Chrome DevTools の Sensors パネルで現在地を偽装すれば、
# 実際に走らなくても測位から積算までの流れを試せる。
#
# 止めるときは Ctrl+C。

param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$mime = @{
    '.html'        = 'text/html; charset=utf-8'
    '.js'          = 'text/javascript; charset=utf-8'
    '.css'         = 'text/css; charset=utf-8'
    '.json'        = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.png'         = 'image/png'
    '.svg'         = 'image/svg+xml'
    '.ico'         = 'image/x-icon'
    '.txt'         = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Error "ポート $Port を開けませんでした。別のポートを試してください: -Port 8080"
    exit 1
}

Write-Output ''
Write-Output "  チャリでポンイチ — 開発用サーバ"
Write-Output "  http://localhost:$Port"
Write-Output "  公開フォルダ: $root"
Write-Output '  停止するには Ctrl+C'
Write-Output ''

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        break
    }

    $req = $ctx.Request
    $res = $ctx.Response

    # URL をデコードしてローカルパスへ。日本語フォルダ名でも通るようにする
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $rel = $rel -replace '/', '\'
    $full = Join-Path $root $rel

    # 公開フォルダの外へ出る要求は拒否する
    $rootFull = [System.IO.Path]::GetFullPath($root)
    try { $fullResolved = [System.IO.Path]::GetFullPath($full) } catch { $fullResolved = '' }

    if (-not $fullResolved.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
        $res.Close()
        continue
    }

    if (Test-Path -LiteralPath $fullResolved -PathType Container) {
        $fullResolved = Join-Path $fullResolved 'index.html'
    }

    if (Test-Path -LiteralPath $fullResolved -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($fullResolved).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($fullResolved)
        $res.StatusCode = 200
        $res.ContentType = $type
        # 開発中は毎回読み直したいのでキャッシュさせない
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Output ("  200  " + $req.Url.AbsolutePath)
    } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.StatusCode = 404
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
        Write-Output ("  404  " + $req.Url.AbsolutePath)
    }
    $res.Close()
}

$listener.Stop()
