param([Parameter(Mandatory=$true)][string]$Repository, [switch]$Cancel)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ParallaxDialogWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Open a local Git repository')
$dialog = $null
for ($attempt=0; $attempt -lt 150; $attempt++) {
  $dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($null -ne $dialog) { break }
  Start-Sleep -Milliseconds 100
}
if ($null -eq $dialog) { throw 'The real Windows folder picker did not appear.' }
# The app opens the real picker at the entered verification repository. Accept
# its native default button by HWND, without global keystrokes or a fake result.
$dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle
$buttonId = if ($Cancel) { 2 } else { 1 }
$buttonHandle = [IntPtr]::Zero
for ($attempt=0; $attempt -lt 100; $attempt++) {
  $buttonHandle = [ParallaxDialogWindow]::GetDlgItem($dialogHandle, $buttonId)
  if ($buttonHandle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
}
if ($buttonHandle -eq [IntPtr]::Zero) { throw 'The native dialog button was unavailable.' }
[ParallaxDialogWindow]::SendMessage($buttonHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output 'Accepted the real Windows folder picker at the verification repository.'
