"""Sample the isolated swimming routine from the verified 1.1.2 reference.

Usage: python scripts/sample-aquarium-motion.py /path/to/Aquarium.scr
Requires pefile and unicorn. No Windows process, installer, licensing routine,
network, or host-system calls run. Only the swimming math runs in mapped memory.
The graphics calls are omitted; mesh deformation is implemented in the renderer.
"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import struct
import sys

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_HASH = '8df1ba3b67356f1eaa182867803da03e77e5cc4371524c1bcada931b1e747147'
reference = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(reference).hexdigest() == REFERENCE_HASH, 'Addresses require the verified 1.1.2 binary'
pe = pefile.PE(data=reference)
u = Uc(UC_ARCH_X86, UC_MODE_32)
u.mem_map(0x400000, 0x200000)
u.mem_write(0x400000, pe.get_memory_mapped_image())
u.mem_map(0x1000000, 0x400000)
u.mem_map(0x2000000, 0x11000)
OBJ, STACK, END = 0x1000000, 0x200f000, 0x2010000

def wi(a, v): u.mem_write(a, struct.pack('<I', v & 0xffffffff))
def wf(a, v): u.mem_write(a, struct.pack('<f', v))
def rf(a): return struct.unpack('<f', u.mem_read(a, 4))[0]
def identity(a): u.mem_write(a, struct.pack('<16f', 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1))

species = ['YELLOW_TANG', 'REGAL_TANG', 'WIMPLEFISH', 'PERCULA_CLOWNFISH', 'POWDER_BLUE_TANG', 'FLAME_ANGEL', 'ROYAL_GRAMMA']
models = json.loads((ROOT / 'public/aquarium/scene.json').read_text())
identity(OBJ + 0x7208)
wf(OBJ + 0x7238, -1)  # Local forward vector: all original fish face left.
wi(0x425fc0, len(species))
wi(0x428e50, 127)  # Static C++ cleanup registrations are unnecessary in isolated memory.
for i, name in enumerate(species):
    mat = 0x1100000 + i * 0x1000
    identity(mat)
    wi(OBJ + 0x7108 + 4*i, mat)
    wi(0x427f78 + 4*i, 1 if name == 'WIMPLEFISH' else 0)
    wi(OBJ + 0x52d8 + 4*i, 0 if i % 2 else 3)
    # Reconstructed starting state, not an assertion about the original random seed.
    for k, value in enumerate((-4+i*1.3, (i % 3)*.6-.5, .8 if i % 2 else -.8)):
        wf(0x426698 + 12*i + 4*k, value)
    wf(0x427cdc + 12*i, 62831.84)
    wf(0x427ce0 + 12*i, -.1)
    wf(OBJ + 0x535c + 4*i, .6+i*.1)
    wf(OBJ + 0x538c + 4*i, .8)
    wf(OBJ + 0x565c + 4*i, .5)
    wf(OBJ + 0x568c + 4*i, .5)
    wi(OBJ + 0x70d8 + 4*i, 1)
    wi(OBJ + 0x70a8 + 4*i, 1)
    wf(OBJ + 0x559c + 4*i, rf(0x421d7c))
    wf(OBJ + 0x556c + 4*i, rf(0x421d78))
    body = next(p for p in models[name]['meshes'] if p['name'] == 'fishbody')['vertices']
    # The original uses tail-tip X and dorsal vertex Y as collision extents.
    wf(0x4263e8 + 12*i, body[23*3])
    wf(0x4263ec + 12*i, body[99*3+1])

seed = 1349

def hook(uc, addr, size, _):
    global seed
    if addr == 0x407ebd: uc.reg_write(UC_X86_REG_EIP, 0x40802b)
    elif addr == 0x4082eb:
        uc.reg_write(UC_X86_REG_ESP, uc.reg_read(UC_X86_REG_ESP)+24)
        uc.reg_write(UC_X86_REG_EIP, 0x409f28)
    elif addr == 0x409f34: uc.reg_write(UC_X86_REG_EIP, 0x40a075)
    else:  # MSVC rand(): reproducible, with no host call.
        seed = (seed*214013+2531011) & 0xffffffff
        uc.reg_write(UC_X86_REG_EAX, (seed >> 16) & 32767)
        sp = uc.reg_read(UC_X86_REG_ESP)
        ret = struct.unpack('<I', uc.mem_read(sp, 4))[0]
        uc.reg_write(UC_X86_REG_ESP, sp+4)
        uc.reg_write(UC_X86_REG_EIP, ret)

for address in (0x407ebd, 0x4082eb, 0x409f34, 0x412a0d):
    u.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

def quaternion(m):
    # DirectX row vectors -> Three column vectors, with source Z reflected.
    r = [[m[c*4+r] * (-1 if (c == 2) != (r == 2) else 1) for c in range(3)] for r in range(3)]
    trace = r[0][0]+r[1][1]+r[2][2]
    if trace > 0:
        s = math.sqrt(trace+1)*2
        q = [(r[2][1]-r[1][2])/s, (r[0][2]-r[2][0])/s, (r[1][0]-r[0][1])/s, s/4]
    else:
        i = max(range(3), key=lambda k: r[k][k]); j = (i+1)%3; k = (i+2)%3
        s = math.sqrt(1+r[i][i]-r[j][j]-r[k][k])*2
        q = [0]*4
        q[i] = s/4; q[j] = (r[i][j]+r[j][i])/s; q[k] = (r[i][k]+r[k][i])/s
        q[3] = (r[k][j]-r[j][k])/s
    length = math.sqrt(sum(x*x for x in q))
    return [x/length for x in q]

tracks = [[] for _ in species]
# Simulate at 60 Hz, store 10 Hz. Quaternion interpolation renders at display rate.
for frame in range(36001):
    milliseconds = round(frame*1000/60)
    previous = round((frame-1)*1000/60) if frame else -17
    wi(0x42800c, milliseconds-previous)
    for i in range(len(species)):
        wi(STACK, END); wi(STACK+4, milliseconds); wi(STACK+8, i)
        u.reg_write(UC_X86_REG_ESP, STACK); u.reg_write(UC_X86_REG_ECX, OBJ)
        u.emu_start(0x406b90, END, count=20000)
        assert u.reg_read(UC_X86_REG_EIP) == END, 'Swimming routine exceeded its instruction budget'
        if frame % 6 == 0:
            m = struct.unpack('<16f', u.mem_read(0x1100000+i*0x1000, 64))
            q = quaternion(m)
            if tracks[i] and sum(a*b for a,b in zip(q, tracks[i][-1][3:7])) < 0: q = [-x for x in q]
            tracks[i].append([m[12], m[13], -m[14], *q, rf(0x427f94+4*i), rf(OBJ+0x535c+4*i)])
    if frame % 6000 == 0: print(f'Sampled {milliseconds/1000:.0f}s', flush=True)

metadata, packed = [], bytearray()
for i, track in enumerate(tracks):
    # Loop only when the entire model is beyond the same viewport edge.
    radius = max(abs(x) for p in models[species[i]]['meshes'] for x in p['vertices'])
    def hidden(row):
        x,y,z = row[:3]
        half_width = math.tan(.9304999709/2) * (10-z-radius) * 4/3
        return abs(x)-radius > half_width+.12
    hidden_frames = [j for j,row in enumerate(track) if j > 200 and hidden(row)]
    candidates = [(start, end) for start in hidden_frames[:1000] for end in hidden_frames[-1000:]
                  if end-start > 1200 and track[start][0]*track[end][0] > 0]
    if candidates:
        start,end = max(candidates, key=lambda pair: pair[1]-pair[0])
        join = 0
    else:
        # Some fish never fully leave the tank. Find a close recurrence, then
        # blend the final second to the first pose. This join is reconstructed.
        def cost(a, b):
            distance = sum((a[k]-b[k])**2 for k in range(3))
            rotation = 1-abs(sum(a[k]*b[k] for k in range(3,7)))
            return distance + rotation*8 + (a[7]-b[7])**2 + (a[8]-b[8])**2
        start,end = min(((a,b) for a in range(200,1200,4) for b in range(4500,6000,4)),
                        key=lambda pair: cost(track[pair[0]],track[pair[1]]))
        join = 1
        print(species[i], 'join distance', math.dist(track[start][:3],track[end][:3]))
    clip = track[start:end+1]
    # Retain a visible starting moment within the same loop.
    initial = next((j for j,row in enumerate(clip) if j > 30 and abs(row[0]) < 4.5 and row[1] > -.5), 0)
    metadata.append(dict(species=species[i], offset=len(packed)//2, frames=len(clip), start=initial/10, join=join))
    scales = [1000]*3 + [32767]*4 + [16384,10000]
    for row in clip:
        values = [round(v*s) for v,s in zip(row, scales)]
        assert all(-32768 <= v <= 32767 for v in values), row
        packed.extend(struct.pack('<9h', *values))
    print(species[i], 'loop', start/10, end/10, 'initial', initial/10)

output = ROOT / 'public/aquarium'
(output / 'motion.dat').write_bytes(gzip.compress(packed, mtime=0))
(output / 'motion.json').write_text(json.dumps(dict(hz=10, stride=9, tracks=metadata), separators=(',', ':'))+'\n')
print('Packed bytes', len(packed), 'compressed', (output/'motion.dat').stat().st_size)
