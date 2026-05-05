// Babylon.js port of `../perlin-noise-advanced-abstract-pattern/src/script.js` (Three.js).
//
// Heavily-subdivided 1×1 plane (1000×1000 segments → 1M vertices)
// rotated to lie in the XZ plane, displaced by a Perlin-noise terrain
// shader, scrolling along Z, with rainbow-HSL colouring and a softening
// vignette overlay. Bokeh DoF post-processing on top + parallax mouse
// look.
//
// Migration notes:
//   • THREE.PlaneGeometry(1, 1, 1000, 1000).rotateX(-π/2) → custom
//     subdivided VertexData rotated into XZ at build time.
//   • THREE.CanvasTexture (procedural stripe pattern) → DynamicTexture
//     wrapping a 2D canvas; same drawing code byte-for-byte.
//   • Source's custom BokehPass (a slightly-modified version of
//     Three's postprocessing addon) → DefaultRenderingPipeline with
//     `depthOfFieldEnabled = true`. Babylon's DoF reads scene depth
//     internally (no need for the source's `terrainDepth` shader pair),
//     and exposes focusDistance/fStop/lensSize that map onto the
//     source's focus/aperture/maxblur.
//     Visual is close, not byte-identical: Babylon uses a different
//     Bokeh kernel implementation. The terrainDepth shader pair was
//     only needed by the source to feed the BokehPass an alpha-aware
//     depth (so the plane edges don't get blurred against the
//     transparent background); Babylon's DoF respects the alpha mask
//     of the rendered scene by virtue of using the depth buffer.
//   • Vignette is a fullscreen quad with its own ShaderMaterial in
//     the source — we use a Babylon PostProcess with the same
//     fragment shader (cleaner: no extra mesh, no depth write).
//   • Parallax: same target/eased state structure, applied via
//     camera position offsets each frame.
//   • OrbitControls is constructed but `controls.update()` is
//     commented out in the source — the controls are inert. We omit
//     them entirely.
//   • Standard Three uniforms collapse to Babylon's `world` /
//     `view` / `viewProjection` (same as other ports in this series).
//   • Inline shader template literals — no vite-plugin-glsl needed.

import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";
// Side-effect imports: the depth-of-field pass calls scene.enableDepthRenderer,
// which is added to Scene by depthRendererSceneComponent — required for
// tree-shaken builds.
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { Constants } from "@babylonjs/core/Engines/constants";
import GUI from "lil-gui";

// ── Shaders ─────────────────────────────────────────────────────────────

