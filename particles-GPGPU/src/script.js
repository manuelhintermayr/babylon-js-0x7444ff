// Babylon.js port of `../particles-GPGPU/src/script.js` (Three.js).
//
// Pipeline parity with the original:
//   1. Load .glb, take its first child mesh's vertex positions (+ vertex
//      colours) as the seed cloud.
//   2. Pack base positions into an RGBA float texture; alpha = random
//      life-seed in [0, 1] so respawns stagger across particles.
//   3. Run a flow-field update shader every frame, ping-ponging between
//      two RenderTargetTextures. Particles whose life crosses 1.0 respawn
//      to their base position.
//   4. Render N points (Mesh in PointFillMode) whose vertex shader reads
//      the latest position from the active particles RT via a per-vertex
//      UV attribute.
//
// What changes from the Three.js source:
//   • `THREE.GPUComputationRenderer` → `EffectWrapper` + `EffectRenderer`
//     + two `RenderTargetTexture`s with an explicit ping-pong swap.
//   • `OrbitControls` → `ArcRotateCamera` with `attachControl` and matching
//     polar limits.
//   • `THREE.Points` + `PointsMaterial` → `Mesh` + `ShaderMaterial` with
//     `material.fillMode = Material.PointFillMode`.
//   • Standard Three uniforms (`modelMatrix`/`viewMatrix`/`projectionMatrix`)
//     map to Babylon's (`world`/`view`/`viewProjection`).
//   • Shaders are inline template literals — Babylon takes shader sources
//     as strings, so vite-plugin-glsl is not needed.
//
// Right-handed coord system is forced on the scene so the GLB import +
// the camera positions copied from the Three.js demo end up oriented
// the way the demo intended.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/loaders/glTF";
import GUI from "lil-gui";

import roseMusic      from "../../particles-GPGPU/src/audio/rose.mp3";
import spartanMusic   from "../../particles-GPGPU/src/audio/mvspartan.mp3";
import flowerMusic    from "../../particles-GPGPU/src/audio/flowers.mp3";
import chameleonMusic from "../../particles-GPGPU/src/audio/chameleon.mp3";

// ── Models config (1:1 with source) ─────────────────────────────────────

const isMobile = window.matchMedia("(max-width: 768px)").matches;

const models = [
  {
    name: "Spring Rose Garden",
    modelLink: "/rose.glb",
    camera: { x: 0, y: 10, z: 35 + (isMobile ? 10 : 0) },
    clearColor: "#120310",
    rotation: { x: Math.PI / 3, y: Math.PI / 2, z: Math.PI / 2 },
    uSize: 0.17,
    credits: "https://sketchfab.com/3d-models/spring-rose-garden-e938074ab933476e9b9a2be772e03335",
    music: roseMusic,
    musicCredits: "https://pixabay.com/users/lesfm-22579021",
    musicCreator: "Lesfm",
  },
  {
    name: "MV Spartan",
    modelLink: "/model.glb",
    camera: { x: 4.5, y: 4, z: 20 + (isMobile ? 8 : 0) },
    clearColor: "#1a1622",
    rotation: { x: 0, y: -Math.PI / 8, z: 0 },
    uSize: 0.07,
    credits: "https://sketchfab.com/3d-models/mv-spartan-e2c3ced464f14e3b864f15871bf6d87d",
    music: spartanMusic,
    musicCredits: "https://pixabay.com/users/humanoide_media-12661853/",
    musicCreator: "Luis Humanoide",
  },
  {
    name: "Flowerpot",
    modelLink: "/flowerpot.glb",
    camera: { x: 0, y: 0, z: 70 + (isMobile ? 25 : 0) },
    clearColor: "#2a1325",
    rotation: { x: 0, y: 0, z: 0 },
    uSize: 0.4,
    Influence: 0.3,
    Strength: 4,
    Frequency: 0.5,
    credits: "https://sketchfab.com/3d-models/flowers-in-vase-b1047276fc7f4421b5f695ad9ff59e72",
    music: flowerMusic,
    musicCredits: "https://pixabay.com/users/oleksii_kalyna-39191707/",
    musicCreator: "Oleksii Kalyna",
  },
  {
    name: "Chameleon",
    modelLink: "/chameleon.glb",
    camera: { x: 0, y: 10, z: 16 + (isMobile ? 8 : 0) },
    clearColor: "#041615",
    rotation: { x: 0, y: 0 + (isMobile ? -0.4 : 0), z: 0 },
    uSize: 0.14,
    credits: "https://sketchfab.com/3d-models/parsons-chameleon-calumma-parsonii-69b6bd49bf564b8c85d9921caa84e56a",
    music: chameleonMusic,
    musicCredits: "https://pixabay.com/users/shidenbeatsmusic-25676252",
    musicCreator: "Shiden Beats Music",
  },
];

