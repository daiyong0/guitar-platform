# Generates deterministic demo artwork and tab-bar icons.
# The generated PNG files are committed, so running this script is optional.
# Requires Windows PowerShell with System.Drawing (Developer Mode environment).
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tabDir = Join-Path $root 'miniprogram\assets\tabbar'
$imgDir = Join-Path $root 'miniprogram\assets\images'
$seedDir = Join-Path $root 'uploads\seed'
New-Item -ItemType Directory -Force -Path $tabDir, $imgDir, $seedDir | Out-Null

function Hex-Brush([string]$hex) {
  return [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($hex))
}
function Hex-Pen([string]$hex, [float]$width) {
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($hex), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  return $pen
}
function Rounded-Path([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
function Font([float]$size, [string]$style = 'Regular') {
  $s = [System.Drawing.FontStyle]::Regular
  if ($style -eq 'Bold') { $s = [System.Drawing.FontStyle]::Bold }
  return [System.Drawing.Font]::new('Microsoft YaHei', $size, $s, [System.Drawing.GraphicsUnit]::Pixel)
}
function Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  return @{ Bitmap = $bmp; Graphics = $g; Width = $w; Height = $h }
}
function Close-Canvas($c, [string]$path, [int]$quality = 100) {
  $c.Graphics.Dispose()
  if ($quality -ge 100) {
    $c.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $c.Bitmap.Save($path, $enc, $ep)
    $ep.Dispose()
  }
  $c.Bitmap.Dispose()
}
function Draw-Pill($g, [string]$text, [float]$x, [float]$y, [string]$bg, [string]$fg, [float]$size = 18) {
  $font = Font $size 'Bold'
  $sz = $g.MeasureString($text, $font)
  $w = $sz.Width + 28
  $h = $sz.Height + 10
  $path = Rounded-Path $x $y $w $h ($h / 2)
  $brush = Hex-Brush $bg
  $g.FillPath($brush, $path)
  $textBrush = Hex-Brush $fg
  $g.DrawString($text, $font, $textBrush, $x + 14, $y + 4)
  $brush.Dispose(); $textBrush.Dispose(); $font.Dispose(); $path.Dispose()
}
function Draw-GuitarLines($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$color, [float]$alphaWidth = 1.2) {
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($color), $alphaWidth)
  for ($i = 0; $i -lt 6; $i++) {
    $yy = $y + ($h / 5) * $i
    $g.DrawLine($pen, $x, $yy, $x + $w, $yy)
  }
  $neckPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($color), $alphaWidth * 1.4)
  for ($i = 0; $i -le 8; $i++) {
    $xx = $x + ($w / 8) * $i
    $g.DrawLine($neckPen, $xx, $y, $xx, $y + $h)
  }
  $pen.Dispose(); $neckPen.Dispose()
}

# ---------- tab bar icons (81 x 81, transparent PNG) ----------
function New-TabIcon([string]$kind, [string]$color, [string]$file) {
  $c = Canvas 81 81
  $g = $c.Graphics
  $pen = Hex-Pen $color 4.6
  $fill = Hex-Brush $color
  if ($kind -eq 'scores') {
    $sheet = Rounded-Path 15 10 51 61 10
    $g.DrawPath($pen, $sheet)
    $linePen = Hex-Pen $color 2.6
    foreach ($y in @(27, 38, 49, 60)) { $g.DrawLine($linePen, 25, $y, 56, $y) }
    $g.FillEllipse($fill, 39, 22, 17, 13)
    $linePen.Dispose(); $sheet.Dispose()
  } elseif ($kind -eq 'videos') {
    $screen = Rounded-Path 11 16 59 49 12
    $g.DrawPath($pen, $screen)
    $pts = [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new(34, 29),
      [System.Drawing.PointF]::new(53, 40.5),
      [System.Drawing.PointF]::new(34, 52)
    )
    $g.FillPolygon($fill, $pts)
    $g.DrawArc($pen, 26, 66, 29, 8, 200, 140)
    $screen.Dispose()
  } else {
    $g.DrawEllipse($pen, 27, 12, 27, 27)
    $shoulders = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $shoulders.AddBezier(13, 70, 17, 48, 30, 44, 40.5, 44)
    $shoulders.AddBezier(40.5, 44, 51, 44, 64, 48, 68, 70)
    $g.DrawPath($pen, $shoulders)
    $shoulders.Dispose()
  }
  $pen.Dispose(); $fill.Dispose()
  Close-Canvas $c $file
}

