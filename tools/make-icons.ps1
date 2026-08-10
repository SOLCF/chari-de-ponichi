# make-icons.ps1 — PWA 用アイコン PNG を生成する。
#
#   powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
#
# tools/icon-gen.html と同じ絵を .NET の GDI+ で描く。
# ブラウザを開かずにアイコンを作り直したいときはこちらを使う。

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function Get-Color([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

# 日本地図の輪郭は data/japan.json が唯一の出処。アプリの背景(js/japan.js)と
# ここが同じファイルを読むので、地図を直すときは JSON だけ触ればよい。
$japanJson = Get-Content (Join-Path $root 'data\japan.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# js/japan.js の project() と同じ等距円筒図法。経度に cos(基準緯度) を掛けて横の縮みを合わせる
function Get-JapanRings {
    param([single]$Box)

    $k = [Math]::Cos($japanJson.lat0 * [Math]::PI / 180.0)
    $rings = @()
    $minX = [double]::MaxValue; $maxX = [double]::MinValue
    $minY = [double]::MaxValue; $maxY = [double]::MinValue

    foreach ($island in $japanJson.islands) {
        $pts = @()
        foreach ($p in $island.ring) {
            $x = [double]$p[0] * $k
            $y = -[double]$p[1]          # 北を上にするので緯度は符号を反転
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
            $pts += ,@($x, $y)
        }
        $rings += ,$pts
    }

    # 指定の正方形に収まるよう拡大し、中央へ寄せる
    $w = $maxX - $minX; $h = $maxY - $minY
    $scale = [Math]::Min($Box / $w, $Box / $h)
    $offX = ($Box - $w * $scale) / 2.0
    $offY = ($Box - $h * $scale) / 2.0

    $out = @()
    foreach ($ring in $rings) {
        $poly = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
        foreach ($pt in $ring) {
            $poly.Add((New-Object System.Drawing.PointF(
                [single](($pt[0] - $minX) * $scale + $offX),
                [single](($pt[1] - $minY) * $scale + $offY))))
        }
        $out += ,$poly.ToArray()
    }
    return $out
}

function New-Icon {
    param([int]$Size, [bool]$Maskable, [string]$FileName)

    $S = [float]$Size
    $k = $S / 512.0
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # --- 背景 ---------------------------------------------------------------
    if (-not $Maskable) {
        # 通常アイコンは角丸。Android 側でさらに丸められるので控えめにする
        $r = 112.0 * $k
        $d = $r * 2
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($S - $d, 0, $d, $d, 270, 90)
        $path.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
        $path.AddArc(0, $S - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $g.SetClip($path)
        $path.Dispose()
    }

    # アプリ本体がライトテーマなので、アイコンも紙の色を基調にする
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($S, $S)),
        (Get-Color '#fdfcf7'), (Get-Color '#eee8da'))
    $g.FillRectangle($bg, 0, 0, $S, $S)
    $bg.Dispose()

    # --- 中身 ---------------------------------------------------------------
    # maskable は端が切り落とされるので、中身を安全域(中央80%)に収める
    if ($Maskable) {
        $g.TranslateTransform($S/2, $S/2)
        $g.ScaleTransform(0.72, 0.72)
        $g.TranslateTransform(-($S/2), -($S/2))
    }

    $accent = Get-Color '#e07a1e'

    # 日本を一周する軌跡。真上から時計回りに 279 度まわし、先端を現在地とする
    $pen = New-Object System.Drawing.Pen($accent, [float](21 * $k))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $ar = 214.0 * $k
    $g.DrawArc($pen, $S/2 - $ar, $S/2 - $ar, $ar*2, $ar*2, -90, 279)
    $pen.Dispose()

    # 日本列島。半径214の弧の内側に収まるよう、300四方の枠に合わせる
    #   （枠の対角の半分は約200なので、弧の内縁208より内側に収まる）
    $jbox = [single](300.0 * $k)
    $joff = [single](($S - $jbox) / 2.0)
    $jpath = New-Object System.Drawing.Drawing2D.GraphicsPath
    foreach ($ring in (Get-JapanRings -Box $jbox)) {
        $moved = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
        foreach ($pt in $ring) {
            $moved.Add((New-Object System.Drawing.PointF([single]($pt.X + $joff), [single]($pt.Y + $joff))))
        }
        $jpath.AddPolygon($moved.ToArray())
    }
    $jb = New-Object System.Drawing.SolidBrush (Get-Color '#2b3444')
    $g.FillPath($jb, $jpath)
    $jb.Dispose()
    $jpath.Dispose()

    # 現在地のドット。弧より前に描いて、地図に隠れないようにする
    $ang = 189.0 * [Math]::PI / 180.0
    $dx = $S/2 + [Math]::Cos($ang) * $ar
    $dy = $S/2 + [Math]::Sin($ang) * $ar
    $dr = 25.0 * $k
    $halo = New-Object System.Drawing.SolidBrush (Get-Color '#fdfcf7')
    $g.FillEllipse($halo, [float]($dx - $dr), [float]($dy - $dr), $dr*2, $dr*2)
    $halo.Dispose()
    $dot = New-Object System.Drawing.SolidBrush $accent
    $dr = 17.0 * $k
    $g.FillEllipse($dot, [float]($dx - $dr), [float]($dy - $dr), $dr*2, $dr*2)
    $dot.Dispose()

    $g.Dispose()
    $out = Join-Path $outDir $FileName
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "  $FileName  ($Size x $Size)"
}

Write-Output 'アイコンを生成します:'
New-Icon -Size 192 -Maskable $false -FileName 'icon-192.png'
New-Icon -Size 512 -Maskable $false -FileName 'icon-512.png'
New-Icon -Size 512 -Maskable $true  -FileName 'icon-maskable-512.png'
Write-Output "完了: $outDir"
