"""Convert resources from the official Aquarium 1.x reference for the web renderer.

Usage: python convert-aquarium.py /path/to/extracted/Aquarium.scr
Requires pefile and Pillow. Does not execute the Windows program.
"""
import io
import json
from pathlib import Path
import re
import struct
import sys
import zlib

import pefile
from PIL import Image

TARGET = Path(__file__).resolve().parents[1] / 'public/aquarium'
TARGET.mkdir(parents=True, exist_ok=True)

def tokens(data):
    if data[8:12] == b'txt ':
        text = re.sub(r'//[^\r\n]*', '', data[16:].decode('ascii'))
        return [float(v) if re.fullmatch(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', v)
                else v.strip('"') for v in re.findall(r'"[^"]*"|[{}]|[A-Za-z_][\w.-]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', text)]
    if data[8:12] == b'bzip':
        offset, decoded = 22, b''
        while offset < len(data):
            size = struct.unpack_from('<H', data, offset)[0]
            assert data[offset+2:offset+4] == b'CK'
            offset += 4
            inflater = zlib.decompressobj(-15, zdict=decoded[-32768:]) if decoded else zlib.decompressobj(-15)
            decoded += inflater.decompress(data[offset:offset+size])
            offset += size
        data = decoded
    else:
        data = data[16:]
    offset, result = 0, []
    while offset < len(data):
        kind = struct.unpack_from('<H', data, offset)[0]
        offset += 2
        if kind in (1, 2):
            size = struct.unpack_from('<I', data, offset)[0]
            offset += 4
            result.append(data[offset:offset+size].decode('ascii'))
            offset += size + (2 if kind == 2 else 0)
        elif kind == 3:
            result.append(struct.unpack_from('<I', data, offset)[0]); offset += 4
        elif kind in (6, 7):
            size = struct.unpack_from('<I', data, offset)[0]; offset += 4
            result.extend(struct.unpack_from('<'+('I' if kind == 6 else 'f')*size, data, offset))
            offset += size*4
        elif kind in (10, 11):
            result.append('{' if kind == 10 else '}')
        elif kind == 5:
            offset += 16
    return result

def model(data):
    stream = tokens(data)
    meshes, materials = [], {}
    # Objects retain their original coordinates; the reference has identity frames.
    def block(start):
        level, end = 1, start
        while level:
            end += 1
            if stream[end] == '{': level += 1
            if stream[end] == '}': level -= 1
        return end
    for i, token in enumerate(stream):
        if token == 'Material':
            name = stream[i+1]
            start = i+2 if stream[i+2] == '{' else i+1
            end = block(start)
            body = stream[start+1:end]
            texture = body[body.index('TextureFilename')+2].upper().replace('.DDS', '.webp') if 'TextureFilename' in body else None
            materials[name] = texture
        if token != 'Mesh': continue
        name, offset = stream[i+1], i+3
        count = int(stream[offset]); offset += 1
        vertices = stream[offset:offset+3*count]; offset += 3*count
        faces = []
        face_count = int(stream[offset]); offset += 1
        for _ in range(face_count):
            n = int(stream[offset]); offset += 1
            faces.append(stream[offset:offset+n]); offset += n
        end = block(i+2)
        body = stream[offset:end]
        normals, normal_faces = [], []
        if 'MeshNormals' in body:
            ni = body.index('MeshNormals')+2
            normal_count = int(body[ni]); ni += 1
            normals = body[ni:ni+normal_count*3]; ni += normal_count*3
            normal_face_count = int(body[ni]); ni += 1
            for _ in range(normal_face_count):
                n = int(body[ni]); ni += 1
                normal_faces.append(body[ni:ni+n]); ni += n
        uv_start = body.index('MeshTextureCoords')+3 if 'MeshTextureCoords' in body else None
        uvs = body[uv_start:uv_start+2*count] if uv_start is not None else [0]*(2*count)
        mi = body.index('MeshMaterialList')+2
        material_count, face_count = int(body[mi]), int(body[mi+1])
        face_materials = body[mi+2:mi+2+face_count]
        refs = []
        p = mi+2+face_count
        for _ in range(material_count):
            assert body[p] == '{', (name, body[p:p+10])
            refs.append(body[p+1]); p += 3
        meshes.append(dict(name=name, vertices=vertices, uvs=uvs, faces=faces, normals=normals, normalFaces=normal_faces,
                           faceMaterials=face_materials, materials=refs))
    return dict(meshes=meshes, materials=materials)

program = pefile.PE(sys.argv[1])
resources = {}
for entry in program.DIRECTORY_ENTRY_RESOURCE.entries:
    if entry.id != 10: continue
    for resource in entry.directory.entries:
        info = resource.directory.entries[0].data.struct
        resources[str(resource.name)] = program.get_data(info.OffsetToData, info.Size)

names = ['BKGRND', 'YELLOW_TANG', 'REGAL_TANG', 'PERCULA_CLOWNFISH',
         'POWDER_BLUE_TANG', 'WIMPLEFISH', 'ROYAL_GRAMMA', 'FLAME_ANGEL', 'STARFISH',
         'LIGHTPLAY', 'LIGHTPLAYDIST', 'TANKDISTANCE']
scene = {name: model(resources[name+'.X']) for name in names}
textures = {texture for item in scene.values() for texture in item['materials'].values() if texture}
textures.add('BUBBLES.webp')
for texture in textures:
    Image.open(io.BytesIO(resources[texture.replace('.webp', '.DDS')])).save(TARGET/texture, lossless=True, method=6)
# Six decimal places retain far more precision than the original display needs.
def compact(value):
    if isinstance(value, float): return round(value, 6)
    if isinstance(value, list): return [compact(x) for x in value]
    if isinstance(value, dict): return {k:compact(v) for k,v in value.items()}
    return value
(TARGET/'scene.json').write_text(json.dumps(compact(scene), separators=(',', ':')))
print(f'Converted {len(scene)} models and {len(textures)} textures to {TARGET}')
