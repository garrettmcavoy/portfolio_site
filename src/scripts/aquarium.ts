import {
  AlwaysStencilFunc, AmbientLight, Box3, BufferGeometry, Color, DirectionalLight, DoubleSide, EqualStencilFunc,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshPhongMaterial,
  PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, ReplaceStencilOp, Scene,
  ShaderMaterial, ShapeUtils, SRGBColorSpace, TextureLoader, Vector2,
  Vector3, WebGLRenderer,
} from 'three';
import { loadSwimming } from './aquarium-motion';
import { createAquariumAudio } from './aquarium-audio';
import { createFishGeometry } from './aquarium-geometry';
import { createFishAvoidance } from './aquarium-avoidance';
import { createReefBarrier, type ReefTriangle } from './aquarium-reef';

interface Part {
  name: string;
  vertices: number[];
  uvs: number[];
  faces: number[][];
  faceMaterials: number[];
  materials: string[];
  normals: number[];
  normalFaces: number[][];
}
interface Model { meshes: Part[]; materials: Record<string, string | null> }
type Models = Record<string, Model>;

const backgrounds = {
  classic: { top: [.002, .012, .12], bottom: [.018, .14, .105], light: 1, tint: 0xfff5df },
  blue: { top: [.003, .028, .22], bottom: [.012, .10, .23], light: 1.05, tint: 0xe9f6ff },
  lagoon: { top: [.004, .06, .12], bottom: [.025, .25, .19], light: 1.1, tint: 0xecffeb },
  dusk: { top: [.02, .008, .075], bottom: [.075, .055, .10], light: .75, tint: 0xffd2a0 },
  night: { top: [.001, .003, .018], bottom: [.003, .016, .035], light: .4, tint: 0xb9d8ff },
  black: { top: [0, 0, 0], bottom: [0, 0, 0], light: 1, tint: 0xfff5df },
};
type Background = keyof typeof backgrounds;

// Recovered tail-vertex phase offsets; global angular speed is 14 rad/s.
const tailPhases: Record<number, number> = { 22: 91, 16: 84, 15: 70, 23: 56, 25: 42, 21: 28, 20: 14, 27: 0, 28: 0 };

const aquarium = document.querySelector<HTMLElement>('[data-aquarium]');
if (aquarium) initialize(aquarium).catch(error => {
  // The static reef remains available when WebGL or an asset is unavailable.
  console.warn('Aquarium could not start:', error);
});

