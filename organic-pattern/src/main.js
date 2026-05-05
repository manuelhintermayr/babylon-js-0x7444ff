// Babylon.js port of `../organic-pattern/src/main.js` (Three.js).
//
// 2×2 plane viewed from z=1.75 with a perspective camera, fragment
// shader does Stefan Gustavson's classic 3D Perlin noise sampled at
// (vUv * 5, uTime * 0.2) and remapped to a deep-pink-on-black gradient.
//
// Migration notes:
//   • THREE.PlaneGeometry(2, 2, 32, 32) → MeshBuilder.CreatePlane(size:2)
//     (segments don't matter — pass-through vertex shader).
//   • alpha: true on the renderer → scene.clearColor.a = 0 so the page
//     CSS background (#2b010f) shows through if the canvas underdraws.
//   • Three's `projectionMatrix * modelViewMatrix` collapses to Babylon's
//     pre-multiplied `worldViewProjection`.
//   • OrbitControls(camera, canvas) + enableDamping → ArcRotateCamera +
//     attachControl + inertia 0.85.
//   • lil-gui kept (closed by default, same as source) — no parameters
//     are bound, but the empty panel is part of the source's UX.
//   • The source's `#include "./3DPerlinNoise.glsl"` is inlined as a
//     template-literal block. No vite-plugin-glsl needed.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import GUI from "lil-gui";

// ── Shaders ─────────────────────────────────────────────────────────────

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

// 3D Perlin noise by Stefan Gustavson — copied byte-for-byte from
// `../organic-pattern/src/shaders/3DPerlinNoise.glsl`.
const PERLIN_3D = /* glsl */ `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy  = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z   = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz  = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}
`;

// Fragment shader — copied byte-for-byte from
// `../organic-pattern/src/shaders/fragment.glsl`. The `#include` directive
// is replaced by template-literal interpolation of PERLIN_3D above.
const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec2 vUv;

${PERLIN_3D}

void main() {
  float pattern = sin(0.01);
  pattern -= abs(cnoise(vec3(vUv * 5.0, uTime * 0.2)) * 0.15);

  vec3 color1 = vec3(1.0, 0.0, 0.35);
  vec3 color2 = vec3(0.01, 0.0, 0.0);

  float mixStrength = pattern * 2.0 + 0.25;
  vec3 mixColor    = mix(color2, color1, mixStrength);

  if (mixStrength > 0.24) {
    mixColor += 1.0;
  }

  gl_FragColor = vec4(pow(mixColor, vec3(1.0 / 2.2)), 1.0);
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
// alpha: true on the source's WebGLRenderer → transparent clear so the
// page's background colour (#2b010f) bleeds through any unrendered area.
scene.clearColor = new Color4(0, 0, 0, 0);

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0, 0, 1.75));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Plane mesh ──────────────────────────────────────────────────────────

const plane = MeshBuilder.CreatePlane("plane", { size: 2 }, scene);

const material = new ShaderMaterial(
  "organicMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "uv"],
    uniforms:   ["worldViewProjection", "uTime"],
  },
);
material.backFaceCulling = false;           // THREE.DoubleSide

const startT = performance.now() / 1000;
material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime", performance.now() / 1000 - startT);
});

plane.material = material;

// ── Resize ──────────────────────────────────────────────────────────────
//
// Three's renderer.setSize(innerWidth, innerHeight) writes BOTH the
// canvas's intrinsic dimensions AND its inline style, overriding the
// `canvas { width: 600px }` rule from the source CSS. Babylon's
// engine.resize() only reads CSS, so to reproduce the original
// fullscreen behaviour we mimic Three's inline-style write.
const fitCanvasToViewport = () => {
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  engine.resize();
};
fitCanvasToViewport();
window.addEventListener("resize", fitCanvasToViewport);

// ── Debug GUI (closed by default — matches the source) ──────────────────

const gui = new GUI();
gui.close();

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());
