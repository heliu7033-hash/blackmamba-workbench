"""Generate the open-source edition icon from geometric primitives, without source media."""
from pathlib import Path
import struct,zlib
size=128
rows=[]
for y in range(size):
 row=bytearray([0])
 for x in range(size):
  mark=(25<=x<43 and 25<=y<103) or (85<=x<103 and 25<=y<103) or (43<=x<85 and abs(y-(40+abs(x-64)))<9)
  row.extend((227,160,82,255) if mark else (16,26,35,255))
 rows.append(row)
def chunk(kind,data):
 return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
output=Path('build/assets/BrandMark.png');output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(png)