foreach ($icon in @(
  @('scores', '#9B948B', 'scores.png'),
  @('scores', '#E55B2D', 'scores-active.png'),
  @('videos', '#9B948B', 'videos.png'),
  @('videos', '#E55B2D', 'videos-active.png'),
  @('mine', '#9B948B', 'mine.png'),
  @('mine', '#E55B2D', 'mine-active.png')
)) {
  New-TabIcon $icon[0] $icon[1] (Join-Path $tabDir $icon[2])
}

# ---------- score cover art ----------
$scoreArts = @(
  @{ Slug='summer-breeze'; Title='夏夜微风'; Sub='弹唱入门 · 四和弦'; Tag='弹唱'; No='NO. 012'; Bg1='#20302C'; Bg2='#49685B'; Accent='#F2C078'; Ink='#F7F0E2' },
  @{ Slug='dusk-highway'; Title='暮色公路'; Sub='扫弦律动 · 进阶练习'; Tag='进阶'; No='NO. 026'; Bg1='#4A2C21'; Bg2='#A45A32'; Accent='#F4D6A0'; Ink='#FFF5E8' },
  @{ Slug='starlight'; Title='星河入梦'; Sub='指弹独奏 · 标准调弦'; Tag='指弹'; No='NO. 031'; Bg1='#1B2638'; Bg2='#314A66'; Accent='#B5D8E8'; Ink='#F4F1E8' },
  @{ Slug='first-lesson'; Title='木吉他第一课'; Sub='零基础 · 持琴与拨弦'; Tag='入门'; No='NO. 001'; Bg1='#DCC9A8'; Bg2='#EEDFC4'; Accent='#A6502A'; Ink='#2E2922' },
  @{ Slug='rain-lane'; Title='雨巷'; Sub='分解和弦 · 弹唱'; Tag='弹唱'; No='NO. 043'; Bg1='#263238'; Bg2='#4F6266'; Accent='#E9C46A'; Ink='#F7F1E3' },
  @{ Slug='grow-in-light'; Title='逆光生长'; Sub='高把位指弹编配'; Tag='指弹'; No='NO. 057'; Bg1='#422D2A'; Bg2='#8E4A3D'; Accent='#F0BC8C'; Ink='#FFF3E7' }
)