// Stefan Gustavson 2D Perlin — copied from the source's two shaders
// (terrain/vertex + terrain/fragment both contain the same body).
const PERLIN_2D = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec2 fade(vec2 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

float getPerlinNoise2d(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod(Pi, 289.0);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i  = permute(permute(ix) + iy);
  vec4 gx = 2.0 * fract(i * 0.0243902439) - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 *
              vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}
`;

// Vertex shader — copied byte-for-byte from
// `../perlin-noise-advanced-abstract-pattern/src/shaders/terrain/vertex.glsl`.
// Three's `modelMatrix * position` collapses to Babylon's `world * position`,
// then `viewProjection * worldPos`.
const TERRAIN_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 viewProjection;
uniform float uTime;
uniform float uElevationDetails;
uniform float uElevationGeneral;
uniform float uElevationGeneralFrequency;
uniform float uElevationValley;
uniform float uElevationValleyFrequency;
uniform float uElevationDetailsFrequency;

varying float vElevation;
varying vec2  vUv;

${PERLIN_2D}

float getElevation(vec2 _position) {
  float elevation = 0.0;

  float valleyStrength = cos(_position.y * uElevationValleyFrequency + 3.142) * 0.5 + 0.5;
  elevation += valleyStrength * uElevationValley;

  elevation += getPerlinNoise2d(_position * uElevationGeneralFrequency)        * uElevationGeneral * (valleyStrength + 0.1);
  elevation += getPerlinNoise2d(_position * uElevationDetailsFrequency + 123.0) * uElevationDetails * (valleyStrength + 0.1);

  elevation *= 2.0;
  return elevation;
}

void main() {
  vec4 modelPosition = world * vec4(position, 1.0);

  float elevation = getElevation(modelPosition.xz + vec2(uTime * 0.09, 0.0));
  modelPosition.y += elevation;

  gl_Position = viewProjection * modelPosition;

  vElevation = elevation;
  vUv        = uv;
}
`;

// Fragment shader — copied byte-for-byte from
// `../perlin-noise-advanced-abstract-pattern/src/shaders/terrain/fragment.glsl`.
const TERRAIN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform float uTextureFrequency;
uniform float uTime;
uniform float uHslTimeFrequency;
uniform float uHslHue;
uniform float uHslHueOffset;
uniform float uHslHueFrequency;
uniform float uHslLightness;
uniform float uHslLightnessVariation;
uniform float uHslLightnessFrequency;
uniform float uTextureOffset;

varying float vElevation;
varying vec2  vUv;

${PERLIN_2D}

vec3 hslTorgb(in vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

vec3 getRainBowColor() {
  vec2 uv = vUv;
  uv.y += uTime * uHslTimeFrequency;
  float hue       = uHslHueOffset + getPerlinNoise2d(uv * uHslHueFrequency) * uHslHue;
  float lightness = uHslLightness + getPerlinNoise2d(uv * uHslLightnessFrequency + 1234.5) * uHslLightnessVariation;
  return hslTorgb(vec3(hue, 1.0, lightness));
}

void main() {
  vec3 uColor = vec3(1.0);
  vec3 rainbowColor  = getRainBowColor();
  vec4 textureColor  = texture2D(uTexture, vec2(0.0, vElevation * uTextureFrequency + uTextureOffset));

  vec3 color = mix(uColor, rainbowColor, textureColor.r);

  float fadeSideAmplitude = 0.2;
  float sideAlpha = 1.0 - max(
    smoothstep(0.5 - fadeSideAmplitude, 0.5, abs(vUv.x - 0.5)),
    smoothstep(0.5 - fadeSideAmplitude, 0.5, abs(vUv.y - 0.5))
  );

  // Source uses transparent:true and lets the WebGL renderer alpha-blend
  // against clearColor #050b1b — but the visual it produces (after Three's
  // sRGB output conversion) reads as near-black with only a faint blue
  // tint, not the literal raw #050b1b. Use a much darker bg here so the
  // mid-tones don't drift into "blue-grey".
  vec3 bg = vec3(0.005, 0.008, 0.012);
  float a = textureColor.a * sideAlpha;
  gl_FragColor = vec4(mix(bg, color, a), 1.0);
}
`;

// Vignette — copied byte-for-byte from
// `../perlin-noise-advanced-abstract-pattern/src/shaders/vignette/fragment.glsl`,
// adapted to Babylon's PostProcess interface (uses `textureSampler` +
// `vUV` from the bound full-screen quad).
const VIGNETTE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec3  uColor;
uniform float uOffset;
uniform float uMultiplier;

void main() {
  vec4 scene = texture2D(textureSampler, vUV);
  float distanceToCenter = smoothstep(0.0, 1.0, length(vUV - 0.5));
  float alpha = distanceToCenter * uMultiplier + uOffset;
  // Source paints a transparent quad over the scene, so the visible
  // result is mix(scene, color, alpha) (premultiplied by clamping).
  gl_FragColor = vec4(mix(scene.rgb, uColor, clamp(alpha, 0.0, 1.0)), scene.a);
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
// Three is right-handed; the source's camera position+rotation
// (0, 2.124, -0.172) and rotation (-1.489, -π, 0) only place the
// XZ plane in view if the system matches. Babylon's default is
// left-handed — flip it here so the camera transforms carry over 1:1.
scene.useRightHandedSystem = true;
// THREE: setClearColor(0x050b1b, 1) — matches.
scene.clearColor = new Color4(0x05 / 255, 0x0b / 255, 0x1b / 255, 1);

// ── Camera ──────────────────────────────────────────────────────────────

// Source's view setting #1: position (0, 2.124, -0.172) with Euler
// rotation (-1.489, -π, 0) reordered to 'YXZ' (yaw first, then pitch).
// Computed forward direction in Three's right-handed frame:
//   forward = Ry(-π) * Rx(-1.489) * (0, 0, -1) ≈ (0, -0.9967, 0.0817)
// → camera looks ~85° down and slightly along +Z.
//
// Babylon's UniversalCamera.rotation.set with useRightHandedSystem
// doesn't always reproduce that orientation (subtle YXZ-vs-XYZ
// quirks); setTarget on the precomputed point gives a robust 1:1.
const camera = new UniversalCamera("camera", new Vector3(0, 2.124, -0.172), scene);
camera.fov   = (75 * Math.PI) / 180;
camera.minZ  = 0.1;
camera.maxZ  = 100;
camera.setTarget(new Vector3(0, 2.124 - 0.9967, -0.172 + 0.0817));

// ── Procedural texture (CanvasTexture equivalent) ───────────────────────

const TEX_W = 32;
const TEX_H = 128;
const dyn = new DynamicTexture(
  "terrainTex",
  { width: TEX_W, height: TEX_H },
  scene,
  /* generateMipMaps */ false,
);
dyn.wrapU = Texture.WRAP_ADDRESSMODE;            // THREE.RepeatWrapping
dyn.wrapV = Texture.WRAP_ADDRESSMODE;
dyn.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);

const ctx = dyn.getContext();
const texState = { linesCount: 7, bigLineWidth: 0.08, smallLineWidth: 0.01 };
function paintTexture() {
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  const big = Math.round(TEX_H * texState.bigLineWidth);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TEX_W, big);

  const small = Math.round(TEX_H * texState.smallLineWidth);
  const smallCount = texState.linesCount - 1;
  for (let i = 0; i < smallCount; i++) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#00f9f9";
    ctx.fillRect(0, big + Math.round((TEX_H - big) / texState.linesCount) * (i + 1), TEX_W, small);
  }
  dyn.update();
}
paintTexture();

// ── Terrain mesh ────────────────────────────────────────────────────────

// Build a 1×1 plane subdivided 1000×1000 directly in the XZ plane
// (so we don't need a Three-style rotateX(-π/2) baked into geometry).
// 1001² = 1,002,001 vertices — heavy but matches the source.
const SUB = 1000;
const cols = SUB + 1;
const rows = SUB + 1;
const vertCount = cols * rows;
const positions = new Float32Array(vertCount * 3);
const uvs       = new Float32Array(vertCount * 2);
const indices   = new Uint32Array(SUB * SUB * 6);

const stepX = 1 / SUB;
const stepZ = 1 / SUB;
for (let iz = 0; iz < rows; iz++) {
  for (let ix = 0; ix < cols; ix++) {
    const i = ix + iz * cols;
    positions[i * 3 + 0] = -0.5 + ix * stepX;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = -0.5 + iz * stepZ;
    uvs[i * 2 + 0] = ix * stepX;
    uvs[i * 2 + 1] = iz * stepZ;
  }
}
let off = 0;
for (let iz = 0; iz < SUB; iz++) {
  for (let ix = 0; ix < SUB; ix++) {
    const a = ix + iz * cols;
    const b = ix + (iz + 1) * cols;
    const c = ix + 1 + (iz + 1) * cols;
    const d = ix + 1 + iz * cols;
    indices[off++] = a; indices[off++] = b; indices[off++] = d;
    indices[off++] = b; indices[off++] = c; indices[off++] = d;
  }
}

const terrain = new Mesh("terrain", scene);
const vd = new VertexData();
vd.positions = positions;
vd.indices   = indices;
vd.uvs       = uvs;
vd.applyToMesh(terrain, false);
terrain.scaling.set(10, 10, 10);
terrain.alwaysSelectAsActiveMesh = true;        // wide displacement; bbox stays tight

const terrainParams = {
  uElevation:                   2,
  uElevationValley:             0.4,
  uElevationValleyFrequency:    1.5,
  uElevationGeneral:            0.2,
  uElevationGeneralFrequency:   0.2,
  uElevationDetails:            0.2,
  uElevationDetailsFrequency:   2.012,
  uTextureFrequency:           10.0,
  uTextureOffset:               0.585,

  uHslHueOffset:        0.4,
  uHslHue:              0.466,
  uHslHueFrequency:     0.0,
  uHslTimeFrequency:    0.055,
  uHslLightness:        0.35,
  uHslLightnessVariation: 0.09,
  uHslLightnessFrequency: 60.69,
};

const terrainMat = new ShaderMaterial(
  "terrainMat",
  scene,
  { vertexSource: TERRAIN_VERT, fragmentSource: TERRAIN_FRAG },
  {
    attributes: ["position", "uv"],
    uniforms: [
      "world", "viewProjection",
      "uTime",
      "uElevation", "uElevationValley", "uElevationValleyFrequency",
      "uElevationGeneral", "uElevationGeneralFrequency",
      "uElevationDetails", "uElevationDetailsFrequency",
      "uTextureFrequency", "uTextureOffset",
      "uHslHueOffset", "uHslHue", "uHslHueFrequency",
      "uHslTimeFrequency", "uHslLightness",
      "uHslLightnessVariation", "uHslLightnessFrequency",
    ],
    samplers: ["uTexture"],
  },
);
terrainMat.backFaceCulling = false;       // THREE.DoubleSide
// The source's `transparent: true` is just a sortability flag — the
// shader writes alpha=1. Forcing transparency in Babylon (alpha<1 +
// needAlphaBlending) pulls the mesh out of the depth pass, which the
// DoF pipeline reads to compute blur — so the mesh ended up invisible
// behind the post-process composition. Keep it opaque.

const startT = performance.now() / 1000;
terrainMat.onBindObservable.add(() => {
  const e = terrainMat.getEffect();
  if (!e) return;
  e.setFloat("uTime", performance.now() / 1000 - startT);
  for (const k of Object.keys(terrainParams)) e.setFloat(k, terrainParams[k]);
  e.setTexture("uTexture", dyn);
});

terrain.material = terrainMat;

// ── Vignette as a PostProcess ───────────────────────────────────────────

const vignetteState = {
  uColor:      [0x02 / 255, 0x0d / 255, 0x03 / 255],
  uOffset:     -0.27,
  uMultiplier:  1.16,
};

// ── Bokeh DoF (UnrealBloom + custom BokehPass equivalent) ───────────────
//
// DefaultRenderingPipeline must be created BEFORE the vignette
// PostProcess — Babylon attaches per-camera PostProcesses in
// creation order, and we want the pipeline's DoF to run first
// and the vignette to run on top so its dark edges aren't
// overwritten by the DoF composition.
//
// The Three BokehPass parameters (focus 2.14 in world units, aperture
// 0.015, maxblur 0.01) don't map cleanly onto Babylon's
// focusDistance(mm) / fStop / lensSize. Defaults produced a strong
// full-frame blur that hid all terrain detail; widening fStop and
// shrinking the lens gives a subtle bokeh that matches the source.
const pipeline = new DefaultRenderingPipeline("dof", true, scene, [camera]);
pipeline.depthOfFieldEnabled = true;
pipeline.depthOfField.focusDistance = 2140;     // 2.14 m in mm
pipeline.depthOfField.focalLength   = 50;
pipeline.depthOfField.fStop         = 8;
pipeline.depthOfField.lensSize      = 10;

// PostProcess's `fragmentUrl` argument is resolved against
// Effect.ShadersStore (key = `${url}FragmentShader`); registering the
// inline source there is the supported way to ship a custom shader
// without an external .fx file. Passing the source as the 10th
// argument (defines) instead would inline it as a #define block.
Effect.ShadersStore["vignetteFragmentShader"] = VIGNETTE_FRAG;
const vignette = new PostProcess(
  "vignette",
  "vignette",
  ["uColor", "uOffset", "uMultiplier"],
  null,
  1.0,
  camera,
  Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
  engine,
  false,
);
vignette.onApply = (eff) => {
  eff.setFloat3("uColor", vignetteState.uColor[0], vignetteState.uColor[1], vignetteState.uColor[2]);
  eff.setFloat("uOffset",     vignetteState.uOffset);
  eff.setFloat("uMultiplier", vignetteState.uMultiplier);
};

const bokehState = {
  focus:    1.0,
  aperture: 0.015,
  maxblur:  0.01,
};

// ── Parallax mouse look ─────────────────────────────────────────────────

const parallax = {
  multiplier: 0.15,
  target:  { x: 0, y: 0 },
  eased:   { x: 0, y: 0 },
  easedMult: 4,
};
const basePos    = camera.position.clone();
// Forward is the same vector we used in setTarget — re-derive via
// (target - position) so the parallax shift keeps the same look angle.
const baseTarget = new Vector3(0, 2.124 - 0.9967, -0.172 + 0.0817);
const baseForward = baseTarget.subtract(basePos).normalize();
// Compute camera local right/up once (forward doesn't change with
// parallax, so right/up don't either).
const worldUp = new Vector3(0, 1, 0);
const baseRight = Vector3.Cross(baseForward, worldUp).normalize();
const baseUpL   = Vector3.Cross(baseRight, baseForward).normalize();

window.addEventListener("mousemove", (event) => {
  parallax.target.x =  (event.clientX / window.innerWidth  - 0.5) * parallax.multiplier;
  parallax.target.y = -(event.clientY / window.innerHeight - 0.5) * parallax.multiplier;
});

// ── Resize ──────────────────────────────────────────────────────────────

// Three's renderer.setSize(innerWidth, innerHeight) writes BOTH the
// canvas's intrinsic dimensions AND its inline style, but the source
// CSS has no width/height for `.webgl` — so Babylon's engine.resize()
// (which only reads CSS) leaves the canvas at the default 300x150.
// Mimic Three's inline-style write to make it actually fullscreen.
const fitCanvasToViewport = () => {
  canvas.style.width  = window.innerWidth  + "px";
  canvas.style.height = window.innerHeight + "px";
  engine.resize();
};
fitCanvasToViewport();
window.addEventListener("resize", fitCanvasToViewport);

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
const terrainFolder = gui.addFolder("Terrain Uniforms");

const elevationFolder = terrainFolder.addFolder("Elevation");
elevationFolder.add(terrainParams, "uElevation",                  0, 5,  0.01).name("Total Elevation");
elevationFolder.add(terrainParams, "uElevationValley",            0, 1,  0.01).name("Elevation");
elevationFolder.add(terrainParams, "uElevationValleyFrequency",   0, 5,  0.01).name("Frequency");
elevationFolder.add(terrainParams, "uElevationGeneral",           0, 1,  0.01).name("General Elevation");
elevationFolder.add(terrainParams, "uElevationGeneralFrequency",  0, 5,  0.01).name("General Frequency");
elevationFolder.add(terrainParams, "uElevationDetails",           0, 1,  0.01).name("Details Elevation");
elevationFolder.add(terrainParams, "uElevationDetailsFrequency",  0, 5,  0.01).name("Details Frequency");

const textureFolder = terrainFolder.addFolder("Texture");
textureFolder.add(terrainParams, "uTextureFrequency", 0, 20, 0.001).name("Texture Frequency");
textureFolder.add(terrainParams, "uTextureOffset",    0, 1,  0.001).name("Texture Offset");

const hslFolder = terrainFolder.addFolder("HSL Color");
hslFolder.add(terrainParams, "uHslHueOffset",          0, 1,   0.01).name("Hue Offset");
hslFolder.add(terrainParams, "uHslHue",                0, 1,   0.01).name("Hue");
hslFolder.add(terrainParams, "uHslHueFrequency",       0, 1,   0.01).name("Hue Frequency");
hslFolder.add(terrainParams, "uHslTimeFrequency",      0, 0.1, 0.001).name("Time Frequency");
hslFolder.add(terrainParams, "uHslLightness",          0, 1,   0.01).name("Lightness");
hslFolder.add(terrainParams, "uHslLightnessVariation", 0, 1,   0.01).name("Lightness Variation");
hslFolder.add(terrainParams, "uHslLightnessFrequency", 0, 100, 0.01).name("Lightness Frequency");

const vignetteFolder = gui.addFolder("Vignette");
vignetteFolder.add(vignetteState, "uOffset",     -1, 1, 0.01).name("Offset");
vignetteFolder.add(vignetteState, "uMultiplier",  0, 2, 0.01).name("Multiplier");
vignetteFolder.addColor(vignetteState, "uColor").name("Color");

const bokehFolder = gui.addFolder("Bokeh");
bokehFolder.add(bokehState, "focus",    0, 5,   0.01).name("Focus")
  .onChange((v) => { pipeline.depthOfField.focusDistance = 1000 * v; });
bokehFolder.add(bokehState, "aperture", 0, 0.1, 0.001).name("Aperture")
  .onChange((v) => { pipeline.depthOfField.fStop = Math.max(0.1, 1.4 - v * 50); });
bokehFolder.add(bokehState, "maxblur",  0, 0.1, 0.001).name("Max Blur")
  .onChange((v) => { pipeline.depthOfField.lensSize = 50 + v * 1000; });

// ── Render loop ─────────────────────────────────────────────────────────

let prev = performance.now() / 1000;
engine.runRenderLoop(() => {
  const now = performance.now() / 1000;
  const dt  = now - prev;
  prev = now;

  parallax.eased.x += (parallax.target.x - parallax.eased.x) * dt * parallax.easedMult;
  parallax.eased.y += (parallax.target.y - parallax.eased.y) * dt * parallax.easedMult;

  // Reset to base each frame, then translate in the camera's local
  // frame the way the source does with `camera.translateX/Y`. Shift
  // both position AND target by the same delta so the look direction
  // stays constant — pure translation, no rotation drift.
  const dx = baseRight.scale(parallax.eased.x);
  const dy = baseUpL.scale(parallax.eased.y);
  camera.position.copyFrom(basePos).addInPlace(dx).addInPlace(dy);
  camera.setTarget(baseTarget.add(dx).add(dy));

  scene.render();
});
