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

    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($S, $S)),
        (Get-Color '#1b2540'), (Get-Color '#0d111c'))
    $g.FillRectangle($bg, 0, 0, $S, $S)
    $bg.Dispose()

    # 宇宙まで行く旅なので星を散らす
    $star = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(140, 238, 242, 250))
    $stars = @()
    $stars += ,@(92,104,3)
    $stars += ,@(420,86,4)
    $stars += ,@(452,206,2.4)
    $stars += ,@(74,392,2.6)
    $stars += ,@(398,430,3)
    $stars += ,@(150,60,2)
    # PowerShell の変数名は大文字小文字を区別しないので、キャンバス幅 $S を潰さない名前にする
    foreach ($pt in $stars) {
        $sr = [float]$pt[2] * $k
        $g.FillEllipse($star, [float]($pt[0]*$k - $sr), [float]($pt[1]*$k - $sr), $sr*2, $sr*2)
    }
    $star.Dispose()

    # --- 中身 ---------------------------------------------------------------
    # maskable は端が切り落とされるので、中身を安全域(中央80%)に収める
    if ($Maskable) {
        $g.TranslateTransform($S/2, $S/2)
        $g.ScaleTransform(0.72, 0.72)
        $g.TranslateTransform(-($S/2), -($S/2))
    }

    $accent = Get-Color '#ffb35c'

    # 周回中を表す弧。真上から時計回りに 279 度
    $pen = New-Object System.Drawing.Pen($accent, [float](20 * $k))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $ar = 218.0 * $k
    $g.DrawArc($pen, $S/2 - $ar, $S/2 - $ar, $ar*2, $ar*2, -90, 279)
    $pen.Dispose()

    # 現在地のドット（弧の先端）
    $ang = 189.0 * [Math]::PI / 180.0
    $dot = New-Object System.Drawing.SolidBrush (Get-Color '#ffe0b4')
    $dr = 20.0 * $k
    $dx = $S/2 + [Math]::Cos($ang) * $ar
    $dy = $S/2 + [Math]::Sin($ang) * $ar
    $g.FillEllipse($dot, [float]($dx - $dr), [float]($dy - $dr), $dr*2, $dr*2)
    $dot.Dispose()

    # 車輪
    $pw = New-Object System.Drawing.Pen($accent, [float](15 * $k))
    $wr = 66.0 * $k
    foreach ($cx in @(172.0, 340.0)) {
        $g.DrawEllipse($pw, [float]($cx*$k - $wr), [float](322*$k - $wr), $wr*2, $wr*2)
    }
    $pw.Dispose()

    # フレーム
    $pf = New-Object System.Drawing.Pen($accent, [float](16 * $k))
    $pf.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pf.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    # シートステー / シートチューブ / チェーンステー / ダウンチューブ / フォーク / トップチューブ
    $segments = @()
    $segments += ,@(172,322,252,236)
    $segments += ,@(252,236,258,322)
    $segments += ,@(258,322,172,322)
    $segments += ,@(258,322,330,240)
    $segments += ,@(330,240,340,322)
    $segments += ,@(252,236,330,240)
    foreach ($seg in $segments) {
        $g.DrawLine($pf, [float]($seg[0]*$k), [float]($seg[1]*$k), [float]($seg[2]*$k), [float]($seg[3]*$k))
    }
    $pf.Dispose()

    # サドルとハンドル
    $ps = New-Object System.Drawing.Pen($accent, [float](14 * $k))
    $ps.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ps.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($ps, [float](232*$k), [float](228*$k), [float](272*$k), [float](228*$k))
    $g.DrawLine($ps, [float](316*$k), [float](230*$k), [float](352*$k), [float](230*$k))
    $ps.Dispose()

    # クランク
    $cb = New-Object System.Drawing.SolidBrush $accent
    $cr = 13.0 * $k
    $g.FillEllipse($cb, [float](258*$k - $cr), [float](322*$k - $cr), $cr*2, $cr*2)
    $cb.Dispose()

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
