// Babylon.js port of `../black-pearl-flag/main.js` (Three.js).
//
// 1×1 plane (scaled y * 2/3) with a vertex-displaced "flag-waving"
// shader sampling pearl.png, viewed from a perspective camera with
// orbit controls. lil-gui exposes the X/Y wave frequencies.
//
// Migration notes:
//   • THREE.RawShaderMaterial → Babylon ShaderMaterial. The source's
//     vertex shader manually declared modelMatrix/viewMatrix/projection-
//     Matrix; we replace those with Babylon's standard `world`/`view`/
//     `viewProjection` uniforms.
//   • alpha: true on the renderer → scene.clearColor.a = 0 (so the
//     page background "#e4e4e4" shows through where the canvas underdraws).
//   • mesh.scale.y = 2/3 → mesh.scaling.y = 2/3.
//   • OrbitControls + enableDamping → ArcRotateCamera + attachControl
//     + inertia 0.85.
//   • Texture reuse: vite.config.js sets publicDir to the sibling Three.js
//     project's public/, so `/textures/pearl.png` resolves without
//     duplicating the asset.
//   • Inline shader template literals — no vite-plugin-glsl needed.

import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import GUI from "lil-gui";

// ── Shaders ─────────────────────────────────────────────────────────────

// Source vertex shader hand-declared modelMatrix / viewMatrix / projection-
// Matrix uniforms (Three's RawShaderMaterial convention). Babylon's
// ShaderMaterial provides `world` / `view` / `viewProjection` instead;
// the wave-displacement maths is identical.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;

uniform vec2 uFrequency;
uniform float uTime;

varying vec2 vUv;

void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  worldPos.z += sin(worldPos.x * uFrequency.x - uTime) * 0.08;
  worldPos.z += sin(worldPos.y * uFrequency.y - uTime) * 0.05;

  gl_Position = viewProjection * worldPos;
  vUv = uv;
}
`;

// Fragment shader — copied byte-for-byte from
// `../black-pearl-flag/shaders/fragment.glsl`. Source declares an
// unused uniform `uColor` — preserved for parity (declared but unread).
const FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform sampler2D uTexture;
varying vec2 vUv;

void main() {
  vec4 textureColor = texture2D(uTexture, vUv);
  gl_FragColor = textureColor;
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
scene.clearColor = new Color4(0, 0, 0, 0);   // alpha:true equivalent

// ── Camera ──────────────────────────────────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0.25, -0.25, 1));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Mesh ────────────────────────────────────────────────────────────────

// THREE.PlaneGeometry(1, 1, 32, 32) builds a centred 32×32-subdivision
// plane in the XY plane with normal +Z. Babylon's MeshBuilder.CreatePlane
// returns a single quad with no way to request subdivisions, so we build
// the vertex grid manually — the displacement happens per-vertex, so
// segmentation matters for a smooth wave.
const plane = new Mesh("plane", scene);
buildSubdividedPlane(1, 1, 32, 32).applyToMesh(plane, /* updatable */ false);
plane.scaling.y = 2 / 3;

function buildSubdividedPlane(width, height, subX, subY) {
  // Build a (subX+1)×(subY+1) grid of vertices in the XY plane,
  // matching THREE.PlaneGeometry(width, height, subX, subY) exactly:
  // origin centred, +X right, +Y up, normal +Z.
  const positions = [];
  const uvs       = [];
  const indices   = [];
  const halfW = width / 2, halfH = height / 2;
  const stepX = width / subX, stepY = height / subY;

  for (let iy = 0; iy <= subY; iy++) {
    const y = -halfH + iy * stepY;
    for (let ix = 0; ix <= subX; ix++) {
      const x = -halfW + ix * stepX;
      positions.push(x, y, 0);
      uvs.push(ix / subX, iy / subY);
    }
  }
  const cols = subX + 1;
  for (let iy = 0; iy < subY; iy++) {
    for (let ix = 0; ix < subX; ix++) {
      const a = ix + iy * cols;
      const b = ix + (iy + 1) * cols;
      const c = ix + 1 + (iy + 1) * cols;
      const d = ix + 1 + iy * cols;
      indices.push(a, b, d, b, c, d);
    }
  }

  const v = new VertexData();
  v.positions = positions;
  v.uvs       = uvs;
  v.indices   = indices;
  return v;
}

// ── Texture ─────────────────────────────────────────────────────────────

// Path is relative to the served index.html (not the host root) so the
// build works under any deploy sub-folder, e.g.
// /babylon-js-0x7444ff/black-pearl-flag/.
const flagTexture = new Texture("./textures/pearl.png", scene);

// ── Material ────────────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "flagMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "uv"],
    uniforms:   ["world", "view", "viewProjection", "uTime", "uFrequency", "uColor"],
    samplers:   ["uTexture"],
  },
);
material.backFaceCulling = false;            // THREE.DoubleSide

const params = {
  uFrequency: [10, 5],
};
const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime", performance.now() / 1000 - startT);
  e.setFloat2("uFrequency", params.uFrequency[0], params.uFrequency[1]);
  e.setFloat3("uColor", 0, 0, 0);              // unused but declared in source
  e.setTexture("uTexture", flagTexture);
});

plane.material = material;

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
gui.add(params.uFrequency, "0", 0, 20, 0.01).name("frequencyX");
gui.add(params.uFrequency, "1", 0, 20, 0.01).name("frequencyY");

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());
