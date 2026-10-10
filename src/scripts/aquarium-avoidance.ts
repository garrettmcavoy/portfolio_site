import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
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
  const steering: number[] = [];
  const encounters = new Map<string, { axis: 'x' | 'y' | 'z'; direction: number; hold: number }>();
  const velocities: Vector3[] = [];
  const blocked: number[] = [], escapeUntil: number[] = [], escape: Vector3[] = [];
  let clock = 0;
  const positions: Vector3[] = [], orientations: Quaternion[] = [], bases: Vector3[] = [];
  let initialized = false;
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
        // Keep a passing side for the whole encounter. Vertical arcs resemble
        // the reference; depth passing remains useful for broad fish.
        const key = `${i}/${j}`;
        let encounter = encounters.get(key);
        if (!encounter || encounter.hold < clock) {
          const cost = [Infinity, penetration[1], penetration[2]*1.5];
          const axis = axes[cost.indexOf(Math.min(...cost))];
          encounter = { axis, direction: b.min[axis]+b.max[axis] >= a.min[axis]+a.max[axis] ? 1 : -1, hold: clock+2 };
          encounters.set(key, encounter);
        }
        encounter.hold = clock+2;
        const axis = encounter.axis;
        const direction = encounter.direction;
        const amount = (direction > 0 ? a.max[axis]-b.min[axis]+.08 : b.max[axis]-a.min[axis]+.08)/2+.00001;
        const delta = new Vector3(); delta[axis] = amount*direction;
        corrections[i].sub(delta); corrections[j].add(delta);
        a.translate(delta.clone().negate()); b.translate(delta);
        changed = true;
      }
      if (!changed) break;
    }
  }
  return (bodies: SwimmingBody[], seconds: number) => {
    while (offsets.length < bodies.length) {
      offsets.push(new Vector3()); velocities.push(new Vector3());
      blocked.push(0); escapeUntil.push(0); escape.push(new Vector3()); steering.push(0);
    }
    const current = bodies.map((body, i) => {
      if (!initialized) return worldBox(body, false, offsets[i]);
      matrix.compose(positions[i], orientations[i], scale);
      return body.bounds.clone().applyMatrix4(matrix);
    });
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
    clock += dt;
    // This is a position goal, not a per-frame decay. The motor below applies
    // it per second, so the return arc does not depend on display refresh rate.
    const desired = offsets.map(offset => offset.clone().multiplyScalar(.97));
    // Look ahead along the recorded swimming paths before a contact happens.
    const future = bodies.map((body, i) => worldBox(body, true, desired[i]).expandByScalar(.15));
    const futureSides = future.map((box, i) => reefs.map((reef, r) => {
      if (!reef.overlapsFootprint(current[i]) && (box.min.z > reef.depth+.08 || box.max.z < reef.depth-.08)) {
        return (box.min.z+box.max.z)/2 >= reef.depth ? 1 : -1;
      }
      return reefSides[i][r];
    }));
    separate(future, desired, futureSides);
    if (!initialized) {
      separate(bodies.map((body, i) => worldBox(body, false, offsets[i])), offsets, reefSides);
      bodies.forEach((body, i) => {
        positions[i] = body.position.clone().add(offsets[i]);
        orientations[i] = body.orientation.clone();
        bases[i] = body.position.clone();
      });
      initialized = true;
    }
    if (!dt) {
      bodies.forEach((body, i) => { body.position.copy(positions[i]); body.orientation.copy(orientations[i]); });
      return steering;
    }
    const boxes = bodies.map((body, i) => {
      matrix.compose(positions[i], orientations[i], scale);
      return body.bounds.clone().applyMatrix4(matrix);
    });
    const clear = (box: Box3, i: number) => !reefs.some(reef =>
      box.min.z < reef.depth+.08 && box.max.z > reef.depth-.08 && reef.overlapsFootprint(box))
      && !boxes.some((other, j) => j !== i && box.intersectsBox(other));
    const wanted = bodies.map((body, i) => {
      const recordedVelocity = body.position.clone().sub(bases[i]).divideScalar(dt).clampLength(0, 1.4);
      return desired[i].clone().sub(offsets[i]).multiplyScalar(2).add(recordedVelocity).clampLength(0, 1.8);
    });
    const axes = ['x', 'y', 'z'] as const;
    // Begin yielding before the small-step contact guard is needed. The
    // stopping-distance limit leaves room for a gentle deceleration and turn.
    for (let i = 0; i < boxes.length; i++) {
      reefs.forEach(reef => {
        const box = boxes[i], probe = box.clone().expandByScalar(.3);
        if (!reef.overlapsFootprint(probe)) return;
        const direction = box.min.z > reef.depth ? -1 : box.max.z < reef.depth ? 1 : 0;
        if (!direction) return;
        const gap = direction < 0 ? box.min.z-reef.depth : reef.depth-box.max.z;
        const limit = Math.sqrt(1.4*Math.max(0, gap-.12));
        if (wanted[i].z*direction > limit) wanted[i].z = limit*direction;
      });
      for (let j = i+1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const gaps = axes.map(axis => Math.max(b.min[axis]-a.max[axis], a.min[axis]-b.max[axis]));
        const axis = axes[gaps.indexOf(Math.max(...gaps))], gap = Math.max(...gaps);
        if (gap < 0 || gap > 1) continue;
        const direction = b.min[axis]+b.max[axis] > a.min[axis]+a.max[axis] ? 1 : -1;
        const closing = (wanted[i][axis]-wanted[j][axis])*direction;
        const limit = Math.sqrt(1.4*Math.max(0, gap-.12));
        if (closing <= limit) continue;
        const yieldSpeed = (closing-limit)/2;
        wanted[i][axis] -= yieldSpeed*direction; wanted[j][axis] += yieldSpeed*direction;
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      if (blocked[i] > .2 && escapeUntil[i] < clock) {
        // Like the reference's held vertical targets, finish a gentle arc
        // instead of repeatedly nudging against the same contact plane.
        const directions = [new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
        if (positions[i].y > 2.5) directions.reverse();
        const direction = directions.find(direction => clear(boxes[i].clone().translate(direction.clone().multiplyScalar(.03)), i));
        if (direction) { escape[i].copy(direction); escapeUntil[i] = clock+1.5; }
      }
      if (clock < escapeUntil[i]) wanted[i].addScaledVector(escape[i], .4);
    }
    const targets = wanted.map((target, i) => {
      const acceleration = target.sub(velocities[i]).multiplyScalar(4).clampLength(0, 1.5);
      velocities[i].addScaledVector(acceleration, dt).clampLength(0, 1.8);
      return positions[i].clone().addScaledVector(velocities[i], dt);
    });
    const rotations = bodies.map((body, i) => {
      // Turn into the swimming direction without adding roll. Quaternion
      // shortest-path interpolation between steep opposite headings can bank
      // a fish beyond the upright limit even when both endpoints are upright.
      const velocity = velocities[i], from = new Euler().setFromQuaternion(orientations[i], 'YZX');
      const to = velocity.lengthSq() > .0025 ? new Euler(0, Math.atan2(velocity.z, -velocity.x),
        Math.max(-.2, Math.min(.2, -Math.asin(velocity.y/velocity.length()))), 'YZX')
        : new Euler().setFromQuaternion(body.orientation, 'YZX');
      const yaw = Math.atan2(Math.sin(to.y-from.y), Math.cos(to.y-from.y)), tilt = to.z-from.z;
      const fraction = Math.min(1, dt*1.2/Math.max(1e-8, Math.hypot(yaw, tilt)));
      return new Euler(0, from.y+yaw*fraction, from.z+tilt*fraction, 'YZX');
    });
    // Constrain the next small movement, rather than projecting a fish across
    // an obstacle. Preserve tangential swimming when one direction is blocked.
    for (let i = 0; i < bodies.length; i++) {
      const position = positions[i].clone();
      for (const axis of ['z', 'y', 'x'] as const) {
        const destination = targets[i][axis];
        const from = position[axis];
        for (let fraction = 1; fraction > 1e-5; fraction *= .5) {
          position[axis] = from+(destination-from)*fraction;
          matrix.compose(position, orientations[i], scale);
          const box = bodies[i].bounds.clone().applyMatrix4(matrix);
          if (clear(box, i)) { boxes[i].copy(box); break; }
          position[axis] = from;
        }
      }
      const moved = position.distanceTo(positions[i]);
      blocked[i] = moved < dt*.025 ? blocked[i]+dt : 0;
      positions[i].copy(position);
      const before = new Euler().setFromQuaternion(orientations[i], 'YZX');
      const beforeHeading = before.y;
      const yaw = Math.atan2(Math.sin(rotations[i].y-before.y), Math.cos(rotations[i].y-before.y));
      for (let fraction = 1; fraction > 1e-5; fraction *= .5) {
        const orientation = new Quaternion().setFromEuler(new Euler(0,
          before.y+yaw*fraction, before.z+(rotations[i].z-before.z)*fraction, 'YZX'));
        matrix.compose(position, orientation, scale);
        const box = bodies[i].bounds.clone().applyMatrix4(matrix);
        if (clear(box, i)) { boxes[i].copy(box); orientations[i].copy(orientation); break; }
      }
      const afterHeading = new Euler().setFromQuaternion(orientations[i], 'YZX').y;
      const turn = Math.atan2(Math.sin(afterHeading-beforeHeading), Math.cos(afterHeading-beforeHeading))/dt;
      const bend = Math.max(-.65, Math.min(.65, -turn*.5));
      steering[i] += (bend-steering[i])*(1-Math.exp(-dt*6));
    }
    bodies.forEach((body, i) => {
      bases[i].copy(body.position);
      offsets[i].copy(positions[i]).sub(body.position);
      body.position.copy(positions[i]); body.orientation.copy(orientations[i]);
    });
    return steering;
  };
}
