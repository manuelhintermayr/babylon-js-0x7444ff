// Babylon.js port of `../wobbly-sphere/main.js` (Three.js + CSM).
//
// 80-detail icosahedron (~128 k tris) shaded with a PBR material whose
// vertex shader is augmented with a simplex-noise wobble. Source uses
// `three-custom-shader-material/vanilla` (CSM), which lets you inject
// custom GLSL into Three's built-in MeshPhysicalMaterial via tagged
// markers (csm_Position / csm_DiffuseColor).
//
// Babylon's analog: `PBRCustomMaterial` from `@babylonjs/materials/custom/`
// — extends PBRMaterial with hooks like `Vertex_Before_PositionUpdated`
// and `Fragment_Custom_Diffuse`. Same pattern, different field names.
//
// Migration notes:
//   • THREE.MeshPhysicalMaterial → PBRMaterial (Babylon's PBR equivalent).
//   • CSM `csm_Position += wobble * normal` → PBRCustomMaterial code
//     injected at `Vertex_Before_PositionUpdated`, mutating
//     `positionUpdated` (Babylon's internal name for the position vector
//     that subsequent vertex stages use).
//   • CSM `csm_DiffuseColor.rgb = mix(uColorA, uColorB, ...)` →
//     PBRCustomMaterial `Fragment_Custom_Albedo`, writing to `albedo`.
//   • THREE.IcosahedronGeometry(radius, detail) → MeshBuilder.CreateIcoSphere
//     ({ radius, subdivisions }). Same edge-subdivision semantics.
//   • mergeVertices + computeTangents on the source — Babylon's
//     CreateIcoSphere already returns shared-vertex geometry; the
//     wobble shader doesn't actually use the tangent attribute
//     (declared in source but unused), so we skip computeTangents.
//   • RGBELoader → HDRCubeTexture (loads .hdr equirectangular and
//     filters into a cube). Used as scene.environmentTexture for
//     IBL + scene background.
//   • THREE.ACESFilmicToneMapping → Babylon's `scene.imageProcessing
//     Configuration.toneMappingType = ToneMappingType.ACES`.
//   • OrbitControls + enableDamping → ArcRotateCamera + attachControl
//     + inertia 0.85.
//   • The `customDepthMaterial` that the source attaches is for shadow
//     casting; the source has no shadow casters, so the depth material
//     is a no-op. We omit it.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { PBRCustomMaterial } from "@babylonjs/materials/custom/pbrCustomMaterial";
// Side-effect import: scene.createDefaultSkybox is added by sceneHelpers,
// not on the base Scene class — needed for tree-shaken builds.
import "@babylonjs/core/Helpers/sceneHelpers";
import GUI from "lil-gui";

// ── simplexNoise4d copied from `../wobbly-sphere/shaders/includes/simplexNoise4d.glsl`
//    (Ashima Arts / Ian McEwan, public domain). Same body the
//    particles-GPGPU-babylon port uses.
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

// ── Engine + scene ──────────────────────────────────────────────────────

const canvas = document.querySelector("canvas.webgl");

const engine = new Engine(canvas, /* antialias */ true, {
  preserveDrawingBuffer: false,
  stencil: false,
});
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);            // alpha:true equivalent

// ACES tonemapping (matches THREE.ACESFilmicToneMapping at exposure 1).
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType =
  ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1;

