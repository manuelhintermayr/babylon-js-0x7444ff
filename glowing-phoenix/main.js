// Babylon.js port of `../glowing-phoenix/main.js` (Three.js).
//
// Phoenix GLB shaded with a custom mosaic + ember + fresnel + shimmer
// fragment, mouse-reactive vertex displacement, gsap timeline driving
// uTriScale + uProgress, and a 3-pass post-processing chain
// (UnrealBloom → contrast/saturation/vignette → glow) on top.
//
// The mosaic vertex setup is the same recipe as poly-ele-babylon
// (per-triangle centroid attribute via convertToFlatShadedMesh +
// custom CPU loop). The post-processing chain becomes
// DefaultRenderingPipeline (bloom) + two Babylon PostProcess
// instances chained after.

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/loaders/glTF";
import { gsap } from "gsap";
import GUI from "lil-gui";

// ── Mouse state ─────────────────────────────────────────────────────────

const mousePosition         = new Vector2(0, 0);
const previousMousePosition = new Vector2(0, 0);
const mouseVelocity         = new Vector2(0, 0);
let hoverTarget = 0;
let hoverSmoothed = 0;

window.addEventListener("mousemove", (event) => {
  previousMousePosition.copyFrom(mousePosition);
  mousePosition.x = (event.clientX / window.innerWidth)  * 2 - 1;
  mousePosition.y = -(event.clientY / window.innerHeight) * 2 + 1;
  mouseVelocity.x = mousePosition.x - previousMousePosition.x;
  mouseVelocity.y = mousePosition.y - previousMousePosition.y;
});
window.addEventListener("mousedown", () => { hoverTarget = 1; });
window.addEventListener("mouseup",   () => { hoverTarget = 0; });

// ── Shaders ─────────────────────────────────────────────────────────────

// Stefan Gustavson's classic 4D Perlin noise — only `cnoise(vec4)` is
// used by the vertex shader. Copied from `../glowing-phoenix/shaders/noise.glsl`.
// (Same body as the poly-ele port.)
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
  gx00 = fract(gx00) - 0.5; gy00 = fract(gy00) - 0.5; gz00 = fract(gz00) - 0.5;
  vec4 gw00 = vec4(0.75) - abs(gx00) - abs(gy00) - abs(gz00);
  vec4 sw00 = step(gw00, vec4(0.0));
  gx00 -= sw00 * (step(0.0, gx00) - 0.5);
  gy00 -= sw00 * (step(0.0, gy00) - 0.5);

  vec4 gx01 = ixy01 / 7.0; vec4 gy01 = floor(gx01) / 7.0; vec4 gz01 = floor(gy01) / 6.0;
  gx01 = fract(gx01) - 0.5; gy01 = fract(gy01) - 0.5; gz01 = fract(gz01) - 0.5;
  vec4 gw01 = vec4(0.75) - abs(gx01) - abs(gy01) - abs(gz01);
  vec4 sw01 = step(gw01, vec4(0.0));
  gx01 -= sw01 * (step(0.0, gx01) - 0.5); gy01 -= sw01 * (step(0.0, gy01) - 0.5);

  vec4 gx10 = ixy10 / 7.0; vec4 gy10 = floor(gx10) / 7.0; vec4 gz10 = floor(gy10) / 6.0;
  gx10 = fract(gx10) - 0.5; gy10 = fract(gy10) - 0.5; gz10 = fract(gz10) - 0.5;
  vec4 gw10 = vec4(0.75) - abs(gx10) - abs(gy10) - abs(gz10);
  vec4 sw10 = step(gw10, vec4(0.0));
  gx10 -= sw10 * (step(0.0, gx10) - 0.5); gy10 -= sw10 * (step(0.0, gy10) - 0.5);

  vec4 gx11 = ixy11 / 7.0; vec4 gy11 = floor(gx11) / 7.0; vec4 gz11 = floor(gy11) / 6.0;
  gx11 = fract(gx11) - 0.5; gy11 = fract(gy11) - 0.5; gz11 = fract(gz11) - 0.5;
  vec4 gw11 = vec4(0.75) - abs(gx11) - abs(gy11) - abs(gz11);
  vec4 sw11 = step(gw11, vec4(0.0));
  gx11 -= sw11 * (step(0.0, gx11) - 0.5); gy11 -= sw11 * (step(0.0, gy11) - 0.5);

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
  return 2.2 * mix(n_yzw.x, n_yzw.y, fade_xyzw.x);
}
`;

// Vertex shader — copied byte-for-byte from
// `../glowing-phoenix/shaders/vertex.glsl`. Three's projectionMatrix*
// modelViewMatrix collapses to Babylon's worldViewProjection.
const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 center;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform float uTriScale;
uniform float uProgress;
uniform float uMosaic;
uniform float uTime;
uniform vec2  uMousePosition;
uniform float uHover;
uniform vec2  uMouseVelocity;

varying vec2  vUv;
varying vec3  vNormal;
varying float vDisplacement;
varying vec3  vPosition;

${PERLIN_4D}

const float PI = 3.14159265359;

float backOut(float p, float swing) {
  float pp = p - 1.0;
  return (pp * pp * ((swing + 1.0) * pp + swing) + 1.0);
}

void main() {
  vUv = uv;
  vNormal = normal;
  vPosition = position;

  float scale = uTriScale + sin(uTime * 0.5) * 0.02;
  vec3 pos = (position - center) * scale + center;

  float wave = sin(pos.y * 5.0 + uTime) * 0.005;
  pos.x += wave;
  pos.z += wave;

  float noise = cnoise(vec4(pos * 2.0, uTime * 0.1)) * 0.01;
  pos += normal * noise;

  vec3  mouseDelta    = vec3(uMousePosition, 0.0) - pos;
  float mouseDistance = length(mouseDelta);
  float mouseInfluence = smoothstep(0.5, 0.0, mouseDistance) * uHover;
  pos += normalize(mouseDelta) * mouseInfluence * 0.02;

  float transformStart    = -(position.z * 0.5 + 0.5) * 4.0;
  float transformProgress = backOut(clamp(uProgress * 5.0 + transformStart, 0.0, 1.0), 5.0);

  vec3 posPixelated = floor(pos * uMosaic + 0.5) / uMosaic;
  pos += mix(pos, posPixelated, transformProgress);

  vDisplacement = noise + mouseInfluence * 2.0;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
`;

