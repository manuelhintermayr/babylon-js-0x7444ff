// Babylon.js port of `../scrolling-textures/main.js` (Three.js).
//
// 1×1 plane viewed by a perspective camera with orbit. Fragment shader
// scrolls a water diffuse texture and offsets it by an animated FBM
// noise displacement map, sampled from the same UV at a different scroll.
//
// Migration notes:
//   • Standard Three uniforms (`projectionMatrix`/`modelViewMatrix`)
//     collapse to Babylon's pre-multiplied `worldViewProjection`.
//   • THREE.MirrorWrapping → Texture.MIRROR_ADDRESSMODE on both axes.
//   • Texture reuse: vite.config.js publicDir → ../scrolling-textures/public/
//     so /textures/...jpg is served from the sibling project.
//   • OrbitControls + enableDamping → ArcRotateCamera + attachControl
//     + inertia 0.85.
//   • The source's `clock.getElapsedTime() % 100` is preserved to avoid
//     float-precision drift after a long session.
//   • Inline shader template literals — no vite-plugin-glsl needed.

import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
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

// Fragment shader — copied byte-for-byte from
// `../scrolling-textures/shaders/fragment.glsl`.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAmplitude;
uniform float uScrollSpeed;
uniform sampler2D uDiffuse;

float inverseLerp(float v, float minVal, float maxVal) {
  return (v - minVal) / (maxVal - minVal);
}

float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  float t = inverseLerp(v, inMin, inMax);
  return mix(outMin, outMax, t);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  float n0 = mix(a, b, u.x);
  float n1 = mix(c, d, u.x);
  return mix(n0, n1, u.y);
}

float fbm(in vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * noise2D(p);
    p = rot * p * 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 waterTextureScroll = vec2(1.0, 1.0) * uScrollSpeed * uTime;
  vec2 waterScrolledUv = vUv + waterTextureScroll;

  vec2 dispMapScroll  = vec2(-1.0, 1.0) * uScrollSpeed * uTime;
  vec2 dispScrolledUv = vUv + dispMapScroll;

  float noise  = clamp(fbm(dispScrolledUv * 15.0 + uTime * 0.2), 0.0, 1.0);
  vec2  offset = vec2(noise - 0.5) * uAmplitude;

  vec2 finalUv = waterScrolledUv + offset;
  vec4 color   = texture2D(uDiffuse, finalUv);

  gl_FragColor = color;
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

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0, 0, 0.85));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

const plane = MeshBuilder.CreatePlane("plane", { size: 1 }, scene);

// Path is relative to the served index.html so the build works under
// any deploy sub-folder.
const diffuse = new Texture(
  "./textures/seamless_cartoon_styled_water_texture_by_berserkitty_dcatyft-375w-2x.jpg",
  scene,
);
diffuse.wrapU = Texture.MIRROR_ADDRESSMODE;     // THREE.MirrorWrapping
diffuse.wrapV = Texture.MIRROR_ADDRESSMODE;

const material = new ShaderMaterial(
  "scrollMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "uv"],
    uniforms:   ["worldViewProjection", "uTime", "uAmplitude", "uScrollSpeed"],
    samplers:   ["uDiffuse"],
  },
);
material.backFaceCulling = false;            // THREE.DoubleSide

const params = {
  uFrequency:   4.0,                          // declared in source but unused by shader
  uAmplitude:   0.1,
  uScrollSpeed: 0.2,
  uNoiseScale:  0.1,                          // declared in source but unused by shader
  uNoiseSpeed:  0.1,                          // declared in source but unused by shader
};
const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  // `% 100` carried over from the source — caps the time argument so
  // the FBM phase doesn't drift into float-precision wobble after
  // long sessions.
  e.setFloat("uTime",        (performance.now() / 1000 - startT) % 100);
  e.setFloat("uAmplitude",   params.uAmplitude);
  e.setFloat("uScrollSpeed", params.uScrollSpeed);
  e.setTexture("uDiffuse",   diffuse);
});

plane.material = material;

window.addEventListener("resize", () => engine.resize());

const gui = new GUI();
gui.add(params, "uFrequency",   0.5, 20.0, 0.01).name("Frequency");
gui.add(params, "uAmplitude",   0.0,  1.0, 0.1 ).name("Amplitude");
gui.add(params, "uScrollSpeed", 0.0,  1.0, 0.1 ).name("Speed");

engine.runRenderLoop(() => scene.render());
