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

# 自転車を描く。Extra に太さを足すと、本体の下に敷く縁取りになる。
# 512 を基準とした座標で、車輪は (172,322) と (340,322)、半径 66。
function Draw-Bike {
    param($G, [single]$K, $Color, [single]$Extra)

    $pw = New-Object System.Drawing.Pen($Color, [float](17 * $K + $Extra))
    $wr = 66.0 * $K
    foreach ($cx in @(172.0, 340.0)) {
        $G.DrawEllipse($pw, [float]($cx*$K - $wr), [float](322*$K - $wr), $wr*2, $wr*2)
    }
    $pw.Dispose()

    # シートステー / シートチューブ / チェーンステー / ダウンチューブ / フォーク / トップチューブ
    $segments = @()
    $segments += ,@(172,322,252,236)
    $segments += ,@(252,236,258,322)
    $segments += ,@(258,322,172,322)
    $segments += ,@(258,322,330,240)
    $segments += ,@(330,240,340,322)
    $segments += ,@(252,236,330,240)
    $pf = New-Object System.Drawing.Pen($Color, [float](18 * $K + $Extra))
    $pf.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pf.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    foreach ($seg in $segments) {
        $G.DrawLine($pf, [float]($seg[0]*$K), [float]($seg[1]*$K), [float]($seg[2]*$K), [float]($seg[3]*$K))
    }
    $pf.Dispose()

    # サドルとハンドル
    $ps = New-Object System.Drawing.Pen($Color, [float](16 * $K + $Extra))
    $ps.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ps.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $G.DrawLine($ps, [float](232*$K), [float](228*$K), [float](272*$K), [float](228*$K))
    $G.DrawLine($ps, [float](316*$K), [float](230*$K), [float](352*$K), [float](230*$K))
    $ps.Dispose()

    # クランク
    $cb = New-Object System.Drawing.SolidBrush $Color
    $cr = 14.0 * $K + $Extra / 2
    $G.FillEllipse($cb, [float](258*$K - $cr), [float](322*$K - $cr), $cr*2, $cr*2)
    $cb.Dispose()
}

# Shape で外形と中身の縮尺を切り替える
#   rounded  … 角丸の背景。PWA と Android の旧形式アイコン
#   circle   … 円形の背景。Android の ic_launcher_round
#   maskable … 背景は全面、中身は安全域(中央72%)。PWA の maskable
#   adaptive … 背景は透明、中身は中央66.7%。Android のアダプティブアイコンの前景。
#              108dp のうち実際に見えるのは中央 72dp なので、そこに収める必要がある
function New-Icon {
    param([int]$Size, [string]$Shape, [string]$Path)

    $S = [float]$Size
    $k = $S / 512.0
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # --- 背景 ---------------------------------------------------------------
    if ($Shape -eq 'rounded') {
        # Android 側でさらに丸められるので、角丸は控えめにする
        $r = 112.0 * $k
        $d = $r * 2
        # 変数名は大小を区別しないので、パラメータ $Path を潰さない名前にする
        $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clip.AddArc(0, 0, $d, $d, 180, 90)
        $clip.AddArc($S - $d, 0, $d, $d, 270, 90)
        $clip.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
        $clip.AddArc(0, $S - $d, $d, $d, 90, 90)
        $clip.CloseFigure()
        $g.SetClip($clip)
        $clip.Dispose()
    } elseif ($Shape -eq 'circle') {
        $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clip.AddEllipse(0, 0, $S, $S)
        $g.SetClip($clip)
        $clip.Dispose()
    }

    # アプリ本体がライトテーマなので、アイコンも紙の色を基調にする。
    # adaptive の背景は別リソース(ic_launcher_background)が持つので、ここでは塗らない
    if ($Shape -ne 'adaptive') {
        $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.PointF(0, 0)),
            (New-Object System.Drawing.PointF($S, $S)),
            (Get-Color '#fdfcf7'), (Get-Color '#eee8da'))
        $g.FillRectangle($bg, 0, 0, $S, $S)
        $bg.Dispose()
    }

    # --- 中身 ---------------------------------------------------------------
    $inner = 1.0
    if ($Shape -eq 'maskable') { $inner = 0.72 }
    if ($Shape -eq 'adaptive') { $inner = 0.667 }
    if ($inner -ne 1.0) {
        $g.TranslateTransform($S/2, $S/2)
        $g.ScaleTransform($inner, $inner)
        $g.TranslateTransform(-($S/2), -($S/2))
    }

    $accent = Get-Color '#e07a1e'

    # 通知の小アイコンは Android が白一色に塗り潰すので、地図も自転車も意味を成さない。
    # 24dp でも形が分かる「一周する軌跡と現在地」だけにする
    if ($Shape -eq 'notification') {
        $white = [System.Drawing.Color]::White
        $np = New-Object System.Drawing.Pen($white, [float](34 * $k))
        $np.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $np.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
        $nr = 176.0 * $k
        $g.DrawArc($np, $S/2 - $nr, $S/2 - $nr, $nr*2, $nr*2, -90, 279)
        $np.Dispose()

        $na = 189.0 * [Math]::PI / 180.0
        $nb = New-Object System.Drawing.SolidBrush $white
        $ndr = 40.0 * $k
        $g.FillEllipse($nb,
            [float]($S/2 + [Math]::Cos($na) * $nr - $ndr),
            [float]($S/2 + [Math]::Sin($na) * $nr - $ndr), $ndr*2, $ndr*2)
        $nb.Dispose()

        $g.Dispose()
        $dir = Split-Path -Parent $Path
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Output ("  {0,-34} {1}x{1}" -f (Split-Path -Leaf $Path), $Size)
        return
    }

    # 日本を一周する軌跡。真上から時計回りに 279 度まわし、先端を現在地とする
    $pen = New-Object System.Drawing.Pen($accent, [float](21 * $k))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $ar = 214.0 * $k
    $g.DrawArc($pen, $S/2 - $ar, $S/2 - $ar, $ar*2, $ar*2, -90, 279)
    $pen.Dispose()

    # 日本列島。半径214の弧の内側に収まるよう、300四方の枠に合わせる
    #   （枠の対角の半分は約200なので、弧の内縁203より内側に収まる）
    # 塗りつぶしただけだとシルエットになるので、海岸線の線を重ねて地図らしくする
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
    $jb = New-Object System.Drawing.SolidBrush (Get-Color '#c3dd85')
    $g.FillPath($jb, $jpath)
    $jb.Dispose()
    $jp = New-Object System.Drawing.Pen((Get-Color '#7ba63c'), [float](4.5 * $k))
    $jp.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($jp, $jpath)
    $jp.Dispose()
    $jpath.Dispose()

    # 自転車。地図の上に重ねるので、まず紙色で太く縁取ってから本体を描く。
    # 縁取りが無いと、黄緑の海岸線と自転車の線が同じ太さで絡んで読みにくい
    # 置き場所は房総沖の太平洋。列島は右上(北海道)から左下(九州)へ斜めに走るので、
    # 右下は海しかない。ここに置けば四国も九州も隠れない
    $bikeScale = 0.58
    $state = $g.Save()
    $g.TranslateTransform([single](318.0 * $k), [single](348.0 * $k))
    $g.ScaleTransform($bikeScale, $bikeScale)
    $g.TranslateTransform([single](-256.0 * $k), [single](-308.0 * $k))   # 自転車の中心を原点へ
    Draw-Bike -G $g -K $k -Color (Get-Color '#fdfcf7') -Extra ([single](16 * $k))
    Draw-Bike -G $g -K $k -Color (Get-Color '#2b3444') -Extra 0
    $g.Restore($state)

    # 現在地のドット。最後に描いて、地図にも自転車にも隠れないようにする
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
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("  {0,-34} {1}x{1}" -f (Split-Path -Leaf $Path), $Size)
}

