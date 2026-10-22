#!/usr/bin/env python3
"""launcher/scripts/w32-icon-injector.py
Uses Windows API with proper ctypes signatures.
"""
import struct
import sys
import os
import ctypes
from ctypes import wintypes

kernel32 = ctypes.windll.kernel32

# Fix: Use ctypes.WINFUNCTYPE for proper calling convention
UpdateResource = ctypes.WINFUNCTYPE(
    wintypes.BOOL,  # BOOL return
    wintypes.HMODULE,  # HMODULE hModule
    ctypes.c_void_p,   # LPCTSTR lpType (can be int ID)
    ctypes.c_void_p,   # LPCTSTR lpName (can be int ID)
    wintypes.WORD,     # WORD wLanguage
    ctypes.c_void_p,   # LPCVOID lpData
    wintypes.DWORD     # DWORD cbData
)(("UpdateResourceW", kernel32))

BeginUpdateResource = ctypes.WINFUNCTYPE(
    wintypes.HANDLE,  # HANDLE return
    wintypes.LPCWSTR,  # LPCWSTR lpFileName
    wintypes.BOOL      # BOOL bDeleteExistingContents
)(("BeginUpdateResourceW", kernel32))

EndUpdateResource = ctypes.WINFUNCTYPE(
    wintypes.BOOL,  # BOOL return
    wintypes.HANDLE,  # HANDLE hUpdate
    wintypes.BOOL     # BOOL bAbort
)(("EndUpdateResourceW", kernel32))

RT_ICON = 3
RT_GROUP_ICON = 16

def main():
    if len(sys.argv) < 3:
        print("Usage: w32-icon-injector.py <exe-path> <ico-path>")
        sys.exit(1)
    
    exe_path = sys.argv[1]
    ico_path = sys.argv[2]
    
    if not os.path.exists(exe_path):
        print(f"Error: {exe_path} not found")
        sys.exit(1)
    if not os.path.exists(ico_path):
        print(f"Error: {ico_path} not found")
        sys.exit(1)
    
    # Read ICO file
    with open(ico_path, 'rb') as f:
        ico_data = f.read()
    
    # Parse ICO header
    (reserved, icon_type, count) = struct.unpack('<HHH', ico_data[:6])
    if reserved != 0 or icon_type != 1:
        print("Error: Not a valid ICO file")
        sys.exit(1)
    
    print(f"ICO file: {count} icons, {len(ico_data)} bytes total")
    
    # Parse image entries
    offset = 6
    entries = []
    png_sizes = []
    
    for i in range(count):
        width = ico_data[offset]
        image_size = struct.unpack('<I', ico_data[offset + 8:offset + 12])[0]
        image_offset = struct.unpack('<I', ico_data[offset + 12:offset + 16])[0]
        png_sizes.append(width)
        entries.append({
            'size': image_size,
            'data': ico_data[image_offset:image_offset + image_size]
        })
        offset += 16
    
    print(f"Found {len(entries)} image entries")
    
    # Start resource update
    handle = BeginUpdateResource(exe_path, False)
    if not handle:
        print(f"BeginUpdateResource failed: error={ctypes.GetLastError()}")
        sys.exit(1)
    
    try:
        # Add each PNG as RT_ICON
        for i, entry in enumerate(entries):
            icon_id = i + 1
            
            # Convert bytes to ctypes buffer
            data_buf = ctypes.create_string_buffer(entry['data'])
            
            result = UpdateResource(
                None,           # hModule = NULL
                RT_ICON,        # Resource type as int
                icon_id,        # Resource name/ID as int
                0,              # wLanguage
                data_buf,       # LPCVOID (bytes object works)
                len(entry['data'])
            )
            
            if not result:
                print(f"  FAIL RT_ICON #{icon_id}: error={ctypes.GetLastError()}")
            else:
                print(f"  OK RT_ICON #{icon_id} ({png_sizes[i]}x{png_sizes[i]}): {entry['size']} bytes")
        
        # Build RT_GROUP_ICON
        group_header = struct.pack('<HHH', 0, 1, len(entries))
        group_entries = b''
        
        for i, entry in enumerate(entries):
            id = i + 1
            w = 16 if png_sizes[i] <= 16 else 32 if png_sizes[i] <= 32 else 48 if png_sizes[i] <= 64 else 128 if png_sizes[i] <= 128 else 256
            group_entries += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, entry['size'], id)
        
        group_data = group_header + group_entries
        group_buf = ctypes.create_string_buffer(group_data)
        
        # Add RT_GROUP_ICON (ID 1)
        result = UpdateResource(
            None,
            RT_GROUP_ICON,
            1,
            0,
            group_buf,
            len(group_data)
        )
        
        if not result:
            print(f"  FAIL RT_GROUP_ICON: error={ctypes.GetLastError()}")
        else:
            print(f"  OK RT_GROUP_ICON (group): {len(group_data)} bytes")
        
        # Finalize
        result = EndUpdateResource(handle, False)  # False = commit
        if not result:
            print(f"EndUpdateResource failed: error={ctypes.GetLastError()}")
            sys.exit(1)
        
        print(f"Icon injected successfully into {exe_path}")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        EndUpdateResource(handle, True)  # Discard on error
        sys.exit(1)

if __name__ == '__main__':
    main()