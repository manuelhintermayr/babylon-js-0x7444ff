// Babylon.js port of `../peacock/main.js` (Three.js).
//
// 256² particles arranged on a 12×12 plane, displaced by sampling a 2D
// canvas (CanvasTexture) that's painted with a glowing brush wherever
// the user's mouse hits an invisible interactive plane.
//
// Pipeline parity with the original:
//   1. PerspectiveCamera(35°), z=18, with orbit controls (no pan, no zoom).
//   2. An invisible black plane catches mouse picks → uv → painted onto
//      a 256×256 2D canvas using `drawImage(glow.png, ...)` with
//      `globalCompositeOperation = "lighten"` and per-frame fade-out.
//   3. The painted canvas is uploaded each frame as a texture sampled
//      by the particles' vertex shader for displacement.
//   4. A second still texture (image.png, the peacock photo) controls
//      per-vertex point size + colour.
//
// Migration notes:
//   • THREE.PlaneGeometry(12, 12, 256, 256) without indices →
//     custom (256+1)² vertex grid built into a Mesh (the displacement
//     happens per-vertex, and the source explicitly disables indices
//     to stop point-mode rendering from collapsing duplicates).
//   • THREE.Points + ShaderMaterial → Mesh + ShaderMaterial with
//     `material.fillMode = Material.PointFillMode`. Same approach the
//     particles-GPGPU-babylon port takes.
//   • THREE.CanvasTexture → Babylon DynamicTexture wrapping a 2D canvas.
//     The 2D-canvas drawing code (fade-out, glow brush) is byte-for-byte
//     identical; we call `dynTexture.update()` each frame so the GPU
//     sees the latest pixels.
//   • THREE.Raycaster / intersectObject → scene.pick(x, y, predicate).
//   • OrbitControls + enableDamping + enablePan=false + enableZoom=false
//     → ArcRotateCamera + attachControl + inertia + panningSensibility=0
//     + lowerRadiusLimit==upperRadiusLimit (locks zoom).
//   • alpha:true on the renderer → scene.clearColor.a = 0 so the
//     CSS radial-gradient body background bleeds through.
//   • Scene set to right-handed so the source's (0, 0, 18) camera
//     position carries over without sign flips.
//   • alwaysSelectAsActiveMesh on the particles mesh — the mesh's
//     bounding box is the un-displaced grid, but per-vertex displacement
//     can push points well beyond it; without this Babylon would cull
//     the whole mesh on some camera angles.
//   • Inline shader template literals — no vite-plugin-glsl needed.

import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
// Side-effect import: scene.pick() needs the Ray module loaded.
import "@babylonjs/core/Culling/ray";

import imageURL from "./assets/image.png";
import glowURL  from "./assets/glow.png";

const PARTICLES_COUNT = 256;
const PLANE_SIZE      = 12;

// ── Shaders ─────────────────────────────────────────────────────────────

// Source vertex shader read modelMatrix/viewMatrix/projectionMatrix
// directly. Babylon's standard uniforms are world/view/viewProjection.
// `view` is needed alongside `viewProjection` so the gl_PointSize
// perspective compensation `1 / -viewPos.z` still works.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute float aIntensity;
attribute float aAngle;

uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;

uniform vec2      uResolution;
uniform sampler2D uPictureTexture;
uniform sampler2D uDisplacementTexture;

varying vec3 vColor;

void main() {
  vec3 newPosition = position;

  float displacementIntensity = texture2D(uDisplacementTexture, uv).r;
  displacementIntensity = smoothstep(0.1, 1.0, displacementIntensity);

  vec3 displacement = vec3(
    cos(aAngle) * 0.2,
    sin(aAngle) * 0.2,
    1.0
  );
  displacement  = normalize(displacement);
  displacement *= displacementIntensity;
  displacement *= 3.0;
  displacement *= aIntensity;

  newPosition += displacement;

  vec4 worldPos = world * vec4(newPosition, 1.0);
  vec4 viewPos  = view  * worldPos;
  gl_Position   = viewProjection * worldPos;

  float pictureIntensity = texture2D(uPictureTexture, uv).r;

  gl_PointSize  = 0.15 * pictureIntensity * uResolution.y;
  gl_PointSize *= (1.0 / max(0.001, -viewPos.z));

  vColor = vec3(pow(pictureIntensity, 2.0));
}
`;

// Fragment shader — copied byte-for-byte from
// `../peacock/shaders/particles/fragment.glsl`. The source's Three-
// specific `#include <colorspace_fragment>` (which applies the
// renderer's outputColorSpace=SRGB linear→sRGB curve at the end of
// the shader) is replaced with an inline sRGB encode so the on-screen
// brightness matches; without it the Babylon output was visibly
// dimmer than the original.
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;