async function initialize(container: HTMLElement) {
  const canvas = container.querySelector<HTMLCanvasElement>('canvas')!;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  const response = await fetch('/aquarium/scene.json');
  if (!response.ok) throw new Error('Aquarium scene unavailable');
  const models: Models = await response.json();
  const loader = new TextureLoader();
  const textureNames = [...new Set([...Object.values(models).flatMap(model => Object.values(model.materials)).filter((name): name is string => !!name), 'BUBBLES.webp'])];
  const [swimming, textureEntries] = await Promise.all([loadSwimming(), Promise.all(textureNames.map(async name => {
    const texture = await loader.loadAsync(`/aquarium/${name}`);
    texture.colorSpace = SRGBColorSpace;
    return [name, texture] as const;
  }))]);
  const textures = new Map(textureEntries);

  const scene = new Scene();
  // Original DirectX camera: FOV .9305 rad, 4:3, near 1, far 15.
  // Reflect source Z to convert its left-handed coordinates to Three.
  const camera = new PerspectiveCamera(.9304999709*180/Math.PI, 4/3, 1, 15);
  camera.position.set(0, .02, 10);
  const ambient = new AmbientLight(0xd9e9ff, 2.1);
  scene.add(ambient);
  const light = new DirectionalLight(0xfff5df, 2.5);
  light.position.set(-3, 9, 12);
  scene.add(light);

  const water = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { time: { value: 0 }, top: { value: new Color() }, bottom: { value: new Color() } },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`,
    fragmentShader: `varying vec2 vUv; uniform float time; uniform vec3 top; uniform vec3 bottom;
      void main(){
        vec3 color=mix(bottom,top,smoothstep(0.0,1.0,vUv.y));
        float light=.84+.16*sin(time*.032);
        gl_FragColor=vec4(color*light,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const background = new Mesh(new PlaneGeometry(2, 2), water);
  background.renderOrder = -10;
  background.frustumCulled = false;
  scene.add(background);

  const allocated: BufferGeometry[] = [];
  const materials: (MeshPhongMaterial | MeshBasicMaterial)[] = [];
  const reefMaterials: MeshBasicMaterial[] = [];
  function makeModel(model: Model, reef = false, reefStencil = 1) {
    const group = new Group();
    const bend = model.meshes.find(part => part.name === 'fishbend');
    for (const part of model.meshes) {
      // fishbend is the original alternate body pose, not a second visible fish.
      if (part.name === 'fishbend' || part.name === 'starshad') continue;
      for (const [materialIndex, materialName] of part.materials.entries()) {
        const position: number[] = [], uv: number[] = [], normals: number[] = [];
        if (!bend) for (const [faceIndex, face] of part.faces.entries()) {
          const faceMaterial = part.faceMaterials.length === 1 ? part.faceMaterials[0] : part.faceMaterials[faceIndex];
          if (faceMaterial !== materialIndex) continue;
          const triangles = reef
            ? ShapeUtils.triangulateShape(face.map(index => new Vector2(part.vertices[index*3], part.vertices[index*3+1])), [])
            : Array.from({ length: face.length-2 }, (_, i) => [0, i+1, i+2]);
          for (const triangle of triangles) for (const corner of triangle) {
            const index = face[corner];
            position.push(part.vertices[index*3], part.vertices[index*3+1], -part.vertices[index*3+2]);
            // DDS artwork and the recovered UVs already agree with the reef's
            // texture convention. A second V flip cuts transparent holes into
            // the fish and places dorsal markings on their underside.
            uv.push(part.uvs[index*2], part.uvs[index*2+1]);
            if (part.normalFaces.length) {
              const normalIndex = part.normalFaces[faceIndex][corner];
              normals.push(part.normals[normalIndex*3], part.normals[normalIndex*3+1], -part.normals[normalIndex*3+2]);
            }

          }
        }
        const geometry = bend ? createFishGeometry(part, materialIndex) : new BufferGeometry();
        if (!bend) {
          geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
          geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
          if (normals.length) geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
          else geometry.computeVertexNormals();
        }

        allocated.push(geometry);
        const textureName = model.materials[materialName];
        const settings = {
          map: textureName ? textures.get(textureName) : null, side: DoubleSide, alphaTest: .45,
          // Visible reef fragments mark their layer; foreground fish clear it.
          stencilWrite: true, stencilFunc: AlwaysStencilFunc,
          stencilRef: reef ? reefStencil : 0, stencilZPass: ReplaceStencilOp,
        };
        const material = reef ? new MeshBasicMaterial(settings) : new MeshPhongMaterial({ ...settings, shininess: 18, specular: new Color(0x253144) });
        materials.push(material);
        if (reef) reefMaterials.push(material as MeshBasicMaterial);
        const mesh = new Mesh(geometry, material);
        mesh.name = part.name;
        if (part.name === 'fishbody' && bend) {
          mesh.userData.body = { straight: part.vertices, bend: bend.vertices };
          // The original tail can bend outside its undeformed bounds.
          mesh.frustumCulled = false;
        }
        if (part.name === 'leftfin' || part.name === 'rightfin') {
          const body = model.meshes.find(p => p.name === 'fishbody')!;
          const attachIndex = part.name === 'leftfin' ? 78 : 157;
          const pivot = [part.vertices[0], part.vertices[1], -body.vertices[attachIndex*3+2]];
          geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
          mesh.position.set(...pivot as [number, number, number]);
          mesh.rotation.order = 'ZYX';
          mesh.userData.attachIndex = attachIndex;
        }
        group.add(mesh);
      }
    }
    return group;
  }
  const distantReef = makeModel(models.TANKDISTANCE, true, 2);
  scene.add(distantReef);
  const reef = makeModel(models.BKGRND, true);
  scene.add(reef);

  const star = makeModel(models.STARFISH);
  star.position.set(-1.6, -4.5, .6);
  star.rotation.x = Math.PI / 2.5;
  star.rotation.z = .25;
  star.scale.setScalar(.46);
  scene.add(star);

  const species = ['YELLOW_TANG', 'REGAL_TANG', 'WIMPLEFISH', 'PERCULA_CLOWNFISH', 'POWDER_BLUE_TANG', 'FLAME_ANGEL', 'ROYAL_GRAMMA'];
  const fish = species.map(name => {
    const group = makeModel(models[name]);
    scene.add(group);
    return { name, group, bounds: new Box3(), nextPosition: new Vector3(), nextOrientation: new Quaternion() };
  });
  const reefBarriers = [reef, distantReef].map(group => {
    const triangles: ReefTriangle[] = [];
    for (const child of group.children) {
      const mesh = child as Mesh<BufferGeometry, MeshBasicMaterial>;
      const image = mesh.material.map!.image as HTMLImageElement;
      const mask = document.createElement('canvas');
      mask.width = image.width; mask.height = image.height;
      const context = mask.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, mask.width, mask.height);
      const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
      const positionAt = (index: number) => [position.getX(index), position.getY(index)] as const;
      const uvAt = (index: number) => [uv.getX(index), uv.getY(index)] as const;
      for (let i = 0; i < position.count; i += 3) {
        triangles.push({
          positions: [positionAt(i), positionAt(i+1), positionAt(i+2)],
          uvs: [uvAt(i), uvAt(i+1), uvAt(i+2)],
          image: pixels,
        });
      }
    }
    const mesh = group.children[0] as Mesh;
    return createReefBarrier(mesh.geometry.getAttribute('position').getZ(0), triangles);
  });
  const avoidFish = createFishAvoidance(reefBarriers);
  const partBounds = new Box3();
  let lastAvoidanceTime = 0;

  // The original caustic texture contains black, low-alpha shadows. Its UVs
  // scroll horizontally at .0005 units/ms across the two shaped reef meshes.
  const causticTexture = textures.get('LIGHTPLAY.webp')!;
  causticTexture.wrapS = causticTexture.wrapT = RepeatWrapping;
  const causticMaterial = new MeshBasicMaterial({
    map: causticTexture, transparent: true, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    // These shaped light cards sit in front of parts of the reef. Restrict
    // their shadows to visible coral, never fish or open water in front of it.
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: EqualStencilFunc, stencilRef: 1,
  });
  materials.push(causticMaterial);
  for (const name of ['LIGHTPLAY', 'LIGHTPLAYDIST']) {
    const caustics = makeModel(models[name]);
    const layerMaterial = name === 'LIGHTPLAY' ? causticMaterial : causticMaterial.clone();
    if (name === 'LIGHTPLAYDIST') { layerMaterial.stencilRef = 2; materials.push(layerMaterial); }
    for (const child of caustics.children) {
      const mesh = child as Mesh;
      const previous = mesh.material as MeshBasicMaterial;
      materials.splice(materials.indexOf(previous), 1);
      previous.dispose();
      mesh.material = layerMaterial;
    }
    scene.add(caustics);
  }

  const bubbleTime = { value: 0 };
  const bubbleMaterials: ShaderMaterial[] = [];
  // Restore the reference's two tilted quads, behind the foreground reef.
  // Source Z 1.20/1.21 becomes negative in Three; the former +.35 put the
  // entire bubble strip in front of the tank and on the opposite side.
  for (const [positions, uvHeight, rate, half] of [
    [[-2, -2.7, -1.2, -2.3, 5.7, -1.2, -1.3, -2.7, -1.2, -1, 5.7, -1.2], 1.8, .7, 0],
    [[-2.5, -2.7, -1.21, -2.6, 5.7, -1.21, -1, -2.7, -1.21, -.8, 5.7, -1.21], 2.5, .6, .5],
  ] as const) {
    // Tall windows expose the top of the original strips after the downward
    // framing shift. Extend their slopes above the tallest camera view, with
    // matching UV repeats so bubble size, spacing and speed stay unchanged.
    const extendedPositions: number[] = [...positions];
    const heightRatio = (7-positions[1])/(positions[4]-positions[1]);
    for (const bottom of [0, 6]) {
      const top = bottom+3;
      extendedPositions[top] = positions[bottom]+(positions[top]-positions[bottom])*heightRatio;
      extendedPositions[top+1] = 7;
    }
    const extendedUvHeight = uvHeight*heightRatio;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(extendedPositions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([half, 0, half, extendedUvHeight, half+.5, 0, half+.5, extendedUvHeight], 2));
    geometry.setIndex([0, 2, 1, 2, 3, 1]);
    allocated.push(geometry);
    const material = new ShaderMaterial({
    uniforms: { time: bubbleTime, rate: { value: rate }, bubbles: { value: textures.get('BUBBLES.webp') } },
    transparent: true, depthWrite: false, depthTest: true, side: DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D bubbles; uniform float time; uniform float rate;
      void main(){
        vec4 sampleColor=texture2D(bubbles,vec2(vUv.x,fract(1.-vUv.y+time*rate)));
        gl_FragColor=sampleColor;
        #include <colorspace_fragment>
      }`,
  });
    bubbleMaterials.push(material);
    scene.add(new Mesh(geometry, material));
  }

  let elapsed = 0, lastFrame = 0, frame = 0, paused = false, visible = true;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  paused = motion.matches;
  const sound = container.querySelector<HTMLButtonElement>('[data-sound]')!;
  const audio = createAquariumAudio();
  const backgroundOptions = [...container.querySelectorAll<HTMLInputElement>('[data-background]')];
  const settings = container.querySelector<HTMLDetailsElement>('.aquarium-settings')!;
  let selectedBackground: Background = 'classic';
  let soundEnabled = true;
  try {
    const saved = JSON.parse(localStorage.getItem('portfolio-aquarium-settings') || '{}');
    if (Object.hasOwn(backgrounds, saved.background)) selectedBackground = saved.background;
    if (typeof saved.soundEnabled === 'boolean') soundEnabled = saved.soundEnabled;
  } catch { /* Storage can be unavailable in private/embedded contexts. */ }
  function saveSettings() {
    try {
      localStorage.setItem('portfolio-aquarium-settings', JSON.stringify({ background: selectedBackground, soundEnabled }));
    } catch { /* Optional preference persistence. */ }
  }
  function applySound() {
    sound.setAttribute('aria-label', soundEnabled ? 'Mute aquarium sound' : 'Unmute aquarium sound');
    sound.setAttribute('title', soundEnabled ? 'Mute sound' : 'Unmute sound');
    sound.setAttribute('aria-pressed', String(!soundEnabled));
    audio.setMuted(!soundEnabled);
  }
  // Restore the icon and audio gain before starting any sound or showing controls.
  applySound();
  function applyBackground() {
    const preset = backgrounds[selectedBackground];
    backgroundOptions.forEach(option => { option.checked = option.value === selectedBackground; });
    water.uniforms.top.value.setRGB(...preset.top as [number, number, number]);
    water.uniforms.bottom.value.setRGB(...preset.bottom as [number, number, number]);
    ambient.intensity = 2.1*preset.light;
    light.intensity = 2.5*preset.light;
    light.color.setHex(preset.tint);
    reefMaterials.forEach(material => material.color.setScalar(preset.light));
    render();
  }
  backgroundOptions.forEach(option => option.addEventListener('change', () => {
    selectedBackground = option.value as Background;
    applyBackground();
    saveSettings();
    settings.open = false;
    settings.querySelector('summary')!.focus({ preventScroll: true });
  }));
  function render() {
    water.uniforms.time.value = elapsed;
    causticTexture.offset.x = -(elapsed*.5)%1;
    for (const { name, group, bounds, nextPosition, nextOrientation } of fish) {
      const { steering, speed } = swimming(name, elapsed, group.position, group.quaternion);
      for (const child of group.children) {
        const mesh = child as Mesh;
        if (mesh.userData.body) {
          const { straight, bend } = mesh.userData.body as {
            straight: number[]; bend: number[];
          };
          const attribute = mesh.geometry.getAttribute('position');
          const amount = -steering, cruising = Math.max(0, Math.min(1, speed-.1));
          for (let vertex = 0; vertex < attribute.count; vertex++) {
            const source = vertex, index = source*3;
            const x = straight[index]+(bend[index]-straight[index])*Math.abs(amount);
            const y = bend[index+1]*(1-cruising)+straight[index+1]*cruising;
            let z = straight[index+2]+(bend[index+2]-straight[index+2])*amount;
            const phase = tailPhases[source];
            if (phase !== undefined) z += Math.cos(elapsed*14+phase)/28;
            attribute.setXYZ(vertex, x, y, -z);
          }
          attribute.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
        }
        if (mesh.name === 'leftfin' || mesh.name === 'rightfin') {
          const body = group.children.find(child => child.name === 'fishbody') as Mesh;
          mesh.position.z = body.geometry.getAttribute('position').getZ(mesh.userData.attachIndex);
          mesh.rotation.y = -(steering+(mesh.name === 'leftfin' ? .3 : -.3));
          mesh.rotation.z = -steering/3;
        }
      }
      bounds.makeEmpty();
      for (const child of group.children) {
        const mesh = child as Mesh;
        mesh.updateMatrix();
        if (mesh.userData.body || !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        partBounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrix);
        bounds.union(partBounds);
      }
      swimming(name, elapsed+.8, nextPosition, nextOrientation);
    }
    avoidFish(fish.map(({ group, bounds, nextPosition, nextOrientation }) => ({
      position: group.position, orientation: group.quaternion, bounds, nextPosition, nextOrientation,
    })), elapsed-lastAvoidanceTime);
    lastAvoidanceTime = elapsed;
    bubbleTime.value = elapsed;
    renderer.render(scene, camera);
  }
  function tick(now: number) {
    frame = 0;
    if (paused || !visible || document.hidden) { lastFrame = 0; return; }
    if (lastFrame) elapsed += Math.min((now-lastFrame)/1000, .05);
    lastFrame = now;
    render();
    frame = requestAnimationFrame(tick);
  }
  function updateLoop() {
    cancelAnimationFrame(frame);
    lastFrame = 0;
    if (!paused && visible && !document.hidden) frame = requestAnimationFrame(tick);
    void audio.setBubbles(soundEnabled && visible && !document.hidden);
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height, false);
    // Cover the window with the original composition, preserving proportions.
    // Keep the seabed in view, with a small downward framing shift that crops
    // the lettering at its bottom edge consistently across window sizes.
    const fullWidth = Math.max(width, height*4/3);
    const fullHeight = fullWidth*3/4;
    camera.setViewOffset(fullWidth, fullHeight, (fullWidth-width)/2, fullHeight-height-height*.05, width, height);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000);
    renderer.clear();
    render();
  }
  sound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    applySound();
    saveSettings();
    updateLoop();
  });
  container.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('.aquarium-controls')) return;
    audio.tap();
  });
  // Autoplay can be suspended until a trusted interaction. Resume the same
  // context on that interaction, without requiring a separate Sound button.
  const unlockAudio = (event: Event) => {
    if (soundEnabled) audio.unlock();
    if (event.type === 'pointerdown' && !settings.contains(event.target as Node)) settings.open = false;
    if (event instanceof KeyboardEvent && event.key === 'Escape' && settings.open) {
      settings.open = false;
      settings.querySelector('summary')!.focus({ preventScroll: true });
    }
  };
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('pointerup', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updateLoop(); });
  intersectionObserver.observe(container);
  document.addEventListener('visibilitychange', updateLoop);
  motion.addEventListener('change', event => { paused = event.matches; updateLoop(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { resize(); updateLoop(); } });
  window.addEventListener('pagehide', event => {
    void audio.setBubbles(false);
    cancelAnimationFrame(frame);
    // A page in the back/forward cache needs its GPU resources when restored.
    if (event.persisted) return;
    document.removeEventListener('pointerdown', unlockAudio, true);
    document.removeEventListener('pointerup', unlockAudio, true);
    document.removeEventListener('keydown', unlockAudio, true);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    allocated.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    bubbleMaterials.forEach(material => material.dispose());
    audio.dispose();
    background.geometry.dispose(); water.dispose(); renderer.dispose();
  });
  applyBackground(); resize(); render();
  container.setAttribute('data-ready', '');
  container.querySelector<HTMLElement>('.aquarium-controls')!.hidden = false;
  updateLoop();
}
