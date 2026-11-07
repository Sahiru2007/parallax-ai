$ErrorActionPreference = 'Stop'
# No secrets in argv, environment, temporary files, or error output. JSON is read from stdin.
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ParallaxCredentials {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Write(ref Credential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool Delete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
  public static string Get(string target) {
    IntPtr pointer;
    if (!Read(target, 1, 0, out pointer)) {
      int code = Marshal.GetLastWin32Error();
      if (code == 1168) return null;
      throw new Exception("Credential read failed (Windows " + code + ")");
    }
    try {
      var value = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      return Marshal.PtrToStringUni(value.CredentialBlob, (int)value.CredentialBlobSize / 2);
    } finally { CredFree(pointer); }
  }
  public static void Set(string target, string secret) {
    var bytes = Encoding.Unicode.GetBytes(secret);
    IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, memory, bytes.Length);
      var value = new Credential { Type=1, TargetName=target, CredentialBlobSize=(UInt32)bytes.Length,
        CredentialBlob=memory, Persist=2, UserName="PARALLAX AI" };
      if (!Write(ref value, 0)) throw new Exception("Credential write failed (Windows " + Marshal.GetLastWin32Error() + ")");
    } finally {
      for (int i=0; i<bytes.Length; i++) Marshal.WriteByte(memory, i, 0);
      Array.Clear(bytes, 0, bytes.Length); Marshal.FreeHGlobal(memory);
    }
  }
  public static void Remove(string target) {
    if (!Delete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168)
      throw new Exception("Credential removal failed (Windows " + Marshal.GetLastWin32Error() + ")");
  }
}
'@
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  switch ($inputData.operation) {
    'get' { @{ value = [ParallaxCredentials]::Get($inputData.target) } | ConvertTo-Json -Compress }
    'set' { [ParallaxCredentials]::Set($inputData.target, $inputData.value); '{"ok":true}' }
    'remove' { [ParallaxCredentials]::Remove($inputData.target); '{"ok":true}' }
    default { throw 'Unknown credential operation' }
  }
} catch {
  # Deliberately do not print PowerShell ErrorRecord, which could include input.
  [Console]::Error.WriteLine('Windows Credential Manager operation failed. Check access to your Windows user credential store.')
  exit 1
}
