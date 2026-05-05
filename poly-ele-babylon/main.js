// Babylon.js port of `../poly-ele/main.js` (Three.js).
//
// Loads ele.glb (DRACO-compressed Disney elephant), reads its triangles,
// computes a per-triangle centroid (the `center` attribute), and feeds
// it into a custom vertex shader that:
//   1. Shrinks every triangle towards its centroid (uTriScale).
//   2. Pixelates positions to a uMosaic grid (animated via gsap-driven
//      uProgress 0↔1 yoyo).
//   3. Wobbles the result with 4D Perlin noise + per-axis rotation.
// The fragment shader maps (vUv * RGB-shift uniforms) to colour.
// EffectComposer + UnrealBloomPass adds bloom on top.
//
// Migration notes:
//   • THREE.GLTFLoader + DRACOLoader → @babylonjs/loaders/glTF +
//     SceneLoader.ImportMeshAsync. Babylon's loader auto-fetches DRACO.
//   • THREE.BufferGeometry.toNonIndexed() (gives every triangle its own
//     three vertices) → mesh.convertToFlatShadedMesh() in Babylon —
//     same effect, also recomputes flat normals (we don't need normals
//     here so that's fine).
//   • THREE.BufferAttribute "center" (per-vertex, but shared across each
//     triangle's 3 vertices) → mesh.setVerticesData("center", data, 3).
//     The CPU loop computing centroids carries over verbatim.
//   • Standard Three uniforms `projectionMatrix * modelViewMatrix` →
//     Babylon's `worldViewProjection`.
//   • EffectComposer + UnrealBloomPass → DefaultRenderingPipeline
//     with `bloomEnabled = true`. Match parameters: strength=1.5,
//     radius=0.8, threshold=0.85.
//   • OrbitControls + enableDamping → ArcRotateCamera + attachControl
//     + inertia 0.85.
//   • gsap.to() with repeat:-1, yoyo:true preserved 1:1 — gsap is
//     framework-agnostic, animates a JS-side uProgress that the
//     onBindObservable pushes to the GPU each frame.
//   • Inline shader template literals — no vite-plugin-glsl needed.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/loaders/glTF";
import { gsap } from "gsap";
import GUI from "lil-gui";

// ── Shaders ─────────────────────────────────────────────────────────────

