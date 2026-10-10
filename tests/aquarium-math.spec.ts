import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Box3, Euler, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';
import sharp from 'sharp';
import { createReefBarrier, type ReefTriangle } from '../src/scripts/aquarium-reef';
import { createSwimmingSampler } from '../src/scripts/aquarium-motion';
import { crossfadeLoop } from '../src/scripts/aquarium-audio';
import { createFishGeometry, createSwimmingBounds } from '../src/scripts/aquarium-geometry';
import { createFishAvoidance, type SwimmingBody } from '../src/scripts/aquarium-avoidance';

test('live avoidance keeps fish clear of each other and opaque reef surfaces through two recorded cycles', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Simulation only needs one run');
  const models = JSON.parse(readFileSync('public/aquarium/scene.json', 'utf8'));
  const metadata = JSON.parse(readFileSync('public/aquarium/motion.json', 'utf8'));
  const decoded = gunzipSync(readFileSync('public/aquarium/motion.dat'));
  const swimming = createSwimmingSampler(metadata, new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength/2));
  const bodies: SwimmingBody[] = metadata.tracks.map(({ species }: { species: string }) => {
    const bounds = createSwimmingBounds(models[species].meshes);
    return { position: new Vector3(), orientation: new Quaternion(), nextPosition: new Vector3(), nextOrientation: new Quaternion(), bounds };
  });
  const reefs = await Promise.all(['BKGRND', 'TANKDISTANCE'].map(async name => {
    const triangles: ReefTriangle[] = [];
    for (const part of models[name].meshes) {
      const { data, info } = await sharp(`public/aquarium/${models[name].materials[part.materials[0]]}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const image = { width: info.width, height: info.height, data };
      for (const face of part.faces) {
        const points = face.map((index: number) => new Vector2(part.vertices[index*3], part.vertices[index*3+1]));
        for (const corners of ShapeUtils.triangulateShape(points, [])) {
          const indices = corners.map(corner => face[corner]);
          const positionAt = (index: number) => [part.vertices[index*3], part.vertices[index*3+1]] as const;
          const uvAt = (index: number) => [part.uvs[index*2], part.uvs[index*2+1]] as const;
          triangles.push({
            positions: [positionAt(indices[0]), positionAt(indices[1]), positionAt(indices[2])],
            uvs: [uvAt(indices[0]), uvAt(indices[1]), uvAt(indices[2])],
            image,
          });
        }
      }
    }
    return createReefBarrier(-models[name].meshes[0].vertices[2], triangles);
  }));
  const avoid = createFishAvoidance(reefs), matrix = new Matrix4(), scale = new Vector3(1, 1, 1);
  const failures: string[] = [];
  let finite = true, maximumStep = 0, maximumTurn = 0, longestStill = 0, minimumUp = 1;
  const previousPositions = bodies.map(() => new Vector3());
  const previousRotations = bodies.map(() => new Quaternion());
  const stillFrames = bodies.map(() => 0);
  for (let step = 0; step < 24000; step++) {
    bodies.forEach((body, i) => {
      swimming(metadata.tracks[i].species, step/20, body.position, body.orientation);
      swimming(metadata.tracks[i].species, step/20+1.6, body.nextPosition, body.nextOrientation);
    });
    avoid(bodies, step ? .05 : 0);
    const boxes = bodies.map((body, i) => {
      if (step) {
        const distance = body.position.distanceTo(previousPositions[i]);
        maximumStep = Math.max(maximumStep, distance);
        maximumTurn = Math.max(maximumTurn, body.orientation.angleTo(previousRotations[i]));
        stillFrames[i] = distance < .0005 && Math.abs(body.position.x) < 6 ? stillFrames[i]+1 : 0;
        longestStill = Math.max(longestStill, stillFrames[i]);
      }
      previousPositions[i].copy(body.position); previousRotations[i].copy(body.orientation);
      finite &&= Number.isFinite(body.position.lengthSq());
      minimumUp = Math.min(minimumUp, new Vector3(0, 1, 0).applyQuaternion(body.orientation).y);
      matrix.compose(body.position, body.orientation, scale);
      return body.bounds.clone().applyMatrix4(matrix);
    });
    boxes.forEach((box, i) => reefs.forEach((reef, r) => {
      if (box.min.z < reef.depth && box.max.z > reef.depth && reef.overlapsFootprint(box) && failures.length < 3) failures.push(`${step/20}s: fish ${i}/reef ${r}`);
    }));
    for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) {
      if (boxes[i].intersectsBox(boxes[j]) && failures.length < 3) failures.push(`${step/20}s: ${i}/${j}`);
    }
  }
  expect(finite).toBe(true);
  expect(failures).toEqual([]);
  // Bounds on rendered movement also catch correction snaps and loop jumps;
  // collision-only assertions allowed the previous visible stuttering.
  expect(maximumStep).toBeLessThanOrEqual(1.8/20+1e-8);
  expect(maximumTurn).toBeLessThanOrEqual(1.2/20+1e-6);
  expect(longestStill/20).toBeLessThan(1);
  expect(minimumUp).toBeGreaterThan(.97);
});

test('avoidance resolves coincident fish and starts moving before a predicted contact', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Simulation only needs one run');
  const body = (x: number, nextX: number): SwimmingBody => ({
    position: new Vector3(x, 0, 0), nextPosition: new Vector3(nextX, 0, 0),
    orientation: new Quaternion(), nextOrientation: new Quaternion(),
    bounds: new Box3(new Vector3(-.5, -.3, -.1), new Vector3(.5, .3, .1)),
  });
  const bodies = [body(-1, -.2), body(1, .2)];
  createFishAvoidance()(bodies, .05);
  expect(Math.abs(bodies[0].position.z)+Math.abs(bodies[1].position.z)).toBeGreaterThan(0);
  const crowded = Array.from({ length: 7 }, () => body(0, 0));
  createFishAvoidance()(crowded, 0);
  const boxes = crowded.map(fish => fish.bounds.clone().translate(fish.position));
  for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) expect(boxes[i].intersectsBox(boxes[j])).toBe(false);
});


test('head-on passes stay continuous and do not change passing side mid-encounter', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Simulation only needs one run');
  const bounds = new Box3(new Vector3(-.5, -.3, -.1), new Vector3(.5, .3, .1));
  const bodies: SwimmingBody[] = [0, 1].map(() => ({
    bounds, position: new Vector3(), nextPosition: new Vector3(),
    orientation: new Quaternion(), nextOrientation: new Quaternion(),
  }));
  const avoid = createFishAvoidance(), previous = bodies.map(() => new Vector3());
  let passingSide = 0, maximumStep = 0;
  for (let frame = 0; frame < 900; frame++) {
    const time = frame/60;
    bodies.forEach((body, i) => {
      const direction = i ? -1 : 1;
      body.position.set(direction*(-2+time*.35), 0, 0);
      body.nextPosition.set(direction*(-2+(time+1.6)*.35), 0, 0);
      body.orientation.setFromAxisAngle(new Vector3(0, 1, 0), i ? 0 : Math.PI);
      body.nextOrientation.copy(body.orientation);
    });
    avoid(bodies, frame ? 1/60 : 0);
    if (frame) bodies.forEach((body, i) => { maximumStep = Math.max(maximumStep, body.position.distanceTo(previous[i])); });
    const separation = bodies[1].position.clone().sub(bodies[0].position);
    const depth = Math.abs(separation.z) > .04 ? separation.z : separation.y;
    if (Math.abs(bodies[1].position.x-bodies[0].position.x) < 1.2 && Math.abs(depth) > .04) {
      passingSide ||= Math.sign(depth);
      expect(Math.sign(depth)).toBe(passingSide);
    }
    const boxes = bodies.map(body => {
      const matrix = new Matrix4().compose(body.position, body.orientation, new Vector3(1, 1, 1));
      return bounds.clone().applyMatrix4(matrix);
    });
    expect(boxes[0].intersectsBox(boxes[1])).toBe(false);
    bodies.forEach((body, i) => previous[i].copy(body.position));
  }
  expect(passingSide).not.toBe(0);
  expect(maximumStep).toBeLessThanOrEqual(1.8/60+1e-8);
});

test('motor recovery is consistent at 30, 60, and 120 frames per second', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Simulation only needs one run');
  const endpoints = [30, 60, 120].map(hz => {
    const body: SwimmingBody = {
      bounds: new Box3(new Vector3(-.5, -.3, -.1), new Vector3(.5, .3, .1)),
      position: new Vector3(), nextPosition: new Vector3(),
      orientation: new Quaternion(), nextOrientation: new Quaternion(),
    };
    const avoid = createFishAvoidance();
    for (let frame = 0; frame <= hz*10; frame++) {
      body.position.set(frame/hz*.6, 0, 0); body.nextPosition.set((frame/hz+1.6)*.6, 0, 0);
      body.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI); body.nextOrientation.copy(body.orientation);
      avoid([body], frame ? 1/hz : 0);
    }
    const position = body.position.clone(), rotation = body.orientation.clone();
    // Resizes and still frames must not advance or reset the swimming motor.
    body.position.set(6, 0, 0); avoid([body], 0);
    expect(body.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(body.orientation.angleTo(rotation)).toBeLessThan(1e-6);
    return position;
  });
  for (const point of endpoints) expect(point.distanceTo(endpoints[1])).toBeLessThan(.04);
});

test('reef clearance respects transparent openings and preserves the side of visible coral', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Pure calculations only need one run');
  const data = new Uint8Array(16*16*4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) data[(y*16+x)*4+3] = x >= 8 && y < 8 ? 0 : 255;
  const image = { width: 16, height: 16, data };
  const triangles: ReefTriangle[] = [
    { positions: [[-2, -2], [2, -2], [-2, 2]], uvs: [[0, 0], [1, 0], [0, 1]], image },
    { positions: [[2, -2], [2, 2], [-2, 2]], uvs: [[1, 0], [1, 1], [0, 1]], image },
  ];
  const reef = createReefBarrier(0, triangles);
  const bounds = new Box3(new Vector3(-.2, -.2, -.2), new Vector3(.2, .2, .2));
  expect(reef.overlapsFootprint(bounds.clone().translate(new Vector3(1, 1, 0)))).toBe(false);
  expect(reef.overlapsFootprint(bounds.clone().translate(new Vector3(1, -1, 0)))).toBe(true);
  expect(reef.overlapsFootprint(bounds.clone().translate(new Vector3(4, -1, 0)))).toBe(false);
  const fish: SwimmingBody = { bounds, position: new Vector3(), orientation: new Quaternion(), nextPosition: new Vector3(), nextOrientation: new Quaternion() };
  const avoid = createFishAvoidance([reef]);
  for (let step = 0; step < 100; step++) {
    fish.position.set(1, -1, 1-step*.02); fish.nextPosition.set(1, -1, fish.position.z-.4);
    avoid([fish], .05);
    expect(bounds.min.z+fish.position.z).toBeGreaterThanOrEqual(.07999);
  }
  // Swim up into the opening, then cross the plane there. A motor follows a
  // continuous route rather than adopting an instantly teleported source pose.
  const openingRoute = (time: number, target: Vector3) => target.set(1,
    -1+Math.min(2, time*.4), 1-Math.min(2, Math.max(0, time-5)*.4));
  for (let step = 0; step < 240; step++) {
    openingRoute(step/20, fish.position); openingRoute(step/20+1.6, fish.nextPosition);
    avoid([fish], .05);
    const box = bounds.clone().applyMatrix4(new Matrix4().compose(fish.position, fish.orientation, new Vector3(1, 1, 1)));
    expect(box.min.z < reef.depth && box.max.z > reef.depth && reef.overlapsFootprint(box)).toBe(false);
  }
  expect(fish.position.z+fish.bounds.max.z).toBeLessThan(-.08);
  // A broad turn cannot fit between layers; it must sidestep into open water.
  fish.orientation.identity(); fish.nextOrientation.identity();
  fish.bounds = new Box3(new Vector3(-.2, -.2, -1), new Vector3(.2, .2, 1));
  fish.position.set(1, -1, -.75); fish.nextPosition.copy(fish.position);
  const layers = [reef, createReefBarrier(-1.5, triangles)];
  createFishAvoidance(layers)([fish], 0);
  const box = fish.bounds.clone().translate(fish.position);
  for (const layer of layers) expect(box.min.z < layer.depth && box.max.z > layer.depth && layer.overlapsFootprint(box)).toBe(false);
});

test('swimming envelopes contain the original animated fin poses', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Geometry only needs one run');
  const models = JSON.parse(readFileSync('public/aquarium/scene.json', 'utf8'));
  for (const [name, model] of Object.entries(models) as [string, any][]) {
    const body = model.meshes.find((part: any) => part.name === 'fishbody');
    const bend = model.meshes.find((part: any) => part.name === 'fishbend');
    if (!body || !bend) continue;
    const bounds = createSwimmingBounds(model.meshes);
    for (const fin of model.meshes.filter((part: any) => ['leftfin', 'rightfin'].includes(part.name))) {
      const attach = fin.name === 'leftfin' ? 78 : 157;
      const pivot = new Vector3(fin.vertices[0], fin.vertices[1], -body.vertices[attach*3+2]);
      for (let step = 0; step <= 40; step++) {
        const steering = -1+step/20, amount = -steering;
        const anchor = pivot.clone();
        anchor.z = -(body.vertices[attach*3+2]+(bend.vertices[attach*3+2]-body.vertices[attach*3+2])*amount);
        const rotation = new Quaternion().setFromEuler(new Euler(0,
          -(steering+(fin.name === 'leftfin' ? .3 : -.3)), -steering/3, 'ZYX'));
        for (let vertex = 0; vertex < fin.vertices.length; vertex += 3) {
          const point = new Vector3(fin.vertices[vertex], fin.vertices[vertex+1], -fin.vertices[vertex+2])
            .sub(pivot).applyQuaternion(rotation).add(anchor);
          expect(bounds.containsPoint(point), `${name}: ${fin.name}, steering ${steering}`).toBe(true);
        }
      }
    }
  }
});

test('original fish surfaces have outward smooth normals and opaque texture interiors', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Geometry calculations only need one run');
  const models = JSON.parse(readFileSync('public/aquarium/scene.json', 'utf8'));
  const samples: { name: string; texture: string; uvs: [number, number][] }[] = [];
  for (const [name, model] of Object.entries(models) as [string, any][]) {
    const body = model.meshes.find((part: any) => part.name === 'fishbody');
    if (!body) continue;
    const geometry = createFishGeometry(body, 0);
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv'), indices = geometry.index!;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    let volume = 0, minimumNormal = 1;
    const centers: [number, number][] = [];
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [indices.getX(i), indices.getX(i+1), indices.getX(i+2)];
      a.fromBufferAttribute(positions, triangle[0]);
      b.fromBufferAttribute(positions, triangle[1]);
      c.fromBufferAttribute(positions, triangle[2]);
      volume += a.dot(b.cross(c))/6;
      // TextureLoader flips image rows on upload: V=1 addresses the top row.
      centers.push([triangle.reduce((sum, index) => sum+uv.getX(index), 0)/3,
        1-triangle.reduce((sum, index) => sum+uv.getY(index), 0)/3]);
    }
    for (let i = 0; i < normals.count; i++) minimumNormal = Math.min(minimumNormal, a.fromBufferAttribute(normals, i).length());
    expect(volume, name).toBeGreaterThan(0);
    expect(minimumNormal, name).toBeGreaterThan(.99);
    samples.push({ name, texture: model.materials[body.materials[0]], uvs: centers });
    geometry.dispose();
  }
  await page.goto('/');
  const coverage = await page.evaluate(async samples => Promise.all(samples.map(async sample => {
    const image = new Image(); image.src = `/aquarium/${sample.texture}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const opaque = sample.uvs.filter(([u, v]) => {
      const x = Math.max(0, Math.min(image.width-1, Math.floor(u*image.width)));
      const y = Math.max(0, Math.min(image.height-1, Math.floor(v*image.height)));
      return pixels[(y*image.width+x)*4+3] >= 115;
    }).length;
    return { name: sample.name, ratio: opaque/sample.uvs.length };
  })), samples);
  for (const { name, ratio } of coverage) expect(ratio, name).toBeGreaterThan(.95);
});