foreach ($a in $scoreArts) {
  $c = Canvas 720 960
  $g = $c.Graphics
  $rect = [System.Drawing.Rectangle]::new(0, 0, 720, 960)
  $grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml($a.Bg1), [System.Drawing.ColorTranslator]::FromHtml($a.Bg2), 55)
  $g.FillRectangle($grad, $rect)
  # decorative rings and sound-hole arcs
  $ringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(38, 255, 245, 225), 2)
  $g.DrawEllipse($ringPen, 430, -120, 420, 420)
  $g.DrawEllipse($ringPen, 500, -50, 280, 280)
  $g.DrawArc($ringPen, 505, 560, 330, 330, 120, 170)
  $ringPen.Dispose()
  # fretboard motif
  $board = Rounded-Path 526 575 118 420 12
  $boardBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 0, 0, 0))
  $g.FillPath($boardBrush, $board)
  $boardBrush.Dispose(); $board.Dispose()
  $stringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(65, 255, 246, 230), 1.5)
  for ($i = 0; $i -lt 6; $i++) { $g.DrawLine($stringPen, 536 + $i * 20, 575, 536 + $i * 20, 995) }
  for ($i = 0; $i -lt 8; $i++) { $g.DrawLine($stringPen, 526, 630 + $i * 52, 644, 630 + $i * 52) }
  $stringPen.Dispose()
  # top labels
  $microFont = Font 17 'Bold'
  $microBrush = Hex-Brush $a.Accent
  $g.DrawString('XIAN JIAN  /  GUITAR TAB', $microFont, $microBrush, 50, 50)
  $g.DrawString($a.No, $microFont, $microBrush, 576, 50)
  $microFont.Dispose(); $microBrush.Dispose()
  # title and copy
  $titleFont = Font 92 'Bold'
  $subFont = Font 25 'Regular'
  $tagFont = Font 20 'Bold'
  $ink = Hex-Brush $a.Ink
  $accentBrush = Hex-Brush $a.Accent
  $g.DrawString($a.Title, $titleFont, $ink, 45, 580)
  $g.DrawString($a.Sub, $subFont, $accentBrush, 52, 705)
  $tagPath = Rounded-Path 50 790 138 48 24
  $tagBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, [System.Drawing.ColorTranslator]::FromHtml($a.Accent)))
  $g.FillPath($tagBrush, $tagPath)
  $tagTextBrush = Hex-Brush $a.Bg1
  $g.DrawString($a.Tag, $tagFont, $tagTextBrush, 98, 801)
  $footFont = Font 17 'Bold'
  $g.DrawString('弦间谱库 · 保持练习', $footFont, $ink, 50, 878)
  $footFont.Dispose()
  # top right small strings motif
  $artPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(90, 255, 246, 230), 2)
  for ($i = 0; $i -lt 6; $i++) { $g.DrawLine($artPen, 80 + $i * 46, 100, 380 + $i * 26, 380) }
  $artPen.Dispose()
  $titleFont.Dispose(); $subFont.Dispose(); $tagFont.Dispose(); $ink.Dispose(); $accentBrush.Dispose(); $tagBrush.Dispose(); $tagTextBrush.Dispose(); $tagPath.Dispose()
  Close-Canvas $c (Join-Path $seedDir "cover-$($a.Slug).png")
}

# ---------- share cards / fallback ----------
$c = Canvas 500 400
$g = $c.Graphics
$rect = [System.Drawing.Rectangle]::new(0, 0, 500, 400)
$grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml('#1F2D29'), [System.Drawing.ColorTranslator]::FromHtml('#49685B'), 20)
$g.FillRectangle($grad, $rect)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 255, 245, 225), 2)
for ($i = 0; $i -lt 6; $i++) { $g.DrawLine($pen, 0, 120 + $i * 40, 500, 40 + $i * 52) }
$pen.Dispose()
$font = Font 48 'Bold'; $sub = Font 20 'Regular'; $ink = Hex-Brush '#F7F0E2'; $orange = Hex-Brush '#F2C078'
$g.DrawString('弦间', $font, $ink, 40, 120)
$g.DrawString('吉他谱 · 直播回放 · 每一次拨弦都有回响', $sub, $orange, 44, 205)
$font.Dispose(); $sub.Dispose(); $ink.Dispose(); $orange.Dispose()
Close-Canvas $c (Join-Path $imgDir 'share-default.png')

$c = Canvas 600 800
$g = $c.Graphics
$rect = [System.Drawing.Rectangle]::new(0, 0, 600, 800)
$grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml('#23231F'), [System.Drawing.ColorTranslator]::FromHtml('#55584C'), 90)
$g.FillRectangle($grad, $rect)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(75, 255, 248, 235), 2)
$g.DrawEllipse($pen, 160, 230, 280, 280)
$g.DrawEllipse($pen, 220, 290, 160, 160)
$g.DrawEllipse($pen, 265, 335, 70, 70)
$pen.Dispose()
$f1 = Font 34 'Bold'; $f2 = Font 18 'Regular'; $b1 = Hex-Brush '#F5EBDC'; $b2 = Hex-Brush '#D1B896'
$g.DrawString('弦间', $f1, $b1, 245, 620)
$g.DrawString('GUITAR TAB ARCHIVE', $f2, $b2, 205, 678)
$f1.Dispose(); $f2.Dispose(); $b1.Dispose(); $b2.Dispose()
Close-Canvas $c (Join-Path $imgDir 'cover-fallback.png')

