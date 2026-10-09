import type { Box3 } from 'three';

type Point = readonly [number, number];
export interface ReefTriangle {
  positions: readonly [Point, Point, Point];
  uvs: readonly [Point, Point, Point];
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
}
export interface ReefBarrier {
  depth: number;
  overlapsFootprint(box: Box3): boolean;
}

// The reef is made of alpha-cutout cards, not solid rectangular walls. Rasterize
// their actual triangles and artwork once, then query a summed-area mask in O(1).
export function createReefBarrier(depth: number, triangles: ReefTriangle[]): ReefBarrier {
  const points = triangles.flatMap(triangle => triangle.positions);
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const width = Math.max(1, Math.ceil((maxX-minX)/.04));
  const height = Math.max(1, Math.ceil((maxY-minY)/.04));
  const cellX = (maxX-minX)/width, cellY = (maxY-minY)/height;
  const occupied = new Uint8Array(width*height);
  for (const { positions: [a, b, c], uvs, image } of triangles) {
    const denominator = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if (Math.abs(denominator) < 1e-10) continue;
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0])-minX)/cellX));
    const x1 = Math.min(width-1, Math.floor((Math.max(a[0], b[0], c[0])-minX)/cellX));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1])-minY)/cellY));
    const y1 = Math.min(height-1, Math.floor((Math.max(a[1], b[1], c[1])-minY)/cellY));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (occupied[y*width+x]) continue;
      const worldX = minX+(x+.5)*cellX, worldY = minY+(y+.5)*cellY;
      const wa = ((b[1]-c[1])*(worldX-c[0])+(c[0]-b[0])*(worldY-c[1]))/denominator;
      const wb = ((c[1]-a[1])*(worldX-c[0])+(a[0]-c[0])*(worldY-c[1]))/denominator;
      const wc = 1-wa-wb;
      if (Math.min(wa, wb, wc) < -1e-6) continue;
      const u = wa*uvs[0][0]+wb*uvs[1][0]+wc*uvs[2][0];
      const v = wa*uvs[0][1]+wb*uvs[1][1]+wc*uvs[2][1];
      const pixelX = Math.max(0, Math.min(image.width-1, Math.floor(u*image.width)));
      const pixelY = Math.max(0, Math.min(image.height-1, Math.floor((1-v)*image.height)));
      if (image.data[(pixelY*image.width+pixelX)*4+3] >= 115) occupied[y*width+x] = 1;
    }
  }
  const stride = width+1, sums = new Uint32Array(stride*(height+1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += occupied[y*width+x];
      sums[(y+1)*stride+x+1] = sums[y*stride+x+1]+row;
    }
  }
  return {
    depth,
    overlapsFootprint(box) {
      // One cell covers raster edge uncertainty; .08 matches fish clearance.
      const padding = .08+Math.max(cellX, cellY);
      if (box.max.x+padding < minX || box.min.x-padding > maxX || box.max.y+padding < minY || box.min.y-padding > maxY) return false;
      const x0 = Math.max(0, Math.floor((box.min.x-padding-minX)/cellX));
      const x1 = Math.min(width, Math.floor((box.max.x+padding-minX)/cellX)+1);
      const y0 = Math.max(0, Math.floor((box.min.y-padding-minY)/cellY));
      const y1 = Math.min(height, Math.floor((box.max.y+padding-minY)/cellY)+1);
      return sums[y1*stride+x1]-sums[y0*stride+x1]-sums[y1*stride+x0]+sums[y0*stride+x0] > 0;
    },
  };
}
