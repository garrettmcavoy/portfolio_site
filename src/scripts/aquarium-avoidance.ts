import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { ReefBarrier } from './aquarium-reef';

export interface SwimmingBody {
  position: Vector3;
  orientation: Quaternion;
  bounds: Box3;
  nextPosition: Vector3;
  nextOrientation: Quaternion;
}

// These envelopes include fins and the animated body, so a separated pair
// cannot intersect even when either fish turns edge-on to the camera.
export function createFishAvoidance(reefs: ReefBarrier[] = []) {
  const offsets: Vector3[] = [];
  const reefSides: number[][] = [];
  const matrix = new Matrix4(), scale = new Vector3(1, 1, 1), origin = new Vector3();
  function worldBox(body: SwimmingBody, future: boolean, offset: Vector3) {
    matrix.compose(origin, future ? body.nextOrientation : body.orientation, scale);
    return body.bounds.clone().applyMatrix4(matrix)
      .translate(future ? body.nextPosition : body.position).translate(offset);
  }
  function separate(boxes: Box3[], corrections: Vector3[], sides: number[][]) {
    const axes = ['x', 'y', 'z'] as const;
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      for (const [i, box] of boxes.entries()) {
        const limits = (candidate: Box3) => {
          let minimum = -Infinity, maximum = Infinity;
          reefs.forEach((reef, r) => {
            if (!reef.overlapsFootprint(candidate)) return;
            if (sides[i][r] > 0) minimum = Math.max(minimum, reef.depth+.08-candidate.min.z);
            else maximum = Math.min(maximum, reef.depth-.08-candidate.max.z);
          });
          return { minimum, maximum };
        };
        let { minimum, maximum } = limits(box);
        if (minimum > maximum) {
          // A turning fish can be wider than the space between two reef cards.
          // Move around the coral silhouette rather than crossing either card.
          const probe = box.clone(), delta = new Vector3();
          const directions = [[0, 1], [-1, 0], [1, 0], [0, -1], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
          let found = false;
          for (let step = 1; step <= 320 && !found; step++) for (const [x, y] of directions) {
            delta.set(x*step*.05, y*step*.05, 0);
            probe.copy(box).translate(delta);
            const candidate = limits(probe);
            if (candidate.minimum > candidate.maximum) continue;
            box.copy(probe); corrections[i].add(delta);
            ({ minimum, maximum } = candidate);
            found = true; changed = true; break;
          }
        }
        const shift = Math.max(minimum, Math.min(maximum, 0));
        if (Math.abs(shift) < 1e-8) continue;
        box.min.z += shift; box.max.z += shift;
        corrections[i].z += shift;
        changed = true;
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const penetration = axes.map(axis =>
          (a.max[axis]-a.min[axis]+b.max[axis]-b.min[axis])/2
          -Math.abs((a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis])/2)+.08);
        if (penetration.some(value => value <= 0)) continue;
        // Prefer passing in front/behind; use a small vertical or lateral
        // sidestep when a head-on turn makes depth separation more disruptive.
        const cost = penetration.map((value, axis) => value*[2, 1.5, 1][axis]);
        const axis = axes[cost.indexOf(Math.min(...cost))];
        const amount = penetration[axes.indexOf(axis)]/2+.00001;
        const direction = b.min[axis]+b.max[axis] >= a.min[axis]+a.max[axis] ? 1 : -1;
        const delta = new Vector3(); delta[axis] = amount*direction;
        corrections[i].sub(delta); corrections[j].add(delta);
        a.translate(delta.clone().negate()); b.translate(delta);
        changed = true;
      }
      if (!changed) break;
    }
  }
  return (bodies: SwimmingBody[], seconds: number) => {
    while (offsets.length < bodies.length) offsets.push(new Vector3());
    const current = bodies.map((body, i) => worldBox(body, false, offsets[i]));
    current.forEach((box, i) => {
      reefSides[i] ??= [];
      reefs.forEach((reef, r) => {
        // Change sides in open water, never while crossing visible coral.
        if (!reefSides[i][r] || !reef.overlapsFootprint(box)) {
          reefSides[i][r] = (box.min.z+box.max.z)/2 >= reef.depth ? 1 : -1;
        }
      });
    });
    const dt = Math.max(0, Math.min(seconds, .05));
    const desired = offsets.map(offset => offset.clone().multiplyScalar(Math.exp(-dt*1.5)));
    // Look ahead along the recorded swimming paths before a contact happens.
    const future = bodies.map((body, i) => worldBox(body, true, desired[i]));
    const futureSides = future.map((box, i) => reefs.map((reef, r) => {
      if (!reef.overlapsFootprint(current[i]) && (box.min.z > reef.depth+.08 || box.max.z < reef.depth-.08)) {
        return (box.min.z+box.max.z)/2 >= reef.depth ? 1 : -1;
      }
      return reefSides[i][r];
    }));
    separate(future, desired, futureSides);
    const blend = 1-Math.exp(-dt*5);
    offsets.forEach((offset, i) => offset.lerp(desired[i], blend));
    // Also enforce clearance now, including the initial scene and sharp turns.
    separate(bodies.map((body, i) => worldBox(body, false, offsets[i])), offsets, reefSides);
    bodies.forEach((body, i) => body.position.add(offsets[i]));
  };
}