// Fragment shader — copied byte-for-byte from
// `../glowing-phoenix/shaders/fragment.glsl`. Three auto-injects
// `cameraPosition`; in Babylon's ShaderMaterial we declare and push
// it manually (the `vEyePosition` shortcut only fires inside
// PBR/Standard materials, not custom ShaderMaterial — leaving it at
// (0,0,0) makes rim lighting explode and the phoenix shows pure
// uGlowColor).
const FRAG = /* glsl */ `
precision mediump float;
varying vec2  vUv;
varying vec3  vNormal;
varying float vDisplacement;
uniform float uTime;

uniform vec3  cameraPosition;
uniform vec3  uBaseColor;
uniform vec3  uGlowColor;
uniform vec3  uAccentColor;

float fresnel(vec3 viewDirection, vec3 normal, float power) {
  return pow(1.0 - dot(viewDirection, normal), power);
}

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec3 viewDirection = normalize(cameraPosition - vNormal);

  vec3 color = mix(uBaseColor, uGlowColor, vDisplacement * 0.5);

  float ember = sin(0.5) * 0.5 + 0.5;
  color += uGlowColor * ember * 0.3;

  float rim = fresnel(viewDirection, vNormal, 3.0);
  color += rim * uGlowColor * 1.2;

  float fire = noise(vUv * 10.0 * 0.1);
  fire = smoothstep(0.4, 0.6, fire);
  color += fire * uAccentColor * 0.4;

  float shimmer = noise(vUv * 20.0 * 0.2);
  color += shimmer * uGlowColor * 0.2;

  float featherDetail = noise(vUv * 30.0);
  color = mix(color, uAccentColor, featherDetail * 0.15);

  float vignette = smoothstep(0.7, 0.3, length(vUv - 0.5));
  color *= vignette * 0.7 + 0.3;

  color = pow(color, vec3(0.4545));
  color *= 1.2;

  gl_FragColor = vec4(color, 1.0);
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
scene.clearColor = new Color4(0, 0, 0, 0);

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(1.4, 0, 3.0));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Material ────────────────────────────────────────────────────────────

const material = new ShaderMaterial(
  "phoenixMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "normal", "center", "uv"],
    uniforms: [
      "worldViewProjection", "cameraPosition",
      "uTime", "uTriScale", "uMosaic", "uProgress",
      "uMousePosition", "uMouseVelocity", "uHover",
      "uBaseColor", "uGlowColor", "uAccentColor",
    ],
  },
);

const params = {
  uTriScale: 0.7,
  uMosaic:   20.0,
  uProgress: 0.0,
  uBaseColor:    [0x85 / 255, 0x00 / 255, 0x00 / 255],
  uGlowColor:    [0xff / 255, 0xaa / 255, 0x00 / 255],
  uAccentColor:  [0xff / 255, 0x00 / 255, 0x00 / 255],
};
const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  e.setFloat("uTime",      performance.now() / 1000 - startT);
  e.setFloat("uTriScale",  params.uTriScale);
  e.setFloat("uMosaic",    params.uMosaic);
  e.setFloat("uProgress",  params.uProgress);
  e.setFloat2("uMousePosition", mousePosition.x, mousePosition.y);
  e.setFloat2("uMouseVelocity", mouseVelocity.x, mouseVelocity.y);
  e.setFloat("uHover",     hoverSmoothed);
  e.setVector3("cameraPosition", camera.position);
  e.setFloat3("uBaseColor",   params.uBaseColor[0],   params.uBaseColor[1],   params.uBaseColor[2]);
  e.setFloat3("uGlowColor",   params.uGlowColor[0],   params.uGlowColor[1],   params.uGlowColor[2]);
  e.setFloat3("uAccentColor", params.uAccentColor[0], params.uAccentColor[1], params.uAccentColor[2]);
});

// ── Load model ──────────────────────────────────────────────────────────

const imported = await SceneLoader.ImportMeshAsync(null, "/", "models/phoenix.glb", scene);
imported.meshes.forEach((m) => {
  if (!m.getTotalVertices || m.getTotalVertices() === 0) return;

  m.convertToFlatShadedMesh();
  m.refreshBoundingInfo();
  const offset = m.getBoundingInfo().boundingBox.center.scale(-1);
  const positions = m.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 0] += offset.x;
    positions[i + 1] += offset.y;
    positions[i + 2] += offset.z;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, positions);

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
  m.setVerticesData("center", centers, false, 3);

  m.position.y = -0.5;
  m.material = material;
});

// Hide loader once the import completed.
const loader = document.getElementById("loader");
if (loader) loader.style.display = "none";

// ── Post-processing chain ───────────────────────────────────────────────

// 1) UnrealBloomPass(strength=1.5, radius=1.0, threshold=0.8) →
//    DefaultRenderingPipeline with bloom enabled.
const pipeline = new DefaultRenderingPipeline("phoenixBloom", true, scene, [camera]);
pipeline.bloomEnabled   = true;
pipeline.bloomThreshold = 0.8;
pipeline.bloomWeight    = 1.5;
pipeline.bloomKernel    = 64;
pipeline.bloomScale     = 1.0;

// 2) ShaderPass (custom contrast/saturation/colour-shift/vignette).
//    Babylon: PostProcess with the same fragment shader.
//
// Kept in GLSL ES 1.0 syntax (varying, gl_FragColor, texture2D).
// Babylon's PostProcess shader-transform auto-converts these to
// 3.0 (in/glFragColor/texture) on WebGL2 — manually declaring an
// extra `out` triggers a multiple-output conflict.
const COLOR_GRADE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uTime;

vec3 adjustContrast(vec3 c, float k)   { return 0.5 + (1.0 + k) * (c - 0.5); }
vec3 adjustSaturation(vec3 c, float k) {
  float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(grey), c, 1.0 + k);
}

void main() {
  vec4 texel = texture2D(textureSampler, vUV);
  vec3 color = adjustContrast(texel.rgb, 0.2);
  color = adjustSaturation(color, 0.2);

  float shift = sin(0.2) * 0.5 + 0.5;
  color = mix(color, color.gbr, shift * 0.1);

  vec2 c = vUV - 0.5;
  float vignette = 1.0 - dot(c, c) * 0.3;
  color *= vignette;

  gl_FragColor = vec4(color, texel.a);
}
`;
// PostProcess's `fragmentUrl` argument is resolved against
// Effect.ShadersStore (key = `${url}FragmentShader`) when it can't be
// fetched — registering the inline source there is the supported way
// to ship a custom shader without an external .fx file.
Effect.ShadersStore["phoenixColorGradeFragmentShader"] = COLOR_GRADE_FRAG;
const colorGrade = new PostProcess(
  "phoenixColorGrade",
  "phoenixColorGrade",
  ["uTime"],
  null,
  1.0,
  camera,
  Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
  engine,
  false,
);
const colorGradeState = { uTime: 0 };
colorGrade.onApply = (eff) => {
  eff.setFloat("uTime", colorGradeState.uTime);
};