test('all recorded fish remain upright and keep moving across two playback cycles', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Pure calculations only need one run');
  const metadata = JSON.parse(readFileSync('public/aquarium/motion.json', 'utf8'));
  const decoded = gunzipSync(readFileSync('public/aquarium/motion.dat'));
  const samples = new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength/2);
  const swimming = createSwimmingSampler(metadata, samples);
  for (const track of metadata.tracks) {
    const position = new Vector3(), previous = new Vector3(), up = new Vector3(), orientation = new Quaternion();
    let stillFrames = 0, longestStill = 0, minimumUp = 1, minimumSpeed = Infinity, finite = true;
    for (let step = 0; step < 12000; step++) {
      const { speed } = swimming(track.species, step/10, position, orientation);
      finite &&= Number.isFinite(position.lengthSq()) && Number.isFinite(orientation.lengthSq());
      minimumSpeed = Math.min(minimumSpeed, speed);
      minimumUp = Math.min(minimumUp, up.set(0, 1, 0).applyQuaternion(orientation).y);
      stillFrames = step && position.distanceTo(previous) < .002 ? stillFrames+1 : 0;
      longestStill = Math.max(longestStill, stillFrames);
      previous.copy(position);
    }
    expect(finite, track.species).toBe(true);
    expect(minimumSpeed, track.species).toBeGreaterThanOrEqual(.18);
    expect(minimumUp, track.species).toBeGreaterThan(.97);
    expect(longestStill/10, track.species).toBeLessThan(1);
  }
});

test('audio crossfade preserves adjacent samples at both sides of the loop seam', ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Pure calculations only need one run');
  const sampleRate = 48000, length = sampleRate*8;
  const original = Float32Array.from({ length }, (_, i) => .1*Math.sin(i*.037)+.05*Math.cos(i*.073));
  const [loop] = crossfadeLoop([original], sampleRate);
  const overlap = Math.round(sampleRate*.12), join = length-overlap*2;
  expect(loop.length).toBe(length-overlap);
  expect(loop[0]-loop[loop.length-1]).toBeCloseTo(original[overlap]-original[overlap-1], 7);
  expect(loop[join]-loop[join-1]).toBeCloseTo(original[length-overlap]-original[length-overlap-1], 7);
  expect(Array.from(loop).every(Number.isFinite)).toBe(true);
});
