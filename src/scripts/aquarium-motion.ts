import { Euler, Quaternion, Vector3 } from 'three';

interface Track { species: string; offset: number; frames: number; start: number; join: number }
interface Recording { hz: number; stride: number; tracks: Track[] }

// Refresh the index and packed samples together after regenerating paths.
const recordingVersion = 'all-active-112-1';

export async function loadSwimming() {
  const [metadata, response] = await Promise.all([
    fetch(`/aquarium/motion.json?v=${recordingVersion}`).then(async response => {
      if (!response.ok) throw new Error('Aquarium motion unavailable');
      return response.json() as Promise<Recording>;
    }),
    fetch(`/aquarium/motion.dat?v=${recordingVersion}`),
  ]);
  if (!response.ok || !response.body) throw new Error('Aquarium motion unavailable');
  const decoded = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return createSwimmingSampler(metadata, new Int16Array(decoded));
}

export function createSwimmingSampler(metadata: Recording, samples: Int16Array) {
  const position = new Vector3(), orientation = new Quaternion(), nextOrientation = new Quaternion();
  const upright = new Euler(0, 0, 0, 'YZX');
  const tracks = new Map(metadata.tracks.map(track => {
    const timeline = new Float64Array(track.frames);
    for (let i = 1; i < track.frames; i++) {
      const a = track.offset+(i-1)*metadata.stride, b = a+metadata.stride;
      const distance = Math.hypot(samples[b]-samples[a], samples[b+1]-samples[a+1], samples[b+2]-samples[a+2])/1000;
      // Keep natural slowing, but pass through near-stationary poses quickly
      // rather than leaving a fish hanging motionless for several seconds.
      timeline[i] = timeline[i-1]+Math.max(.005, Math.min(1/metadata.hz, distance/.18));
    }
    return [track.species, { ...track, timeline }] as const;
  }));

  return (species: string, seconds: number, targetPosition: Vector3, targetOrientation: Quaternion) => {
    const track = tracks.get(species)!;
    const duration = track.timeline[track.frames-1];
    const time = (seconds+track.timeline[Math.round(track.start*metadata.hz)])%duration;
    let low = 0, high = track.frames-1;
    while (high-low > 1) {
      const middle = (low+high)>>>1;
      if (track.timeline[middle] <= time) low = middle;
      else high = middle;
    }
    const frame = low;
    const fraction = (time-track.timeline[frame])/(track.timeline[frame+1]-track.timeline[frame]);
    const a = track.offset+frame*metadata.stride;
    const b = a+metadata.stride;
    const interpolate = (column: number, scale: number) =>
      (samples[a+column]+(samples[b+column]-samples[a+column])*fraction)/scale;
    targetPosition.set(interpolate(0, 1000), interpolate(1, 1000), interpolate(2, 1000));
    targetOrientation.set(samples[a+3]/32767, samples[a+4]/32767, samples[a+5]/32767, samples[a+6]/32767).normalize();
    nextOrientation.set(samples[b+3]/32767, samples[b+4]/32767, samples[b+5]/32767, samples[b+6]/32767).normalize();
    targetOrientation.slerp(nextOrientation, fraction);
    let steering = interpolate(7, 16384), speed = interpolate(8, 10000);
    if (track.join && time > duration-track.join) {
      // Only the short recurrence join is reconstructed; the swimming between
      // joins comes from the isolated original routine, including its avoidance.
      const t = (time-duration+track.join)/track.join;
      const blend = t*t*(3-2*t);
      const first = track.offset;
      position.set(samples[first]/1000, samples[first+1]/1000, samples[first+2]/1000);
      orientation.set(samples[first+3]/32767, samples[first+4]/32767, samples[first+5]/32767, samples[first+6]/32767).normalize();
      targetPosition.lerp(position, blend);
      targetOrientation.slerp(orientation, blend);
      steering += (samples[first+7]/16384-steering)*blend;
      speed += (samples[first+8]/10000-speed)*blend;
    }
    // Preserve the original heading and 3D turns while keeping the dorsal side
    // upright. Large pitching angles make the tall bannerfish look collapsed.
    upright.setFromQuaternion(targetOrientation, 'YZX');
    upright.x = 0;
    upright.z = Math.max(-.2, Math.min(.2, upright.z));
    targetOrientation.setFromEuler(upright);
    return { steering, speed: Math.max(.18, speed) };
  };
}