# ---------- video covers (960 x 540) ----------
$videoArts = @(
  @{ Slug='live-summer'; Title='夏夜微风'; Sub='指弹现场 · 完整回放'; Tag='现场回放'; Bg1='#1D2A27'; Bg2='#5D7C6E'; Accent='#F0BC7D' },
  @{ Slug='rhythm-class'; Title='扫弦节奏训练 01'; Sub='四分音符与八分音符'; Tag='教学回放'; Bg1='#39261F'; Bg2='#9C563A'; Accent='#F3D5A0' },
  @{ Slug='studio-diary'; Title='录音棚日记'; Sub='暮色公路 · 吉他分轨'; Tag='幕后'; Bg1='#20242D'; Bg2='#4C566C'; Accent='#C2D7E4' },
  @{ Slug='harmonic-demo'; Title='指弹泛音示范'; Sub='星河入梦 · 泛音段落拆解'; Tag='技巧'; Bg1='#313027'; Bg2='#76704B'; Accent='#E8D7A2' }
)
foreach ($a in $videoArts) {
  $c = Canvas 960 540
  $g = $c.Graphics
  $rect = [System.Drawing.Rectangle]::new(0, 0, 960, 540)
  $grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml($a.Bg1), [System.Drawing.ColorTranslator]::FromHtml($a.Bg2), 25)
  $g.FillRectangle($grad, $rect)
  $ring = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(35, 255, 248, 235), 2)
  $g.DrawEllipse($ring, 430, -170, 640, 640)
  $g.DrawEllipse($ring, 530, -70, 440, 440)
  for ($i = 0; $i -lt 6; $i++) { $g.DrawLine($ring, 620 + $i * 34, 0, 330 + $i * 48, 540) }
  $ring.Dispose()
  $tagFont = Font 18 'Bold'; $t1 = Font 46 'Bold'; $t2 = Font 19 'Regular'
  $ink = Hex-Brush '#FFF7EB'; $accent = Hex-Brush $a.Accent
  $w = [Math]::Min(580, $g.MeasureString($a.Title, $t1).Width + 20)
  $panel = Rounded-Path 54 340 610 140 20
  $panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
  $g.FillPath($panelBrush, $panel); $panelBrush.Dispose(); $panel.Dispose()
  $g.DrawString($a.Title, $t1, $ink, 70, 368)
  $g.DrawString($a.Sub, $t2, $accent, 74, 431)
  $g.DrawString($a.Tag, $tagFont, $accent, 74, 64)
  $g.DrawString('弦间 · LIVE ARCHIVE', $tagFont, $ink, 676, 64)
  # play button
  $play = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $play.AddEllipse(770, 195, 120, 120)
  $pb = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(200, 255, 246, 231))
  $g.FillPath($pb, $play)
  $tri = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(812, 232),
    [System.Drawing.PointF]::new(850, 255),
    [System.Drawing.PointF]::new(812, 278)
  )
  $tb = Hex-Brush $a.Bg1
  $g.FillPolygon($tb, $tri)
  $tagFont.Dispose(); $t1.Dispose(); $t2.Dispose(); $ink.Dispose(); $accent.Dispose(); $pb.Dispose(); $tb.Dispose(); $play.Dispose()
  Close-Canvas $c (Join-Path $seedDir "video-$($a.Slug).png")
}