vec3 linearToSrgb(vec3 c) {
  vec3 cutoff = step(c, vec3(0.0031308));
  vec3 higher = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  vec3 lower  = c * 12.92;
  return mix(higher, lower, cutoff);
}

void main() {
  vec2 uv = gl_PointCoord;
  float distanceToCenter = distance(uv, vec2(0.5));
  if (distanceToCenter > 0.5) discard;

  gl_FragColor = vec4(linearToSrgb(vColor), 1.0);
}
`;

// ── Engine + scene ──────────────────────────────────────────────────────

const canvas = document.querySelector("canvas.webgl");

const engine = new Engine(canvas, /* antialias */ true, {
  preserveDrawingBuffer: false,
  premultipliedAlpha: false,
  stencil: false,
});
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.useRightHandedSystem = true;             // matches Three's convention
scene.clearColor = new Color4(0, 0, 0, 0);     // alpha:true equivalent

// ── Camera (OrbitControls equivalent) ───────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 18, Vector3.Zero(), scene);
// Match Three's PerspectiveCamera at (0, 0, 18) — the bare ArcRotate
// constructor with alpha=0/beta=pi/2 places the camera on +X, looking
// at the plane from the side; setPosition recomputes alpha/beta to
// land on +Z instead, restoring the "front view" of the peacock.
camera.setPosition(new Vector3(0, 0, 18));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (35 * Math.PI) / 180;
camera.inertia = 0.85;
camera.panningSensibility = 0;                  // OrbitControls.enablePan = false
camera.lowerRadiusLimit = 18;                   // enableZoom = false: lock radius
camera.upperRadiusLimit = 18;
camera.attachControl(canvas, true);

// ── Interactive picking plane (invisible) ───────────────────────────────

const interactivePlane = MeshBuilder.CreatePlane(
  "interactive",
  { size: PLANE_SIZE, sideOrientation: Mesh.DOUBLESIDE },
  scene,
);
// Source's `interactivePlane.visible = false` keeps it raycastable.
// Babylon's `isVisible = false` skips it from default picks; using
// `visibility = 0` (alpha 0) keeps the pick path intact while still
// drawing nothing visible.
interactivePlane.visibility = 0;
interactivePlane.isPickable = true;

// ── Displacement DynamicTexture (CanvasTexture equivalent) ──────────────

const dyn = new DynamicTexture(
  "displacement",
  { width: PARTICLES_COUNT, height: PARTICLES_COUNT },
  scene,
  /* generateMipMaps */ false,
);
const ctx = dyn.getContext();
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, PARTICLES_COUNT, PARTICLES_COUNT);
dyn.update();

const glowImage = new Image();
glowImage.src = glowURL;

// Mouse / picking state — mirrors the source's canvasCursor /
// canvasCursorPrevious. We track the canvas-relative pointer position
// ourselves rather than relying on scene.pointerX/Y, because those
// only update when Babylon's input manager is the registered pointer
// owner (and the timing relative to render-loop is fragile).
const canvasCursor         = { x: 9999, y: 9999 };
const canvasCursorPrevious = { x: 9999, y: 9999 };
let pointerCanvasX = -1;
let pointerCanvasY = -1;
// Listen on window (rather than canvas) so Babylon's own pointer-event
// hookup via camera.attachControl can't preempt this handler.
window.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
    pointerCanvasX = x;
    pointerCanvasY = y;
  }
});

// ── Particle grid mesh ──────────────────────────────────────────────────

// Build (PARTICLES_COUNT+1)² vertex grid centred on origin, normal +Z.
// Matches THREE.PlaneGeometry(12, 12, 256, 256).setIndex(null) which
// gives a non-indexed point cloud of (N+1)² vertices.
const subX = PARTICLES_COUNT;
const subY = PARTICLES_COUNT;
const cols = subX + 1;
const rows = subY + 1;
const vertexCount = cols * rows;

const positions   = new Float32Array(vertexCount * 3);
const uvs         = new Float32Array(vertexCount * 2);
const aIntensity  = new Float32Array(vertexCount);
const aAngle      = new Float32Array(vertexCount);
const indices     = new Uint32Array(vertexCount);

const halfW = PLANE_SIZE / 2;
const halfH = PLANE_SIZE / 2;
const stepX = PLANE_SIZE / subX;
const stepY = PLANE_SIZE / subY;

for (let iy = 0; iy < rows; iy++) {
  for (let ix = 0; ix < cols; ix++) {
    const i = ix + iy * cols;
    positions[i * 3 + 0] = -halfW + ix * stepX;
    positions[i * 3 + 1] = -halfH + iy * stepY;
    positions[i * 3 + 2] = 0;
    uvs[i * 2 + 0] = ix / subX;
    uvs[i * 2 + 1] = iy / subY;
    aIntensity[i]  = Math.random();
    aAngle[i]      = Math.random() * Math.PI * 2;
    indices[i]     = i;
  }
}

const particlesMesh = new Mesh("particles", scene);
const vd = new VertexData();
vd.positions = positions;
vd.indices   = indices;
vd.uvs       = uvs;
vd.applyToMesh(particlesMesh, false);
particlesMesh.setVerticesData("aIntensity", aIntensity, false, 1);
particlesMesh.setVerticesData("aAngle",     aAngle,     false, 1);
particlesMesh.alwaysSelectAsActiveMesh = true;

// ── Textures ────────────────────────────────────────────────────────────

// invertY=true (Babylon default) matches Three's TextureLoader default
// flipY=true so UV(0,0) lands on the bottom-left pixel of the source
// image — without this the peacock pattern appears upside-down.
const pictureTexture = new Texture(imageURL, scene, true, true);

// ── Material ────────────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "peacockMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "uv", "aIntensity", "aAngle"],
    uniforms:   ["world", "view", "viewProjection", "uResolution"],
    samplers:   ["uPictureTexture", "uDisplacementTexture"],
  },
);
material.fillMode = Material.PointFillMode;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat2("uResolution", engine.getRenderWidth(), engine.getRenderHeight());
  e.setTexture("uPictureTexture",      pictureTexture);
  e.setTexture("uDisplacementTexture", dyn);
});

particlesMesh.material = material;

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => {
  if (!material.isReady(particlesMesh)) return;
  if (!pictureTexture.isReady())        return;

  // ── Cursor → canvas coords via analytical ray-plane intersect ───────
  // Replaces scene.pick on a hidden mesh — that approach was fragile in
  // Babylon 7 (visibility/material gating differences vs Three's
  // Raycaster). Build the picking ray from the cursor, intersect it
  // analytically with the z=0 plane (where the source's interactive
  // plane sits), then convert the world hit point to UV.
  if (pointerCanvasX >= 0) {
    const ray = scene.createPickingRay(pointerCanvasX, pointerCanvasY, null, camera);
    if (Math.abs(ray.direction.z) > 1e-6) {
      const t = -ray.origin.z / ray.direction.z;
      if (t > 0) {
        const wx = ray.origin.x + ray.direction.x * t;
        const wy = ray.origin.y + ray.direction.y * t;
        const half = PLANE_SIZE / 2;
        if (wx >= -half && wx <= half && wy >= -half && wy <= half) {
          const uvX = (wx + half) / PLANE_SIZE;
          const uvY = (wy + half) / PLANE_SIZE;
          canvasCursor.x = uvX * PARTICLES_COUNT;
          canvasCursor.y = (1 - uvY) * PARTICLES_COUNT;
        }
      }
    }
  }

  // ── Fade-out + glow brush onto the displacement canvas ──────────────
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.02;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, PARTICLES_COUNT, PARTICLES_COUNT);

  const dx = canvasCursor.x - canvasCursorPrevious.x;
  const dy = canvasCursor.y - canvasCursorPrevious.y;
  const cursorDistance = Math.sqrt(dx * dx + dy * dy);
  canvasCursorPrevious.x = canvasCursor.x;
  canvasCursorPrevious.y = canvasCursor.y;
  const alpha = Math.min(cursorDistance * 0.1, 1);

  if (glowImage.complete && glowImage.naturalWidth > 0) {
    const glowSize = PARTICLES_COUNT * 0.15;
    ctx.globalCompositeOperation = "lighten";
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      glowImage,
      canvasCursor.x - glowSize * 0.5,
      canvasCursor.y - glowSize * 0.5,
      glowSize,
      glowSize,
    );
  }

  dyn.update();

  scene.render();
});
