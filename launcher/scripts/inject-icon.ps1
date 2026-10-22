# launcher/scripts/inject-icon.ps1
# Uses PowerShell .NET to inject icon into PE file via Windows API
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinResInjector {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResourceW(string pFileName, bool bDeleteExistingContents);
    
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, 
        ushort wLanguage, byte[] lpData, uint cbData);
    
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool EndUpdateResourceW(IntPtr hUpdate, bool fDiscard);
    
    public const int RT_ICON = 3;
    public const int RT_GROUP_ICON = 16;
    
    public static IntPtr MAKEINTRESOURCE(int id) {
        return new IntPtr(id);
    }
}
"@

$exePath = $args[0]
$icoPath = $args[1]

if (-not (Test-Path $exePath)) {
    Write-Error "PE not found: $exePath"
    exit 1
}
if (-not (Test-Path $icoPath)) {
    Write-Error "ICO not found: $icoPath"
    exit 1
}

Write-Host "Reading ICO: $icoPath"
$icoData = [System.IO.File]::ReadAllBytes($icoPath)
Write-Host "ICO size: $($icoData.Length) bytes"

Write-Host "Starting resource update..."
$hUpdate = [WinResInjector]::BeginUpdateResourceW($exePath, $false)
if ($hUpdate -eq [IntPtr]::Zero) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "BeginUpdateResourceW failed: $err"
    exit 1
}
Write-Host "Handle: $hUpdate"

try {
    # Read ICO header
    $count = [BitConverter]::ToInt16($icoData, 4)  # ICO count (16-bit at offset 4)
    Write-Host "Icon count: $count"
    
    $offset = 6
    for ($i = 0; $i -lt $count; $i++) {
        $width = $icoData[$offset]
        $imageOffset = [BitConverter]::ToInt32($icoData, $offset + 12)
        $imageSize = [BitConverter]::ToUInt32($icoData, $offset + 8)
        
        $iconData = $icoData | Select-Object -Skip $imageOffset -First $imageSize
        
        Write-Host "  Adding RT_ICON #$($i+1) ($width x $width): $($iconData.Length) bytes"
        
        # Try UpdateResourceW with integer IDs
        $result = [WinResInjector]::UpdateResourceW(
            $hUpdate,
            [WinResInjector]::MAKEINTRESOURCE([WinResInjector]::RT_ICON),
            [WinResInjector]::MAKEINTRESOURCE($i + 1),
            0,  # Language
            $iconData,
            [uint32]$iconData.Length
        )
        
        if (-not $result) {
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            Write-Warning "  FAIL: RT_ICON #$($i+1): error $err"
        } else {
            Write-Host "  OK"
        }
        
        $offset += 16
    }
    
    # Build RT_GROUP_ICON data
    Write-Host "Building RT_GROUP_ICON..."
    # Header: reserved(2) + type(2) + count(2) = 6 bytes
    $groupHeader = [BitConverter]::GetBytes(0) + [BitConverter]::GetBytes(1) + [BitConverter]::GetBytes([UInt16]$count)
    
    # Directory entries: width(1) + height(1) + color_count(1) + reserved(1) + planes(2) + bpp(2) + size(4) + id(4) = 16 bytes each
    $groupDir = @()
    $offset = 6
    for ($i = 0; $i -lt $count; $i++) {
        $width = $icoData[$offset]
        $id = $i + 1
        
        $entry = @()
        $entry += $width  # Width
        $entry += $width  # Height (same as width for square icons)
        $entry += 0       # Color count (0 = true color with alpha)
        $entry += 0       # Reserved
        $entry += [BitConverter]::GetBytes([UInt16]1)  # Color planes
        $entry += [BitConverter]::GetBytes([UInt16]32)  # Bits per pixel
        
        # Find the image size for this icon
        $imageOffset = [BitConverter]::ToInt32($icoData, $offset + 12)
        $imageSize = [BitConverter]::ToUInt32($icoData, $offset + 8)
        $entry += [BitConverter]::GetBytes($imageSize)  # Bytes in image
        
        # ID (as 32-bit)
        $entry += [BitConverter]::GetBytes([uint32]$id)
        
        $groupDir += $entry
        $offset += 16
    }
    
    # Flatten group dir
    $groupBytes = @()
    foreach ($entry in $groupDir) {
        $groupBytes += $entry
    }
    
    $groupData = $groupHeader + $groupBytes
    
    Write-Host "RT_GROUP_ICON data: $($groupData.Length) bytes"
    
    $result = [WinResInjector]::UpdateResourceW(
        $hUpdate,
        [WinResInjector]::MAKEINTRESOURCE([WinResInjector]::RT_GROUP_ICON),
        [WinResInjector]::MAKEINTRESOURCE(1),
        0,
        $groupData,
        [uint32]$groupData.Length
    )
    
    if (-not $result) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Warning "FAIL RT_GROUP_ICON: $err"
    } else {
        Write-Host "OK RT_GROUP_ICON"
    }
    
    # Finalize
    Write-Host "Finalizing..."
    $result = [WinResInjector]::EndUpdateResourceW($hUpdate, $false)  # false = commit
    if (-not $result) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Error "EndUpdateResourceW failed: $err"
        exit 1
    }
    
    Write-Host "Icon injected successfully!"
} catch {
    Write-Error $_.Exception.Message
    [WinResInjector]::EndUpdateResourceW($hUpdate, $true)  # discard
    exit 1
}