// Stefan Gustavson 4D Perlin noise + 3D simplex — copied byte-for-byte
// from `../poly-ele/shaders/noise.glsl` (only `cnoise(vec4)` is used here).
const PERLIN_4D = /* glsl */ `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec4 fade(vec4 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec4 P) {
  vec4 Pi0 = floor(P);
  vec4 Pi1 = Pi0 + 1.0;
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec4 Pf0 = fract(P);
  vec4 Pf1 = Pf0 - 1.0;
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.zzzz);
  vec4 iz1 = vec4(Pi1.zzzz);
  vec4 iw0 = vec4(Pi0.wwww);
  vec4 iw1 = vec4(Pi1.wwww);

  vec4 ixy   = permute(permute(ix) + iy);
  vec4 ixy0  = permute(ixy + iz0);
  vec4 ixy1  = permute(ixy + iz1);
  vec4 ixy00 = permute(ixy0 + iw0);
  vec4 ixy01 = permute(ixy0 + iw1);
  vec4 ixy10 = permute(ixy1 + iw0);
  vec4 ixy11 = permute(ixy1 + iw1);

  vec4 gx00 = ixy00 / 7.0;
  vec4 gy00 = floor(gx00) / 7.0;
  vec4 gz00 = floor(gy00) / 6.0;
  gx00 = fract(gx00) - 0.5;
  gy00 = fract(gy00) - 0.5;
  gz00 = fract(gz00) - 0.5;
  vec4 gw00 = vec4(0.75) - abs(gx00) - abs(gy00) - abs(gz00);
  vec4 sw00 = step(gw00, vec4(0.0));
  gx00 -= sw00 * (step(0.0, gx00) - 0.5);
  gy00 -= sw00 * (step(0.0, gy00) - 0.5);

  vec4 gx01 = ixy01 / 7.0;
  vec4 gy01 = floor(gx01) / 7.0;
  vec4 gz01 = floor(gy01) / 6.0;
  gx01 = fract(gx01) - 0.5;
  gy01 = fract(gy01) - 0.5;
  gz01 = fract(gz01) - 0.5;
  vec4 gw01 = vec4(0.75) - abs(gx01) - abs(gy01) - abs(gz01);
  vec4 sw01 = step(gw01, vec4(0.0));
  gx01 -= sw01 * (step(0.0, gx01) - 0.5);
  gy01 -= sw01 * (step(0.0, gy01) - 0.5);

  vec4 gx10 = ixy10 / 7.0;
  vec4 gy10 = floor(gx10) / 7.0;
  vec4 gz10 = floor(gy10) / 6.0;
  gx10 = fract(gx10) - 0.5;
  gy10 = fract(gy10) - 0.5;
  gz10 = fract(gz10) - 0.5;
  vec4 gw10 = vec4(0.75) - abs(gx10) - abs(gy10) - abs(gz10);
  vec4 sw10 = step(gw10, vec4(0.0));
  gx10 -= sw10 * (step(0.0, gx10) - 0.5);
  gy10 -= sw10 * (step(0.0, gy10) - 0.5);

  vec4 gx11 = ixy11 / 7.0;
  vec4 gy11 = floor(gx11) / 7.0;
  vec4 gz11 = floor(gy11) / 6.0;
  gx11 = fract(gx11) - 0.5;
  gy11 = fract(gy11) - 0.5;
  gz11 = fract(gz11) - 0.5;
  vec4 gw11 = vec4(0.75) - abs(gx11) - abs(gy11) - abs(gz11);
  vec4 sw11 = step(gw11, vec4(0.0));
  gx11 -= sw11 * (step(0.0, gx11) - 0.5);
  gy11 -= sw11 * (step(0.0, gy11) - 0.5);

  vec4 g0000 = vec4(gx00.x, gy00.x, gz00.x, gw00.x);
  vec4 g1000 = vec4(gx00.y, gy00.y, gz00.y, gw00.y);
  vec4 g0100 = vec4(gx00.z, gy00.z, gz00.z, gw00.z);
  vec4 g1100 = vec4(gx00.w, gy00.w, gz00.w, gw00.w);
  vec4 g0010 = vec4(gx10.x, gy10.x, gz10.x, gw10.x);
  vec4 g1010 = vec4(gx10.y, gy10.y, gz10.y, gw10.y);
  vec4 g0110 = vec4(gx10.z, gy10.z, gz10.z, gw10.z);
  vec4 g1110 = vec4(gx10.w, gy10.w, gz10.w, gw10.w);
  vec4 g0001 = vec4(gx01.x, gy01.x, gz01.x, gw01.x);
  vec4 g1001 = vec4(gx01.y, gy01.y, gz01.y, gw01.y);
  vec4 g0101 = vec4(gx01.z, gy01.z, gz01.z, gw01.z);
  vec4 g1101 = vec4(gx01.w, gy01.w, gz01.w, gw01.w);
  vec4 g0011 = vec4(gx11.x, gy11.x, gz11.x, gw11.x);
  vec4 g1011 = vec4(gx11.y, gy11.y, gz11.y, gw11.y);
  vec4 g0111 = vec4(gx11.z, gy11.z, gz11.z, gw11.z);
  vec4 g1111 = vec4(gx11.w, gy11.w, gz11.w, gw11.w);

  vec4 norm00 = taylorInvSqrt(vec4(dot(g0000, g0000), dot(g0100, g0100), dot(g1000, g1000), dot(g1100, g1100)));
  g0000 *= norm00.x; g0100 *= norm00.y; g1000 *= norm00.z; g1100 *= norm00.w;

  vec4 norm01 = taylorInvSqrt(vec4(dot(g0001, g0001), dot(g0101, g0101), dot(g1001, g1001), dot(g1101, g1101)));
  g0001 *= norm01.x; g0101 *= norm01.y; g1001 *= norm01.z; g1101 *= norm01.w;

  vec4 norm10 = taylorInvSqrt(vec4(dot(g0010, g0010), dot(g0110, g0110), dot(g1010, g1010), dot(g1110, g1110)));
  g0010 *= norm10.x; g0110 *= norm10.y; g1010 *= norm10.z; g1110 *= norm10.w;

  vec4 norm11 = taylorInvSqrt(vec4(dot(g0011, g0011), dot(g0111, g0111), dot(g1011, g1011), dot(g1111, g1111)));
  g0011 *= norm11.x; g0111 *= norm11.y; g1011 *= norm11.z; g1111 *= norm11.w;

  float n0000 = dot(g0000, Pf0);
  float n1000 = dot(g1000, vec4(Pf1.x, Pf0.yzw));
  float n0100 = dot(g0100, vec4(Pf0.x, Pf1.y, Pf0.zw));
  float n1100 = dot(g1100, vec4(Pf1.xy, Pf0.zw));
  float n0010 = dot(g0010, vec4(Pf0.xy, Pf1.z, Pf0.w));
  float n1010 = dot(g1010, vec4(Pf1.x, Pf0.y, Pf1.z, Pf0.w));
  float n0110 = dot(g0110, vec4(Pf0.x, Pf1.yz, Pf0.w));
  float n1110 = dot(g1110, vec4(Pf1.xyz, Pf0.w));
  float n0001 = dot(g0001, vec4(Pf0.xyz, Pf1.w));
  float n1001 = dot(g1001, vec4(Pf1.x, Pf0.yz, Pf1.w));
  float n0101 = dot(g0101, vec4(Pf0.x, Pf1.y, Pf0.z, Pf1.w));
  float n1101 = dot(g1101, vec4(Pf1.xy, Pf0.z, Pf1.w));
  float n0011 = dot(g0011, vec4(Pf0.xy, Pf1.zw));
  float n1011 = dot(g1011, vec4(Pf1.x, Pf0.y, Pf1.zw));
  float n0111 = dot(g0111, vec4(Pf0.x, Pf1.yzw));
  float n1111 = dot(g1111, Pf1);

  vec4 fade_xyzw = fade(Pf0);
  vec4 n_0w  = mix(vec4(n0000, n1000, n0100, n1100), vec4(n0001, n1001, n0101, n1101), fade_xyzw.w);
  vec4 n_1w  = mix(vec4(n0010, n1010, n0110, n1110), vec4(n0011, n1011, n0111, n1111), fade_xyzw.w);
  vec4 n_zw  = mix(n_0w, n_1w, fade_xyzw.z);
  vec2 n_yzw = mix(n_zw.xy, n_zw.zw, fade_xyzw.y);
  float n_xyzw = mix(n_yzw.x, n_yzw.y, fade_xyzw.x);
  return 2.2 * n_xyzw;
}
`;