Write-Output 'PWA 用:'
New-Icon -Size 192 -Shape 'rounded'  -Path (Join-Path $outDir 'icon-192.png')
New-Icon -Size 512 -Shape 'rounded'  -Path (Join-Path $outDir 'icon-512.png')
New-Icon -Size 512 -Shape 'maskable' -Path (Join-Path $outDir 'icon-maskable-512.png')

# Android のランチャーアイコン。android/ が生成済みのときだけ書き込む
$resDir = Join-Path $root 'android\app\src\main\res'
if (Test-Path $resDir) {
    Write-Output ''
    Write-Output 'Android 用:'

    # 密度ごとの一辺。前景は 108dp 相当なので、旧形式アイコンの 2.25 倍になる
    $densities = @()
    $densities += ,@('mdpi',    48,  108)
    $densities += ,@('hdpi',    72,  162)
    $densities += ,@('xhdpi',   96,  216)
    $densities += ,@('xxhdpi',  144, 324)
    $densities += ,@('xxxhdpi', 192, 432)

    foreach ($d in $densities) {
        $dir = Join-Path $resDir ('mipmap-' + $d[0])
        New-Icon -Size $d[1] -Shape 'rounded'  -Path (Join-Path $dir 'ic_launcher.png')
        New-Icon -Size $d[1] -Shape 'circle'   -Path (Join-Path $dir 'ic_launcher_round.png')
        New-Icon -Size $d[2] -Shape 'adaptive' -Path (Join-Path $dir 'ic_launcher_foreground.png')
    }

    # 通知の小アイコン。Android は非透明部分を白一色に塗り潰すので、透明の上に白で描く
    $notif = @()
    $notif += ,@('mdpi',    24)
    $notif += ,@('hdpi',    36)
    $notif += ,@('xhdpi',   48)
    $notif += ,@('xxhdpi',  72)
    $notif += ,@('xxxhdpi', 96)
    foreach ($n in $notif) {
        $dir = Join-Path $resDir ('drawable-' + $n[0])
        New-Icon -Size $n[1] -Shape 'notification' -Path (Join-Path $dir 'ic_stat_ponichi.png')
    }

    # アダプティブアイコンの背景色（前景が透明なので、ここが下地になる）と、
    # 起動画面の地色。どちらもアプリのライトテーマと同じ紙の色に合わせる
    $bgXml = @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#F7F5F0</color>
    <color name="splash_background">#F7F5F0</color>
</resources>
'@
    $bgPath = Join-Path $resDir 'values\ic_launcher_background.xml'
    [System.IO.File]::WriteAllText($bgPath, $bgXml, [System.Text.UTF8Encoding]::new($false))
    Write-Output '  ic_launcher_background.xml         #F7F5F0'
}

Write-Output ''
Write-Output '完了'
