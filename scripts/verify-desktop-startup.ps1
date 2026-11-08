param([Parameter(Mandatory=$true)][string]$InstalledExe)
$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent (Resolve-Path -LiteralPath $InstalledExe).Path
$nodeFile = Join-Path $installRoot 'resources\desktop\node\node.exe'
$backupFile = Join-Path $installRoot 'resources\desktop\node\node.exe.parallax-verification-backup'
if ((Get-Process parallax-ai -ErrorAction SilentlyContinue)) { throw 'Close the installed app before the startup failure check.' }
if (-not (Test-Path -LiteralPath $nodeFile) -or (Test-Path -LiteralPath $backupFile)) { throw 'The installed runtime is missing or a previous backup exists.' }
if ((Split-Path -Parent $nodeFile) -ne (Split-Path -Parent $backupFile)) { throw 'Runtime backup must stay beside the installed test file.' }
$originalHash = (Get-FileHash -LiteralPath $nodeFile -Algorithm SHA256).Hash
$data = Join-Path $env:LOCALAPPDATA ('dev.parallax-ai.desktop\verification-startup-' + [Guid]::NewGuid().ToString())
$env:PARALLAX_DESKTOP_TEST = '1'
$env:PARALLAX_DESKTOP_DATA_DIR = $data
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ParallaxFailureWindow {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
[ParallaxFailureWindow]::SetProcessDPIAware() | Out-Null
$app = $null
try {
  Move-Item -LiteralPath $nodeFile -Destination $backupFile
  $app = Start-Process -FilePath $InstalledExe -WindowStyle Normal -PassThru
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Parallax could not start')
  $dialog = $null
  for ($attempt=0; $attempt -lt 150; $attempt++) {
    $dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
    if ($null -ne $dialog) { break }
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $dialog) { throw 'Native startup error dialog was not shown.' }
  $textCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)
  $message = ($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,$textCondition) | ForEach-Object { $_.Current.Name }) -join ' '
  if ($message -notmatch 'Bundled Node runtime is missing') { throw "Unexpected startup failure: $message" }
  $rectangle = [ParallaxFailureWindow+Rect]::new()
  [ParallaxFailureWindow]::GetWindowRect([IntPtr]$dialog.Current.NativeWindowHandle,[ref]$rectangle) | Out-Null
  $image = [System.Drawing.Bitmap]::new(($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top))
  $graphics = [System.Drawing.Graphics]::FromImage($image)
  $deviceContext = $graphics.GetHdc()
  try {
    if (-not [ParallaxFailureWindow]::PrintWindow([IntPtr]$dialog.Current.NativeWindowHandle,$deviceContext,2)) { throw 'Native dialog capture failed.' }
  } finally { $graphics.ReleaseHdc($deviceContext) }
  $image.Save((Join-Path (Get-Location).Path 'artifacts\desktop\startup-failure.png'))
  $graphics.Dispose();$image.Dispose()
  @{dialogShown=$true;message=$message;data=$data;installedExe=$InstalledExe} | ConvertTo-Json | Set-Content artifacts/desktop/startup-failure-proof.json -Encoding utf8
  $button=[ParallaxFailureWindow]::GetDlgItem([IntPtr]$dialog.Current.NativeWindowHandle,1)
  if ($button -ne [IntPtr]::Zero) { [ParallaxFailureWindow]::SendMessage($button,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null }
} finally {
  if ($null -ne $app) { if (-not $app.WaitForExit(5000)) { Stop-Process -Id $app.Id } }
  if (Test-Path -LiteralPath $backupFile) { Move-Item -LiteralPath $backupFile -Destination $nodeFile }
  if ((Get-FileHash -LiteralPath $nodeFile -Algorithm SHA256).Hash -ne $originalHash) { throw 'The installed Node runtime was not restored exactly.' }
}
Write-Output 'Native startup failure dialog verified; installed runtime restored exactly.'