// Per-axis rotation helpers — copied from `../poly-ele/shaders/rotation.glsl`.
const ROTATION = /* glsl */ `
mat4 rotationMatrix(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
              oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
              oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
              0.0, 0.0, 0.0, 1.0);
}

vec3 rotate(vec3 v, vec3 axis, float angle) {
  mat4 m = rotationMatrix(axis, angle);
  return (m * vec4(v, 1.0)).xyz;
}
`;

// Vertex shader — copied byte-for-byte from
// `../poly-ele/shaders/vertex.glsl`. Standard uniforms collapse to
// Babylon's `worldViewProjection`.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 center;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform float uTriScale;
uniform float uProgress;
uniform float uMosaic;
uniform float uTime;

varying vec2 vUv;
varying vec2 vNormal;

${PERLIN_4D}
${ROTATION}

float PI = 3.14285714286;

float backOut(float p, float swing) {
  float pp = p - 1.0;
  return (pp * pp * ((swing + 1.0) * pp + swing) + 1.0);
}

void main() {
  vUv = uv;
  vec3 pos = (position - center) * uTriScale + center;

  float transformStart    = -(position.z * 0.5 + 0.5) * 4.0;
  float transformProgress = backOut(clamp(uProgress * 5.0 + transformStart, 0.0, 1.0), 5.0);

  vec3 posPixelated = floor(pos * uMosaic + 0.5) / uMosaic;
  pos = mix(pos, posPixelated, transformProgress);

  float noise    = cnoise(vec4(pos, uTime * 0.3));
  float rotation = noise * PI * 0.05;

  pos = rotate(pos, vec3(1.0, 0.0, 0.0), rotation);
  pos = rotate(pos, vec3(0.0, 1.0, 0.0), rotation);
  pos = rotate(pos, vec3(0.0, 0.0, 1.0), rotation);

  pos *= 1.0 + noise * 0.03;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
`;

// Fragment shader — copied byte-for-byte from
// `../poly-ele/shaders/fragment.glsl`.
const FRAG = /* glsl */ `
precision mediump float;
uniform float uRedShift;
uniform float uGreenShift;
uniform float uBlueShift;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(vUv.x * uRedShift, vUv.y * uGreenShift, uBlueShift, 1.0);
}
`;

// ── Engine + scene ──────────────────────────────────────────────────────

const canvas = document.querySelector("canvas.webgl");

const engine = new Engine(canvas, /* antialias */ true, {
  preserveDrawingBuffer: false,
  stencil: false,
});
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.clearColor = new Color4(0xe1 / 255, 0xff / 255, 0xd8 / 255, 0);  // matches setClearColor(0xe1ffd8, 0)

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0, 0, 1));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Material ────────────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "polyEleMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "center", "uv"],
    uniforms: [
      "worldViewProjection",
      "uTime", "uTriScale", "uMosaic", "uProgress",
      "uRedShift", "uGreenShift", "uBlueShift",
    ],
  },
);
material.backFaceCulling = false;        // THREE.DoubleSide

const params = {
  uTriScale:   0.5,
  uMosaic:     50.0,
  uProgress:   1.0,
  uRedShift:   1.0,
  uGreenShift: 0.8,
  uBlueShift:  1.0,
};
const startT = performance.now() / 1000;

// gsap drives uProgress 1 → 0 → 1 forever, same as the source.
gsap.to(params, {
  uProgress: 0,
  duration: 5,
  ease: "power2.inOut",
  repeat: -1,
  yoyo: true,
});

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime",      performance.now() / 1000 - startT);
  e.setFloat("uTriScale",  params.uTriScale);
  e.setFloat("uMosaic",    params.uMosaic);
  e.setFloat("uProgress",  params.uProgress);
  e.setFloat("uRedShift",  params.uRedShift);
  e.setFloat("uGreenShift", params.uGreenShift);
  e.setFloat("uBlueShift",  params.uBlueShift);
});

// ── Load model ──────────────────────────────────────────────────────────

const imported = await SceneLoader.ImportMeshAsync(null, "/", "models/ele.glb", scene);

// Source picks `gltf.scene.getObjectByName("ele")` — Babylon equivalent:
// scene.getMeshByName("ele"), or fall back to the first mesh with vertices.
let ele = scene.getMeshByName("ele")
  || imported.meshes.find((m) => m.getTotalVertices && m.getTotalVertices() > 0);
if (!ele) throw new Error("[poly-ele-babylon] ele mesh not found");

ele.scaling.set(0.8, 0.8, 0.8);

// THREE.BufferGeometry.toNonIndexed() expands an indexed mesh so each
// triangle has its own three vertices (required for the per-triangle
// `center` attribute below). Babylon's mesh.convertToFlatShadedMesh()
// does the same expansion (and recomputes flat normals — a no-op here
// since the shader doesn't use normals).
ele.convertToFlatShadedMesh();

// Recentre to origin like the source's `geometry.center()`. Babylon:
// translate by negated bounding-box centre.
ele.refreshBoundingInfo();
const bb = ele.getBoundingInfo().boundingBox;
const offset = bb.center.scale(-1);
const positions = ele.getVerticesData(VertexBuffer.PositionKind);
for (let i = 0; i < positions.length; i += 3) {
  positions[i + 0] += offset.x;
  positions[i + 1] += offset.y;
  positions[i + 2] += offset.z;
}
ele.updateVerticesData(VertexBuffer.PositionKind, positions);

// Build the per-triangle centroid attribute. Same code shape as the
// source's loop: each triangle's three vertices get the same centroid.
const vertCount = positions.length / 3;
const centers = new Float32Array(vertCount * 3);
for (let i = 0; i < vertCount; i += 3) {
  const i0 = i * 3, i1 = (i + 1) * 3, i2 = (i + 2) * 3;
  const cx = (positions[i0 + 0] + positions[i1 + 0] + positions[i2 + 0]) / 3;
  const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
  const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
  centers[i0 + 0] = cx; centers[i0 + 1] = cy; centers[i0 + 2] = cz;
  centers[i1 + 0] = cx; centers[i1 + 1] = cy; centers[i1 + 2] = cz;
  centers[i2 + 0] = cx; centers[i2 + 1] = cy; centers[i2 + 2] = cz;
}
ele.setVerticesData("center", centers, false, 3);

ele.material = material;

// ── Bloom (UnrealBloomPass equivalent) ──────────────────────────────────

const pipeline = new DefaultRenderingPipeline("bloom", true, scene, [camera]);
pipeline.bloomEnabled    = true;
pipeline.bloomThreshold  = 0.85;
pipeline.bloomWeight     = 1.5;
pipeline.bloomKernel     = 64;
pipeline.bloomScale      = 0.8;

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Hide loader once mesh is in scene ───────────────────────────────────

const loader = document.getElementById("loader");
if (loader) loader.style.display = "none";

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
gui.add(params, "uTriScale",   0, 1,  0.01).name("Triangle Scale");
gui.add(params, "uMosaic",     0, 50, 0.01).name("Mosaic");
gui.add(params, "uRedShift",   0, 1,  0.01).name("R-channel");
gui.add(params, "uGreenShift", 0, 1,  0.01).name("G-channel");
gui.add(params, "uBlueShift",  0, 1,  0.01).name("B-channel");

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());