// Cookie-based round-robin so each reload picks the next model.
const previousModelIndex = parseInt(document.cookie ? document.cookie : -1);
const modelIndex = (previousModelIndex + 1) % models.length;
document.cookie = modelIndex;
const model = models[modelIndex];

document.getElementById("curr-model-name").innerText = model.name;
document.getElementById("credits-anchor").href = model.credits;
document.getElementById("music-credits-anchor").innerText = model.musicCreator;
document.getElementById("music-credits-anchor").href = model.musicCredits;

// ── Audio ───────────────────────────────────────────────────────────────

const audio = new Audio(model.music);
audio.loop = true;
audio.volume = 0.2;
const musicBars = document.querySelectorAll(".music-bar");
document.getElementById("music-play-btn").addEventListener("click", () => {
  if (audio.paused) {
    musicBars.forEach((bar) => bar.classList.remove("paused"));
    audio.play();
  } else {
    musicBars.forEach((bar) => bar.classList.add("paused"));
    audio.pause();
  }
});

document.getElementById("next-model-button").addEventListener("click", () => {
  window.location.reload();
});

// ── Shaders ─────────────────────────────────────────────────────────────

// Pass-through used by EffectRenderer for full-screen quad rendering.
// EffectRenderer pre-binds a 2D quad with `position` attribute already.
const PASS_VERT = /* glsl */ `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// One-shot copy of a source texture into the bound RT — used to seed both
// ping-pong RTs from the base texture before the simulation starts.
const COPY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
void main() {
  gl_FragColor = texture2D(uSrc, vUv);
}
`;

// Public-domain simplex 4D noise (Ashima Arts / Ian McEwan), copied
// byte-for-byte from `../particles-GPGPU/src/shaders/includes/simplexNoise4d.glsl`.
const SIMPLEX_NOISE_4D = /* glsl */ `
vec4  permute     (vec4  x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float permute     (float x){ return floor(mod(((x*34.0)+1.0)*x, 289.0)); }
vec4  taylorInvSqrt(vec4  r){ return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r){ return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w   = 1.5 - dot(abs(p.xyz), ones.xyz);
  s     = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

float simplexNoise4d(vec4 v){
  const vec2 C = vec2(0.138196601125010504, 0.309016994374947451);
  vec4 i  = floor(v + dot(v, C.yyyy));
  vec4 x0 = v -   i + dot(i, C.xxxx);

  vec4 i0;
  vec3 isX  = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x   = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y  += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z  += isYZ.z;
  i0.w  += 1.0 - isYZ.z;

  vec4 i3 = clamp(i0,        0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0,  0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0,  0.0, 1.0);

  vec4 x1 = x0 - i1 + 1.0 * C.xxxx;
  vec4 x2 = x0 - i2 + 2.0 * C.xxxx;
  vec4 x3 = x0 - i3 + 3.0 * C.xxxx;
  vec4 x4 = x0 - 1.0 + 4.0 * C.xxxx;

  i = mod(i, 289.0);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4  j1 = permute(permute(permute(permute(
              i.w + vec4(i1.w, i2.w, i3.w, 1.0))
            + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
            + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
            + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);

  vec4 p0 = grad4(j0,   ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));

  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)),             0.0);
  m0 = m0 * m0; m1 = m1 * m1;

  return 49.0 * (dot(m0 * m0, vec3(dot(p0,x0), dot(p1,x1), dot(p2,x2)))
              +  dot(m1 * m1, vec2(dot(p3,x3), dot(p4,x4))));
}
`;

