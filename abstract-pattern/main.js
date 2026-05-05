// Babylon.js port of `../abstract-pattern/main.js` (Three.js).
//
// Pipeline parity with the original:
//   1. A 1×1 plane mesh in the scene, viewed by a perspective camera at z=0.85.
//   2. ShaderMaterial driving the plane's surface — Perlin-noise pattern
//      modulated by uTime, with uFrequency / uAmplitude exposed in lil-gui.
//   3. OrbitControls equivalent so you can drag the plane around.
//
// What changes from the Three.js source:
//   • THREE.PlaneGeometry(1, 1, 32, 32) → MeshBuilder.CreatePlane (segments
//     don't matter — the vertex shader doesn't deform).
//   • THREE.ShaderMaterial → Babylon ShaderMaterial; standard Three uniform
//     `projectionMatrix * modelViewMatrix` becomes Babylon's `worldViewProjection`.
//   • OrbitControls(camera, canvas) → ArcRotateCamera with attachControl
//     and inertia (the damping equivalent).
//   • side: DoubleSide → material.backFaceCulling = false.
//   • Three's `uniforms.uFoo.value = x` becomes a JS state object pushed
//     to the effect via material.onBindObservable on every frame.
//   • Inline shader template literals — no vite-plugin-glsl needed.

import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import GUI from "lil-gui";

// ── Shaders ─────────────────────────────────────────────────────────────

// Vertex shader — direct equivalent of the Three.js source. The only
// substitution is the standard matrix uniform name: Babylon exposes the
// pre-multiplied `worldViewProjection` instead of `projectionMatrix *
// modelViewMatrix`. Babylon's `position` (vec3) and `uv` (vec2) attributes
// are bound automatically when listed in the ShaderMaterial options.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUv = uv;
}
`;

// Fragment shader — copied byte-for-byte from
// `../abstract-pattern/shaders/fragment.glsl`. No changes needed: it uses
// only its own `varying vUv` + custom uniforms (no Three-specific includes).
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uFrequency;
uniform float uAmplitude;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Classic Perlin 2D Noise by Stefan Gustavson.
vec2 fade(vec2 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
vec4 permute(vec4 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod(Pi, 289.0);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = 2.0 * fract(i * 0.0243902439) - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 *
              vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  float n_xy = mix(n_x.x, n_x.y, fade_xy.y);
  return 2.3 * n_xy;
}

void main() {
  vec3 blackColor = vec3(0.0);
  vec3 uvColor    = vec3(vUv, 1.0);

  float timeVariation = sin(uTime * 0.2);
  float strength = smoothstep(
    0.5, 1.0,
    sin(cnoise(vUv * uFrequency + timeVariation) * uAmplitude)
  );

  vec3 mixedColor = mix(blackColor, uvColor, strength);
  gl_FragColor = vec4(mixedColor, 1.0);
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
scene.clearColor = new Color4(0, 0, 0, 1);

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

// `setPosition` recomputes alpha/beta/radius from the world-space target
// so the demo's literal (0, 0, 0.85) carries over without spherical maths.
const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0, 0, 0.85));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;        // matches PerspectiveCamera(75, …)
camera.inertia = 0.85;                      // OrbitControls.enableDamping
camera.attachControl(canvas, true);

// ── Mesh ────────────────────────────────────────────────────────────────

// 1×1 plane — segments (32×32 in source) don't matter since the vertex
// shader is pass-through. CreatePlane defaults to a single quad which is
// indistinguishable in this context.
const plane = MeshBuilder.CreatePlane("plane", { size: 1 }, scene);

// ── Shader material ─────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "abstractMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "uv"],
    uniforms:   ["worldViewProjection", "uTime", "uFrequency", "uAmplitude"],
  },
);
material.backFaceCulling = false;           // THREE.DoubleSide

// Uniform state — Babylon ShaderMaterial doesn't expose a `uniforms.foo.value`
// proxy like Three's ShaderMaterial. We keep the values here and push them
// to the GPU on each bind.
const params = {
  frequency: 4.0,
  amplitude: 50.0,
};
const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime",      performance.now() / 1000 - startT);
  e.setFloat("uFrequency", params.frequency);
  e.setFloat("uAmplitude", params.amplitude);
});

plane.material = material;

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
gui.add(params, "frequency", 0.5, 20.0, 0.01).name("Frequency");
gui.add(params, "amplitude", 0.0, 100.0, 0.1).name("Amplitude");

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());
