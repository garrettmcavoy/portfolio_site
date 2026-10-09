// Blend the ends of the recording into a continuous loop. Web Audio schedules
// the loop on the audio clock, avoiding media-element/MP3 restart gaps.
export function crossfadeLoop(channels: Float32Array[], sampleRate: number) {
  const overlap = Math.min(Math.round(sampleRate*.12), Math.floor(channels[0].length/4));
  return channels.map(input => {
    const output = new Float32Array(input.length-overlap);
    const join = input.length-overlap*2;
    output.set(input.subarray(overlap, input.length-overlap));
    for (let i = 0; i < overlap; i++) {
      const t = i/(overlap-1);
      output[join+i] = input[input.length-overlap+i]*Math.cos(t*Math.PI/2)
        +input[i]*Math.sin(t*Math.PI/2);
    }
    return output;
  });
}

export function createAquariumAudio() {
  let context: AudioContext | undefined, master: GainNode | undefined;
  let recording: Promise<AudioBuffer> | undefined, source: AudioBufferSourceNode | undefined;
  let wanted = false, starting = false, muted = false, offset = 0, beganAt = 0;
  let voiceRecording: Promise<AudioBuffer> | undefined, voice: AudioBufferSourceNode | undefined;
  let bubbleVolume: GainNode | undefined;
  let tapCount = 0, voiceStarting = false, voiceEpoch = 0, disposed = false;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  const previousSessionType = session?.type;
  let ownsSession = false;
  function updateSession() {
    if (!session) return;
    try {
      // iPhone's default Web Audio session obeys the Ring/Silent switch.
      // Use media playback while sound is enabled, releasing it when idle.
      if (wanted && !muted && !disposed) {
        session.type = 'playback';
        ownsSession = true;
      } else if (ownsSession) {
        if (session.type === 'playback') session.type = previousSessionType ?? 'auto';
        ownsSession = false;
      }
    } catch { /* Audio Session is optional; other browsers use Web Audio directly. */ }
  }
  function setup() {
    if (!context) {
      context = new AudioContext({ latencyHint: 'interactive' });
      master = context.createGain();
      master.gain.value = muted ? 0 : .8;
      master.connect(context.destination);
    }
    return context;
  }
  function load(instance: AudioContext) {
    recording ??= fetch('/aquarium/bubbles.mp3').then(async response => {
      if (!response.ok) throw new Error('Bubble audio unavailable');
      const original = await instance.decodeAudioData(await response.arrayBuffer());
      const channels = crossfadeLoop(Array.from({ length: original.numberOfChannels }, (_, index) => original.getChannelData(index)), original.sampleRate);
      const buffer = instance.createBuffer(channels.length, channels[0].length, original.sampleRate);
      channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      return buffer;
    });
    return recording;
  }
  async function setBubbles(enabled: boolean) {
    wanted = enabled;
    updateSession();
    if (!enabled) {
      if (source && context) {
        offset = (offset+context.currentTime-beganAt)%source.buffer!.duration;
        source.stop(); source.disconnect(); source = undefined;
      }
      return;
    }
    if (source || starting) return;
    starting = true;
    try {
      const instance = setup();
      const [buffer] = await Promise.all([load(instance), instance.resume()]);
      if (!wanted || instance.state === 'closed') return;
      const bubbles = instance.createBufferSource();
      bubbles.buffer = buffer;
      bubbles.loop = true;
      const volume = instance.createGain();
      volume.gain.value = voice ? .09 : .3;
      bubbleVolume = volume;
      bubbles.connect(volume); volume.connect(master!);
      bubbles.onended = () => {
        volume.disconnect();
        if (bubbleVolume === volume) bubbleVolume = undefined;
      };
      beganAt = instance.currentTime;
      bubbles.start(0, offset);
      source = bubbles;
    } catch (error) {
      recording = undefined;
      console.warn('Bubble audio could not start:', error);
    } finally { starting = false; }
  }
  function loadVoice(instance: AudioContext) {
    voiceRecording ??= fetch('/aquarium/glass-warning.mp3').then(async response => {
      if (!response.ok) throw new Error('Aquarium voice unavailable');
      return instance.decodeAudioData(await response.arrayBuffer());
    }).catch(error => {
      voiceRecording = undefined;
      if (!disposed) console.warn('Aquarium voice could not load:', error);
      throw error;
    });
    return voiceRecording;
  }
  async function playVoice(instance: AudioContext) {
    if (voice || voiceStarting || muted || disposed) return;
    voiceStarting = true;
    const epoch = voiceEpoch;
    try {
      const [buffer] = await Promise.all([loadVoice(instance), instance.resume()]);
      if (muted || disposed || epoch !== voiceEpoch || instance.state === 'closed') return;
      const clip = instance.createBufferSource();
      clip.buffer = buffer;
      clip.connect(master!);
      clip.onended = () => {
        clip.disconnect();
        if (voice === clip) {
          voice = undefined;
          bubbleVolume?.gain.setTargetAtTime(.3, instance.currentTime, .15);
        }
      };
      voice = clip;
      bubbleVolume?.gain.setTargetAtTime(.09, instance.currentTime, .03);
      clip.start();
    } catch { /* A missing voice clip must not interrupt normal glass taps. */ }
    finally { voiceStarting = false; }
  }
  function setMuted(value: boolean) {
    muted = value;
    updateSession();
    if (context && master) master.gain.setTargetAtTime(value ? 0 : .8, context.currentTime, .015);
    if (value) { voiceEpoch++; voice?.stop(); }
  }
  function tap() {
    if (muted) return;
    const instance = setup();
    void instance.resume();
    const now = instance.currentTime;
    // Warm the small voice buffer on the first tap, rather than on page load.
    // Count only unmuted aquarium taps; controls/navigation never call tap().
    if (!voiceRecording) void loadVoice(instance).catch(() => {});
    if (++tapCount%10 === 0) void playVoice(instance);
    // A short contact click followed by the damped resonances of tank glass.
    for (const [frequency, level, decay] of [[345, .18, .075], [920, .08, .12], [1830, .035, .06]]) {
      const tone = instance.createOscillator(), envelope = instance.createGain();
      tone.frequency.value = frequency*(.98+Math.random()*.04);
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(level, now+.002);
      envelope.gain.exponentialRampToValueAtTime(.0001, now+decay);
      tone.connect(envelope); envelope.connect(master!);
      tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
      tone.start(now); tone.stop(now+decay+.01);
    }
  }
  return {
    setBubbles, setMuted, tap,
    unlock() {
      if (muted) return;
      const instance = setup();
      // Safari also uses an "interrupted" state after a call or app switch.
      if (instance.state !== 'running' && instance.state !== 'closed') void instance.resume().catch(error => console.warn('Audio could not resume:', error));
    },
    dispose() {
      disposed = true; voiceEpoch++; wanted = false;
      updateSession();
      voice?.stop(); voice?.disconnect(); source?.stop(); source?.disconnect();
      void context?.close();
    },
  };
}