# ---------- tablature pages ----------
$pageMeta = @{
  'summer-breeze' = @{ Title='夏夜微风'; Artist='词 / 曲：示例创作者'; Key='C 调 · 4/4'; Capo='Capo 2'; Song='夏夜微风' }
  'dusk-highway' = @{ Title='暮色公路'; Artist='词 / 曲：示例创作者'; Key='G 调 · 4/4'; Capo='Capo 0'; Song='暮色公路' }
  'starlight' = @{ Title='星河入梦'; Artist='编配：弦间指弹'; Key='DADGAD · 4/4'; Capo='Capo 0'; Song='星河入梦' }
  'first-lesson' = @{ Title='木吉他第一课'; Artist='弦间入门教程 01'; Key='C 调 · 4/4'; Capo='—'; Song='第一课' }
  'rain-lane' = @{ Title='雨巷'; Artist='词 / 曲：示例创作者'; Key='Am 调 · 3/4'; Capo='Capo 3'; Song='雨巷' }
  'grow-in-light' = @{ Title='逆光生长'; Artist='编配：弦间指弹'; Key='E 调 · 4/4'; Capo='Capo 0'; Song='逆光生长' }
}
$chords = @('C', 'G', 'Am', 'F', 'Em', 'Dm', 'G/B', 'Cadd9')
$sections = @('前奏 INTRO', '主歌 VERSE', '副歌 CHORUS', '间奏 INTERLUDE')
foreach ($slug in $pageMeta.Keys) {
  $meta = $pageMeta[$slug]
  foreach ($pageNo in 1, 2) {
    $c = Canvas 900 1200
    $g = $c.Graphics
    $paper = Hex-Brush '#FFFCF6'; $g.FillRectangle($paper, 0, 0, 900, 1200); $paper.Dispose()
    $rulePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#EDE4D5'), 1)
    for ($i = 0; $i -lt 13; $i++) { $g.DrawLine($rulePen, 52, 160 + $i * 79, 848, 160 + $i * 79) }
    $rulePen.Dispose()
    $brand = Font 15 'Bold'; $brandBrush = Hex-Brush '#B3613C'
    $g.DrawString('弦 间 谱 库   /   XIAN JIAN GUITAR', $brand, $brandBrush, 54, 44)
    $g.DrawString("PAGE 0$pageNo", $brand, $brandBrush, 765, 44)
    $brand.Dispose(); $brandBrush.Dispose()
    $titleFont = Font 42 'Bold'; $metaFont = Font 17 'Regular'; $smallFont = Font 15 'Regular'
    $ink = Hex-Brush '#272723'; $muted = Hex-Brush '#7C766D'
    $g.DrawString($meta.Title, $titleFont, $ink, 50, 82)
    $g.DrawString("$($meta.Artist)    |    $($meta.Key)    |    $($meta.Capo)", $metaFont, $muted, 54, 128)
    $headerLine = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#272723'), 2)
    $g.DrawLine($headerLine, 52, 178, 848, 178)
    $headerLine.Dispose()
    $sectFont = Font 18 'Bold'
    $tabFont = Font 14 'Bold'
    $tabInk = Hex-Brush '#3D3A34'; $accentInk = Hex-Brush '#A24F2D'; $tabMuted = Hex-Brush '#968D80'
    $y = 212
    $secStart = if ($pageNo -eq 1) { 0 } else { 2 }
    for ($section = 0; $section -lt 2; $section++) {
      $idx = ($secStart + $section) % $sections.Length
      $g.DrawString($sections[$idx], $sectFont, $accentInk, 54, $y)
      $chordText = "$($chords[($idx) % $chords.Length])        $($chords[($idx + 1) % $chords.Length])        $($chords[($idx + 2) % $chords.Length])        $($chords[($idx + 3) % $chords.Length])"
      $g.DrawString($chordText, $sectFont, $tabInk, 286, $y - 2)
      $y += 42
      # 6 strings / tab staff with fret numbers and bars
      $tabPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#A9A092'), 1.2)
      for ($s = 0; $s -lt 6; $s++) {
        $yy = $y + $s * 17
        $g.DrawLine($tabPen, 56, $yy, 842, $yy)
        $g.DrawString(('eBGDAE'[$s]).ToString(), $smallFont, $tabMuted, 34, $yy - 12)
      }
      $tabPen.Dispose()
      $barPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#6C665D'), 1.4)
      for ($b = 0; $b -le 4; $b++) {
        $xx = 56 + $b * 196.5
        $g.DrawLine($barPen, $xx, $y, $xx, $y + 85)
      }
      $barPen.Dispose()
      # deterministic fret markers
      $rng = [System.Random]::new(($slug.GetHashCode() + $pageNo * 31 + $section * 13))
      for ($b = 0; $b -lt 4; $b++) {
        for ($n = 0; $n -lt 4; $n++) {
          $stringIdx = $rng.Next(0, 6)
          $fret = $rng.Next(0, 8)
          $xx = 58 + $b * 196.5 + 18 + $n * 41
          $yy = $y + $stringIdx * 17
          $dotBrush = $accentInk
          if ($fret -gt 0) { $g.FillEllipse($dotBrush, $xx + 5, $yy - 8, 16, 16) }
          $numColor = if ($fret -gt 0) { Hex-Brush '#FFFCF6' } else { $accentInk }
          $g.DrawString("$fret", $tabFont, $numColor, $xx + 8, $yy - 9)
          if ($fret -gt 0) { $numColor.Dispose() }
        }
      }
      # lyric line
      $lyric = if ($idx % 2 -eq 0) { '风从窗边经过　把夏夜轻轻拨亮' } else { '沿着和弦的方向　我们慢慢唱' }
      $g.DrawString($lyric, $metaFont, $muted, 150, $y + 116)
      $y += 160
    }
    # practice note block
    $noteRect = Rounded-Path 54 968 790 126 14
    $noteBg = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F4EDDF'))
    $g.FillPath($noteBg, $noteRect)
    $g.DrawString('练习提示  /  PRACTICE NOTE', $sectFont, $accentInk, 76, 988)
    if ($pageNo -eq 1) {
      $tip = '按 4/4 拍慢速练习，先确认左手和弦转换位置，再加入右手分解。'
    } else {
      $tip = '副歌情绪推进时保持右手力度稳定，尾音让它在拍点后自然衰减。'
    }
    $g.DrawString($tip, $metaFont, $tabInk, 76, 1030)
    $g.DrawString('节拍 72 BPM   ·   标准调弦 E A D G B E   ·   弦间谱库', $smallFont, $muted, 76, 1065)
    $footerPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#D7CDBD'), 1)
    $g.DrawLine($footerPen, 54, 1136, 844, 1136)
    $footerPen.Dispose()
    $g.DrawString('仅供学习交流 · 请支持正版音乐', $smallFont, $muted, 54, 1153)
    $g.DrawString("$pageNo / 2", $smallFont, $muted, 790, 1153)
    $titleFont.Dispose(); $metaFont.Dispose(); $smallFont.Dispose(); $ink.Dispose(); $muted.Dispose(); $sectFont.Dispose(); $tabFont.Dispose(); $tabInk.Dispose(); $accentInk.Dispose(); $tabMuted.Dispose(); $noteRect.Dispose(); $noteBg.Dispose()
    Close-Canvas $c (Join-Path $seedDir "tab-$slug-$pageNo.png")
  }
}