// GPGPU update — flow-field perturbation + life cycle. Matches the source's
// `gpgpu/particles-frag.glsl` line for line; only the texture-sampling
// function name changes (`texture` → `texture2D`) for GLSL ES 1.00.
const GPGPU_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${SIMPLEX_NOISE_4D}
uniform float     uTime;
uniform float     uDeltaTime;
uniform sampler2D uParticles;
uniform sampler2D uBase;
uniform float     Influence;
uniform float     Strength;
uniform float     Frequency;

void main() {
  float time = uTime * 0.2;
  vec4 particle = texture2D(uParticles, vUv);
  vec4 base     = texture2D(uBase,      vUv);

  if (particle.a >= 1.0) {
    // Dead particle respawn — wraparound life, snap back to base.
    particle.a   = mod(particle.a, 1.0);
    particle.xyz = base.xyz;
  } else {
    // Alive particle — flow-field push + life decay.
    float strength  = simplexNoise4d(vec4(base.xyz * 0.2, time + 1.0));
    float influence = (Influence - 0.5) * (-2.0);
    strength = smoothstep(influence, 1.0, strength);

    vec3 flowField = vec3(
      simplexNoise4d(vec4(particle.xyz * Frequency + 0.0, time)),
      simplexNoise4d(vec4(particle.xyz * Frequency + 1.0, time)),
      simplexNoise4d(vec4(particle.xyz * Frequency + 2.0, time))
    );
    flowField = normalize(flowField);
    particle.xyz += flowField * uDeltaTime * strength * Strength;
    particle.a   += uDeltaTime * 0.3;
  }

  gl_FragColor = particle;
}
`;

// Points-mesh vertex shader — the position comes from the particles RT,
// not from the vertex buffer. The `aParticlesUv` attribute carries each
// vertex's texel-centre UV so the shader can look up its own position.
//
// `world`, `view`, `viewProjection` are Babylon's standard uniform names —
// the equivalents of Three's `modelMatrix` / `viewMatrix` / `projectionMatrix`.
const POINTS_VERT = /* glsl */ `
precision highp float;
attribute vec3  position;
attribute vec3  aColor;
attribute vec2  aParticlesUv;
attribute float aSize;

uniform mat4      world;
uniform mat4      view;
uniform mat4      viewProjection;
uniform vec2      uResolution;
uniform float     uSize;
uniform sampler2D uParticlesTexture;

varying vec3 vColor;

void main() {
  vec4 particle = texture2D(uParticlesTexture, aParticlesUv);

  vec4 worldPos    = world * vec4(particle.xyz, 1.0);
  vec4 viewPos     = view  * worldPos;
  gl_Position      = viewProjection * worldPos;

  // Life-driven size envelope — fades in over the first 10 % of life and
  // out over the last 30 %. Same curve as the Three.js source.
  float sizeIn  = smoothstep(0.0, 0.1, particle.w);
  float sizeOut = 1.0 - smoothstep(0.7, 1.0, particle.w);
  float life    = min(sizeIn, sizeOut);

  gl_PointSize  = life * aSize * uSize * uResolution.y;
  gl_PointSize *= (1.0 / max(0.001, -viewPos.z));

  vColor = aColor;
}
`;

const POINTS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, 1.0);
}
`;

// ── Engine + scene ──────────────────────────────────────────────────────

const canvas = document.querySelector("canvas.webgl");