// 3) ShaderPass (custom glow boost). Same idea — PostProcess.
// Kept in GLSL ES 1.0 syntax (see colorGrade comment above).
const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uIntensity;
uniform float uTime;

void main() {
  vec4 texel = texture2D(textureSampler, vUV);
  vec3 glow = texel.rgb * uIntensity;

  float pulse = (sin(2.0) * 0.5 + 0.5) * 0.5;
  glow *= 1.0 + pulse;

  float colorShift = sin(0.5) * 0.5 + 0.5;
  vec3 shiftedColor = mix(glow, vec3(glow.g, glow.b, glow.r), colorShift);

  gl_FragColor = vec4(texel.rgb + shiftedColor, texel.a);
}
`;
Effect.ShadersStore["phoenixGlowFragmentShader"] = GLOW_FRAG;
const glow = new PostProcess(
  "phoenixGlow",
  "phoenixGlow",
  ["uIntensity", "uTime"],
  null,
  1.0,
  camera,
  Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
  engine,
  false,
);
const glowState = { uIntensity: 0.4, uTime: 0 };
glow.onApply = (eff) => {
  eff.setFloat("uIntensity", glowState.uIntensity);
  eff.setFloat("uTime",      glowState.uTime);
};

// ── gsap timeline ───────────────────────────────────────────────────────

gsap.timeline({ repeat: -1, yoyo: true })
  .to(params, { uTriScale: 0.2, duration: 5, ease: "power2.inOut" })
  .to(params, { uProgress:  1.0, duration: 5, ease: "power2.inOut" }, "-=4");

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => engine.resize());

// ── Debug GUI ───────────────────────────────────────────────────────────

const gui = new GUI();
const shaderFolder = gui.addFolder("Shader Material");
shaderFolder.add(params, "uMosaic", 1, 100, 0.1).name("Mosaic");

const bloomFolder = gui.addFolder("Bloom Effect");
bloomFolder.add(pipeline, "bloomThreshold", 0, 1, 0.01).name("Threshold");
bloomFolder.add(pipeline, "bloomWeight",    0, 3, 0.01).name("Strength");
bloomFolder.add(pipeline, "bloomScale",     0, 1, 0.01).name("Radius");

const customPassFolder = gui.addFolder("Custom Post-processing");
customPassFolder.add(colorGradeState, "uTime", 0, 10, 0.1).name("Time Scale");

const glowPassFolder = gui.addFolder("Glow Effect");
glowPassFolder.add(glowState, "uIntensity", 0, 10, 0.01).name("Glow Intensity");

const colorFolder = gui.addFolder("Colors");
colorFolder.addColor(params, "uBaseColor").name("Base Color");
colorFolder.addColor(params, "uGlowColor").name("Glow Color");
colorFolder.addColor(params, "uAccentColor").name("Accent Color");

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => {
  // Smooth hover (lerp) — matches THREE.MathUtils.lerp(value, target, 0.1).
  hoverSmoothed += (hoverTarget - hoverSmoothed) * 0.1;
  // Velocity decay — same factor as the source's `mouseVelocity.multiplyScalar(0.95)`.
  mouseVelocity.scaleInPlace(0.95);

  glowState.uTime = performance.now() / 1000 - startT;

  scene.render();
});