Write-Output "Generated assets in $seedDir, $tabDir and $imgDir"

# ---------- compact share images (5:4 JPEG, each well under 128KB) ----------
$shareArts = @(
  @{ Source='cover-summer-breeze.png'; File='share-score-summer-breeze.jpg'; Label='夏夜微风'; Type='弹唱吉他谱' },
  @{ Source='cover-dusk-highway.png'; File='share-score-dusk-highway.jpg'; Label='暮色公路'; Type='进阶弹唱谱' },
  @{ Source='cover-starlight.png'; File='share-score-starlight.jpg'; Label='星河入梦'; Type='指弹吉他谱' },
  @{ Source='cover-first-lesson.png'; File='share-score-first-lesson.jpg'; Label='木吉他第一课'; Type='入门吉他谱' },
  @{ Source='cover-rain-lane.png'; File='share-score-rain-lane.jpg'; Label='雨巷'; Type='弹唱吉他谱' },
  @{ Source='cover-grow-in-light.png'; File='share-score-grow-in-light.jpg'; Label='逆光生长'; Type='指弹吉他谱' },
  @{ Source='video-live-summer.png'; File='share-video-live-summer.jpg'; Label='夏夜微风'; Type='指弹现场回放' },
  @{ Source='video-rhythm-class.png'; File='share-video-rhythm-class.jpg'; Label='扫弦节奏训练'; Type='教学视频回放' },
  @{ Source='video-studio-diary.png'; File='share-video-studio-diary.jpg'; Label='录音棚日记'; Type='幕后视频回放' },
  @{ Source='video-harmonic-demo.png'; File='share-video-harmonic-demo.jpg'; Label='指弹泛音示范'; Type='技巧视频回放' }
)
foreach ($s in $shareArts) {
  $srcPath = Join-Path $seedDir $s.Source
  if (-not (Test-Path $srcPath)) { continue }
  $source = [System.Drawing.Image]::FromFile($srcPath)
  $c = Canvas 500 400
  $g = $c.Graphics
  $scaledH = [int](500 * $source.Height / $source.Width)
  $srcRect = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
  $destRect = [System.Drawing.Rectangle]::new(0, [int](($scaledH - 400) / -2), 500, $scaledH)
  $g.DrawImage($source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $overlay = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 12, 16, 15))
  $g.FillRectangle($overlay, 0, 0, 500, 400)
  $overlay.Dispose()
  $accent = Hex-Brush '#E5B478'
  $white = Hex-Brush '#FFF8EC'
  $small = Font 17 'Bold'; $big = Font 39 'Bold'
  $g.DrawString('弦间  /  ' + $s.Type, $small, $accent, 38, 266)
  $g.DrawString($s.Label, $big, $white, 36, 300)
  $small.Dispose(); $big.Dispose(); $accent.Dispose(); $white.Dispose()
  $source.Dispose()
  Close-Canvas $c (Join-Path $seedDir $s.File) 82
}

