// Babylon.js port of `../iron-man-hologram/src/script.js` (Three.js).
//
// Loads the Iron Man GLB and replaces every mesh's material with a
// holographic ShaderMaterial: vertex shader applies time-based glitch
// jitter to xz; fragment shader does fresnel-rim + horizontal stripes
// in cyan, additively blended over the dark background.
//
// Migration notes:
//   • THREE.GLTFLoader + DRACOLoader → `import "@babylonjs/loaders/glTF"`
//     + `SceneLoader.ImportMeshAsync`. Babylon's glTF loader auto-loads
//     the DRACO decoder from a CDN URL (it ships with one configured by
//     default), so the static/draco/* files aren't strictly needed for
//     the port — but the publicDir still points at the source's static/
//     so /ironman.glb resolves identically.
//   • Three's standard uniforms (`modelMatrix`/`viewMatrix`/`projectionMatrix`/
//     `cameraPosition`) → Babylon's `world`/`view`/`viewProjection`/`vEyePosition`.
//   • THREE.AdditiveBlending → material.alphaMode = ALPHA_ADD.
//   • depthWrite: false → material.disableDepthWrite = true.
//   • side: DoubleSide → material.backFaceCulling = false.
//   • OrbitControls (no pan, polar limits, damping) → ArcRotateCamera
//     with attachControl, panningSensibility=0, lower/upperBetaLimit,
//     and inertia.
//   • The source's `gl_FrontFacing` flip is preserved by Babylon (same
//     built-in available in WebGL2).
//   • Inline shader template literals — no vite-plugin-glsl needed.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import GUI from "lil-gui";

let data = `A genius, billionaire, playboy, and philanthropist Mr. Tony Stark designed and built the iconic
          battle suit "Iron Man". The suit is powered by the arc reactor, a device that
          provides unlimited energy. It is equipped with various weapons and
          gadgets, including repulsor rays, missiles, and a jetpack. Iron Man embodies courage
          and resilience in protecting the world.`;

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
  data = `A genius, billionaire, playboy, and philanthropist Mr. Tony Stark designed and built the iconic
  battle suit "Iron Man". The suit is powered by the arc reactor, a device that
  provides unlimited energy.`;
}

let charIndex = 0;
document.addEventListener("DOMContentLoaded", () => {
  const ironman_info = document.getElementById("iron-man-text");
  const type = () => {
    if (charIndex < data.length) {
      ironman_info.innerHTML += data.charAt(charIndex);
      charIndex++;
      setTimeout(type, 100);
    }
  };
  type();
});

// ── Shaders ─────────────────────────────────────────────────────────────

// random2D inlined from `../iron-man-hologram/src/shaders/includes/random2D.glsl`.
const RANDOM_2D = /* glsl */ `
float random2D(vec2 value) {
  return fract(sin(dot(value.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
`;

// Source vertex computed `modelMatrix * vec4(position,1)` directly. In
// Babylon we use `world * vec4(position,1)` (same matrix, different
// name). Then we glitch-displace and project via `viewProjection`.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 viewProjection;
uniform float uTime;

varying vec3 vPosition;
varying vec3 vNormal;

${RANDOM_2D}

void main() {
  vec4 modelPosition = world * vec4(position, 1.0);

  // Per-row glitch wave + xz random jitter (matches source).
  float glitchTime = uTime - modelPosition.y;
  float glitchStrength = sin(glitchTime) + sin(glitchTime * 3.45) + sin(glitchTime * 8.76);
  glitchStrength /= 3.0;
  glitchStrength = smoothstep(0.3, 1.0, glitchStrength);
  glitchStrength *= 0.25;
  modelPosition.x += (random2D(modelPosition.xz + uTime) - 0.5) * glitchStrength;
  modelPosition.z += (random2D(modelPosition.zx + uTime) - 0.5) * glitchStrength;

  gl_Position = viewProjection * modelPosition;

  vec4 modelNormal = world * vec4(normal, 0.0);

  vPosition = modelPosition.xyz;
  vNormal   = modelNormal.xyz;
}
`;

// Source's `cameraPosition` Three uniform → Babylon's `vEyePosition`
// (vec4 in world space; we use .xyz). Source's tonemapping/colorspace
// includes are dropped — Three-specific; Babylon's default pipeline
// outputs in the same space.
const FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uTime;
uniform vec4  vEyePosition;

varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal *= -1.0;

  float stripes = mod((vPosition.y - uTime * 0.02) * 20.0, 1.0);
  stripes = pow(stripes, 3.0);

  vec3 viewDirection = normalize(vPosition - vEyePosition.xyz);
  float fresnel = dot(viewDirection, normal) + 1.0;
  fresnel = pow(fresnel, 2.0);

  float falloff = smoothstep(0.8, 0.2, fresnel);

  float holographic = stripes * fresnel;
  holographic += fresnel * 1.25;
  holographic *= falloff;

  gl_FragColor = vec4(uColor, holographic);
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
const params = { clearColor: "#111218", color: "#256393" };
scene.clearColor = colorFromHex(params.clearColor, 1);

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(isMobile ? new Vector3(15, 0, 20) : new Vector3(3, 3, 12));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (25 * Math.PI) / 180;
camera.lowerBetaLimit  = Math.PI / 5;
camera.upperBetaLimit  = Math.PI / 2;
camera.panningSensibility = 0;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Material ────────────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "holographic",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "normal"],
    uniforms: ["world", "viewProjection", "uTime", "uColor", "vEyePosition"],
  },
);
material.backFaceCulling = false;
material.disableDepthWrite = true;
material.alphaMode = Constants.ALPHA_ADD;        // THREE.AdditiveBlending
material.needAlphaBlending = () => true;

const startT = performance.now() / 1000;
const colorRGB = parseHexRGB(params.color);

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime",  performance.now() / 1000 - startT);
  e.setFloat3("uColor", colorRGB[0], colorRGB[1], colorRGB[2]);
});

// ── Load model ──────────────────────────────────────────────────────────

// rootUrl is relative to the served index.html so the build works under
// any deploy sub-folder.
const imported = await SceneLoader.ImportMeshAsync(null, "./", "ironman.glb", scene);
imported.meshes.forEach((m) => {
  if (m.getTotalVertices && m.getTotalVertices() > 0) {
    m.material = material;
  }
});

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
gui.close();
gui.addColor(params, "clearColor").onChange((v) => {
  scene.clearColor = colorFromHex(v, 1);
});
gui.addColor(params, "color").onChange((v) => {
  const rgb = parseHexRGB(v);
  colorRGB[0] = rgb[0]; colorRGB[1] = rgb[1]; colorRGB[2] = rgb[2];
});

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());

// ── Helpers ─────────────────────────────────────────────────────────────

function parseHexRGB(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

function colorFromHex(hex, a) {
  const rgb = parseHexRGB(hex);
  return new Color4(rgb[0], rgb[1], rgb[2], a);
}