// ── Camera ──────────────────────────────────────────────────────────────

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(-16, 4.5, 1.5));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (35 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Environment map ─────────────────────────────────────────────────────

// Path is relative to the served index.html so the build works under
// any deploy sub-folder.
const envTexture = new HDRCubeTexture("./studio_country_hall_1k.hdr", scene, /* size */ 256);
scene.environmentTexture = envTexture;
scene.environmentIntensity = 1;
// THREE: scene.background = environmentMap; → Babylon: createDefaultSkybox.
scene.createDefaultSkybox(envTexture, /* pbr */ true, /* scale */ 1000, /* blur */ 0);

// ── Mesh ────────────────────────────────────────────────────────────────

// IcosahedronGeometry(radius=2.5, detail=80) → CreateIcoSphere with the
// same edge-subdivision count.
const sphere = MeshBuilder.CreateIcoSphere("wobble", {
  radius: 2.5,
  subdivisions: 80,
  flat: false,
}, scene);

// ── Material (PBRCustomMaterial — Babylon's CSM equivalent) ─────────────

const material = new PBRCustomMaterial("wobble", scene);
material.albedoColor.set(1, 1, 1);                    // base color "#ffffff"
material.metallic = 0.1;
material.roughness = 0.9;
// Source uses transmission:0 + ior:1.5 + thickness:1.5. With transmission=0
// the ior/thickness have no visible effect, so we leave Babylon defaults
// for those; setting them produces no change.
//
// The source's `transparent: true` is just a sortability flag — it has no
// visible effect with opacity=1 and no alpha texture. In Babylon the
// equivalent (`transparencyMode = ALPHABLEND`) actively excludes the
// mesh from both opaque and alpha passes when alpha=1, leaving it
// invisible — so we leave the material at the default OPAQUE mode.

// Inject the wobble + colour-mix code via PBRCustomMaterial's named hooks.
// `positionUpdated` is Babylon's internal "current vertex position"
// variable — same role CSM's `csm_Position` plays. `albedo` is the
// fragment-stage colour Babylon multiplies by lighting.
material.AddUniform("uTime",                  "float", null);
material.AddUniform("uPositionFrequency",     "float", null);
material.AddUniform("uTimeFrequency",         "float", null);
material.AddUniform("uStrength",              "float", null);
material.AddUniform("uWarpPositionFrequency", "float", null);
material.AddUniform("uWarpTimeFrequency",     "float", null);
material.AddUniform("uWarpStrength",          "float", null);
material.AddUniform("uColorA",                "vec3",  null);
material.AddUniform("uColorB",                "vec3",  null);

material.Vertex_Definitions(`
${SIMPLEX_NOISE_4D}

float getWobble(vec3 p) {
  vec3 warpedPosition = p;
  warpedPosition += simplexNoise4d(vec4(p * uWarpPositionFrequency, uTime * uWarpTimeFrequency)) * uWarpStrength;
  return simplexNoise4d(vec4(warpedPosition * uPositionFrequency, uTime * uTimeFrequency)) * uStrength;
}

varying float vWobble;
`);

material.Vertex_Before_PositionUpdated(`
float wobble = getWobble(positionUpdated);
positionUpdated += wobble * normalUpdated;
vWobble = wobble / uStrength;
`);

material.Fragment_Definitions(`varying float vWobble;`);

material.Fragment_Custom_Albedo(`
float colorMix = smoothstep(-1.0, 1.0, vWobble);
surfaceAlbedo = mix(uColorA, uColorB, colorMix);
`);

const params = {
  uTime:                  0,
  uPositionFrequency:     1.5,
  uTimeFrequency:         0.4,
  uStrength:              1.0,
  uWarpPositionFrequency: 0.38,
  uWarpTimeFrequency:     0.12,
  uWarpStrength:          1.7,
  colorA:                 "#ff8800",
  colorB:                 "#ffefd1",
};
const colorA = parseHexRGB(params.colorA);
const colorB = parseHexRGB(params.colorB);
const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime",                  performance.now() / 1000 - startT);
  e.setFloat("uPositionFrequency",     params.uPositionFrequency);
  e.setFloat("uTimeFrequency",         params.uTimeFrequency);
  e.setFloat("uStrength",              params.uStrength);
  e.setFloat("uWarpPositionFrequency", params.uWarpPositionFrequency);
  e.setFloat("uWarpTimeFrequency",     params.uWarpTimeFrequency);
  e.setFloat("uWarpStrength",          params.uWarpStrength);
  e.setFloat3("uColorA", colorA[0], colorA[1], colorA[2]);
  e.setFloat3("uColorB", colorB[0], colorB[1], colorB[2]);
});

sphere.material = material;

// ── Light ───────────────────────────────────────────────────────────────

const light = new DirectionalLight("dirLight", new Vector3(2.5, 0.2, 1.25), scene);
light.diffuse.set(1, 0.882, 0.678);                    // "#ffe1ad"
light.intensity = 3;

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

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI({ width: 325 });
gui.close();

gui.add(params, "uPositionFrequency",     0, 2, 0.001);
gui.add(params, "uTimeFrequency",         0, 2, 0.001);
gui.add(params, "uStrength",              0, 2, 0.001);
gui.add(params, "uWarpPositionFrequency", 0, 2, 0.001);
gui.add(params, "uWarpTimeFrequency",     0, 2, 0.001);
gui.add(params, "uWarpStrength",          0, 2, 0.001);
gui.addColor(params, "colorA").onChange((v) => {
  const rgb = parseHexRGB(v);
  colorA[0] = rgb[0]; colorA[1] = rgb[1]; colorA[2] = rgb[2];
});
gui.addColor(params, "colorB").onChange((v) => {
  const rgb = parseHexRGB(v);
  colorB[0] = rgb[0]; colorB[1] = rgb[1]; colorB[2] = rgb[2];
});
gui.add(material, "metallic",  0, 1, 0.001);
gui.add(material, "roughness", 0, 1, 0.001);

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