const engine = new Engine(canvas, true, {
  alpha: false,
  antialias: true,
  preserveDrawingBuffer: false,
  premultipliedAlpha: false,
  stencil: false,
});
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
// Match the Three.js demo's coord system so the per-model camera positions
// + rotation triplets line up without re-derivation.
scene.useRightHandedSystem = true;
const cc = parseHexColor(model.clearColor);
scene.clearColor = new Color4(cc[0], cc[1], cc[2], 1);

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

// `setPosition` recomputes alpha/beta/radius from the world-space camera
// position — saves us the trig of converting the demo's (x, y, z) into
// spherical coords by hand.
const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(model.camera.x, model.camera.y, model.camera.z));
camera.minZ = 0.01;
camera.maxZ = 1000;
camera.fov  = (35 * Math.PI) / 180;        // matches PerspectiveCamera(35, …)
camera.lowerBetaLimit  = Math.PI / 5;       // OrbitControls.minPolarAngle
camera.upperBetaLimit  = Math.PI / 2;       // OrbitControls.maxPolarAngle
camera.panningSensibility = 0;              // OrbitControls.enablePan = false
camera.inertia = 0.85;                      // damping equivalent
camera.attachControl(canvas, true);

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Load model ──────────────────────────────────────────────────────────

const imported = await SceneLoader.ImportMeshAsync(null, "/", model.modelLink.replace(/^\.?\//, ""), scene);

// The Three.js source takes `gltf.scene.children[0].geometry` directly.
// In Babylon, `ImportMeshAsync` returns the meshes flat; the first
// non-empty mesh is our equivalent.
const sourceMesh = imported.meshes.find((m) => m.getTotalVertices() > 0);
if (!sourceMesh) {
  throw new Error(`[gpgpu-babylon] no vertex data in ${model.modelLink}`);
}

const positions = sourceMesh.getVerticesData(VertexBuffer.PositionKind);
const colors    = sourceMesh.getVerticesData(VertexBuffer.ColorKind);  // may be null
const baseCount = positions.length / 3;

// We've extracted the vertex data — the source mesh is no longer needed
// in the scene (it would render as a solid mesh on top of the particles).
imported.meshes.forEach((m) => m.setEnabled(false));

// ── Base position texture ───────────────────────────────────────────────
// Square texture sized to ceil(sqrt(N)). Each texel: xyz = base position
// (vertex world-local; the particles mesh's `world` matrix supplies the
// rotation), a = random life-seed in [0, 1] for staggered respawns.

const gpgpuSize = Math.ceil(Math.sqrt(baseCount));
const baseData  = new Float32Array(gpgpuSize * gpgpuSize * 4);
for (let i = 0; i < baseCount; i++) {
  baseData[i * 4 + 0] = positions[i * 3 + 0];
  baseData[i * 4 + 1] = positions[i * 3 + 1];
  baseData[i * 4 + 2] = positions[i * 3 + 2];
  baseData[i * 4 + 3] = Math.random();
}

const baseTexture = new RawTexture(
  baseData,
  gpgpuSize,
  gpgpuSize,
  Constants.TEXTUREFORMAT_RGBA,
  scene,
  /* generateMipMaps */ false,
  /* invertY        */ false,
  Texture.NEAREST_SAMPLINGMODE,
  Constants.TEXTURETYPE_FLOAT,
);
baseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
baseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

// ── Ping-pong render targets ────────────────────────────────────────────

function makeRT(name) {
  const rt = new RenderTargetTexture(
    name,
    { width: gpgpuSize, height: gpgpuSize },
    scene,
    /* generateMipMaps         */ false,
    /* doNotChangeAspectRatio  */ true,
    Constants.TEXTURETYPE_FLOAT,
    /* isCube                  */ false,
    Texture.NEAREST_SAMPLINGMODE,
    /* generateDepthBuffer     */ false,
    /* generateStencilBuffer   */ false,
    /* isMulti                 */ false,
    Constants.TEXTUREFORMAT_RGBA,
  );
  rt.wrapU = Texture.CLAMP_ADDRESSMODE;
  rt.wrapV = Texture.CLAMP_ADDRESSMODE;
  rt.skipInitialClear = true;
  return rt;
}
let particlesRead  = makeRT("particlesA");
let particlesWrite = makeRT("particlesB");

const effectRenderer = new EffectRenderer(engine);

const copyWrapper = new EffectWrapper({
  name: "particlesCopy",
  engine,
  vertexShader:   PASS_VERT,
  fragmentShader: COPY_FRAG,
  attributeNames: ["position"],
  uniformNames:   [],
  samplerNames:   ["uSrc"],
});
const gpgpuWrapper = new EffectWrapper({
  name: "particlesGpgpu",
  engine,
  vertexShader:   PASS_VERT,
  fragmentShader: GPGPU_FRAG,
  attributeNames: ["position"],
  uniformNames:   ["uTime", "uDeltaTime", "Influence", "Strength", "Frequency"],
  samplerNames:   ["uParticles", "uBase"],
});

const gpgpuParams = {
  time: 0,
  dt: 0,
  influence: model.Influence ?? 0.2,
  strength:  model.Strength  ?? 4.0,
  frequency: model.Frequency ?? 0.5,
};

gpgpuWrapper.onApplyObservable.add(() => {
  const e = gpgpuWrapper.effect;
  e.setTexture("uParticles", particlesRead);
  e.setTexture("uBase",      baseTexture);
  e.setFloat("uTime",      gpgpuParams.time);
  e.setFloat("uDeltaTime", gpgpuParams.dt);
  e.setFloat("Influence",  gpgpuParams.influence);
  e.setFloat("Strength",   gpgpuParams.strength);
  e.setFloat("Frequency",  gpgpuParams.frequency);
});

// Seed both ping-pong RTs from the base texture once the copy effect compiles.
await effectReady(copyWrapper);
seedRT(baseTexture, particlesRead);
seedRT(baseTexture, particlesWrite);

function seedRT(src, dst) {
  const observer = copyWrapper.onApplyObservable.add(() => {
    copyWrapper.effect.setTexture("uSrc", src);
  });
  effectRenderer.render(copyWrapper, dst);
  copyWrapper.onApplyObservable.remove(observer);
}

// ── Particles mesh ──────────────────────────────────────────────────────
// One vertex per particle. Position attribute is dummy (the vertex shader
// reads world position from `uParticlesTexture`); culling is forced off
// since Babylon's bounding-box-based frustum cull would silently drop the
// mesh (its source positions are all 0,0,0).

const dummyPositions = new Float32Array(baseCount * 3);
const particlesUv    = new Float32Array(baseCount * 2);
const particleSizes  = new Float32Array(baseCount);
const particleColors = new Float32Array(baseCount * 3);
const indices        = new Uint32Array(baseCount);

const fallbackColor  = [0.17, 1.0, 0.72];   // matches the demo's fallback `vColor`

for (let y = 0; y < gpgpuSize; y++) {
  for (let x = 0; x < gpgpuSize; x++) {
    const i = y * gpgpuSize + x;
    if (i >= baseCount) break;
    particlesUv[i * 2 + 0] = (x + 0.5) / gpgpuSize;
    particlesUv[i * 2 + 1] = (y + 0.5) / gpgpuSize;
    particleSizes[i] = Math.random();
    indices[i] = i;
    if (colors) {
      // Source GLBs may store RGBA colour; we only need RGB for vColor.
      const stride = colors.length / baseCount; // 3 or 4
      particleColors[i * 3 + 0] = colors[i * stride + 0];
      particleColors[i * 3 + 1] = colors[i * stride + 1];
      particleColors[i * 3 + 2] = colors[i * stride + 2];
    } else {
      particleColors[i * 3 + 0] = fallbackColor[0];
      particleColors[i * 3 + 1] = fallbackColor[1];
      particleColors[i * 3 + 2] = fallbackColor[2];
    }
  }
}

const particlesMesh = new Mesh("particles", scene);
const vd = new VertexData();
vd.positions = dummyPositions;
vd.indices   = indices;
vd.applyToMesh(particlesMesh, false);

particlesMesh.setVerticesData("aColor",        particleColors, false, 3);
particlesMesh.setVerticesData("aParticlesUv",  particlesUv,    false, 2);
particlesMesh.setVerticesData("aSize",         particleSizes,  false, 1);
particlesMesh.alwaysSelectAsActiveMesh = true;

// Apply the demo's per-model rotation. Three's `Object3D.rotateZ/X/Y` is
// intrinsic — each rotation is in the object's local space after the
// previous one. Babylon's quaternion composition matches when we multiply
// in the same Z → X → Y order.
const qZ = Quaternion.RotationAxis(new Vector3(0, 0, 1), model.rotation.z);
const qX = Quaternion.RotationAxis(new Vector3(1, 0, 0), model.rotation.x);
const qY = Quaternion.RotationAxis(new Vector3(0, 1, 0), model.rotation.y);
particlesMesh.rotationQuaternion = qZ.multiply(qX).multiply(qY);

const particlesMaterial = new ShaderMaterial(
  "particlesMat",
  scene,
  { vertexSource: POINTS_VERT, fragmentSource: POINTS_FRAG },
  {
    attributes: ["position", "aColor", "aParticlesUv", "aSize"],
    uniforms:   ["world", "view", "viewProjection", "uResolution", "uSize"],
    samplers:   ["uParticlesTexture"],
  },
);
particlesMaterial.fillMode = Material.PointFillMode;

particlesMaterial.onBindObservable.add(() => {
  const e = particlesMaterial.getEffect();
  if (!e) return;
  e.setFloat2("uResolution",
    engine.getRenderWidth(),
    engine.getRenderHeight(),
  );
  e.setFloat("uSize", particlesMaterial.metadata.uSize);
  e.setTexture("uParticlesTexture", particlesRead);
});
particlesMaterial.metadata = { uSize: model.uSize };

particlesMesh.material = particlesMaterial;

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI({ width: 300 });
if (isMobile) gui.close();
const debugObject = { clearColor: model.clearColor };

gui.addColor(debugObject, "clearColor").onChange((value) => {
  const rgb = parseHexColor(value);
  scene.clearColor = new Color4(rgb[0], rgb[1], rgb[2], 1);
});
gui.add(particlesMaterial.metadata, "uSize", 0, 0.5, 0.0001).name("Size");
gui.add(gpgpuParams, "influence", 0, 1,  0.001).name("Influence");
gui.add(gpgpuParams, "strength",  0, 10, 0.001).name("Strength");
gui.add(gpgpuParams, "frequency", 0, 1,  0.001).name("Frequency");

// ── Render loop ─────────────────────────────────────────────────────────

let lastT = performance.now() / 1000;
const startT = lastT;

engine.runRenderLoop(() => {
  if (!gpgpuWrapper.isReady())                  return;
  if (!particlesMaterial.isReady(particlesMesh)) return;

  const now = performance.now() / 1000;
  const dt  = Math.min(now - lastT, 0.05);
  lastT = now;
  gpgpuParams.time = now - startT;
  gpgpuParams.dt   = dt;

  // 1) GPGPU step → write into `particlesWrite` while sampling `particlesRead`.
  effectRenderer.render(gpgpuWrapper, particlesWrite);

  // 2) Swap so the freshly-written texture is what the points shader samples.
  const t = particlesRead;
  particlesRead  = particlesWrite;
  particlesWrite = t;

  // 3) Render the scene — `onBindObservable` re-reads `particlesRead`.
  scene.render();
});

// ── Helpers ─────────────────────────────────────────────────────────────

function parseHexColor(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

function effectReady(ew) {
  return new Promise((resolve) => {
    const tick = () => (ew.isReady() ? resolve() : setTimeout(tick, 16));
    tick();
  });
}

// Reference Effect to keep build tools from tree-shaking the ShaderStore
// hookups Babylon registers in the side-effect imports above.
void Effect;