Get-ChildItem $seedDir, $tabDir, $imgDir -File | Select-Object Name, Length | Format-Table -AutoSize

# ---------- compact card covers used by server seed ----------
# The content seed points to cover-*.jpg and video-*.jpg (each comfortably
# below the 128KB share-image limit), while tablature pages stay lossless PNG.
$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$coverSources = @(Get-ChildItem $seedDir -File -Filter 'cover-*.png') + @(Get-ChildItem $seedDir -File -Filter 'video-*.png')
foreach ($sourceFile in $coverSources) {
  $sourceImage = [System.Drawing.Image]::FromFile($sourceFile.FullName)
  $coverBitmap = New-Object System.Drawing.Bitmap $sourceImage.Width, $sourceImage.Height
  $coverGraphics = [System.Drawing.Graphics]::FromImage($coverBitmap)
  $coverGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $coverGraphics.DrawImage($sourceImage, 0, 0, $sourceImage.Width, $sourceImage.Height)
  $coverGraphics.Dispose()
  $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]86)
  $jpegPath = Join-Path $seedDir ([System.IO.Path]::GetFileNameWithoutExtension($sourceFile.Name) + '.jpg')
  $coverBitmap.Save($jpegPath, $jpegEncoder, $encoderParams)
  $encoderParams.Dispose()
  $coverBitmap.Dispose()
  $sourceImage.Dispose()
}

# Share fallback is served from the backend so small programs get a stable URL.
Copy-Item -Force (Join-Path $imgDir 'share-default.png') (Join-Path $seedDir 'share-default.png')

Write-Output 'Generated compressed cover JPEGs and server share fallback.'
Get-ChildItem $seedDir, $tabDir, $imgDir -File | Select-Object Name, Length | Format-Table -AutoSize
