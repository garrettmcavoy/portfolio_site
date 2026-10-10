import { Box3, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

export interface FishPart {
  vertices: number[];
  uvs: number[];
  faces: number[][];
  faceMaterials: number[];
}

export function createFishGeometry(part: FishPart, materialIndex: number) {
  const geometry = new BufferGeometry();
  const positions = part.vertices.map((value, index) => index%3 === 2 ? -value : value);
  const indices: number[] = [];
  for (const [faceIndex, face] of part.faces.entries()) {
    const material = part.faceMaterials.length === 1 ? part.faceMaterials[0] : part.faceMaterials[faceIndex];
    if (material !== materialIndex) continue;
    // Reflecting Z reverses handedness, so reverse each triangle as well.
    for (let i = 1; i < face.length-1; i++) indices.push(face[0], face[i+1], face[i]);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // The original artwork already uses the same V convention as the reef.
  geometry.setAttribute('uv', new Float32BufferAttribute(part.uvs, 2));
  geometry.setIndex(indices);
  // Shared vertices keep the original low-poly surface smoothly shaded.
  geometry.computeVertexNormals();
  return geometry;
}

// A stable contact envelope covers both original bend poses, fin pivots, and
// the tail wave. Tail beats must not change a fish's avoidance decisions.
export function createSwimmingBounds(parts: readonly { vertices: readonly number[] }[]) {
  const bounds = new Box3(), point = new Vector3();
  for (const part of parts) for (let i = 0; i < part.vertices.length; i += 3) {
    point.set(part.vertices[i], part.vertices[i+1], part.vertices[i+2]);
    bounds.expandByPoint(point);
    point.z *= -1;
    bounds.expandByPoint(point);
  }
  return bounds.expandByScalar(.1);
}
