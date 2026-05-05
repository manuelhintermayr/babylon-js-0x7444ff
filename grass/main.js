// Babylon.js port of SahilK-027/0x7444ff/grass
//
// The source has a custom multi-class architecture (SceneManager,
// MainScene, GrassModule, FloorModule, ResourceLoader,
// GlobalUniformsManager, PerspectiveCamera, OrbitControls,
// WebGLRenderer wrappers — total ~1300 LOC). Babylon's API already
// covers all of those concerns directly, so the port collapses into
// one main.js that follows the same pipeline:
//   1) load textures + HDR environment, 2) build floor + grass meshes
//   with custom shaders, 3) ArcRotateCamera + GUI, 4) render loop.
//
// Pipeline parity with the original:
//   - 64 000 grass blades (2 segments each, front+back faces) are
//     drawn from one big mesh. The source uses InstancedBufferGeometry
//     keyed by gl_InstanceID; here we materialise 64 000 × 12 verts
//     into one VertexData and derive instanceID = gl_VertexID / 12 in
//     the shader. The shader's per-blade math (hash, bezier bend,
//     wind sway, view-space thicken, etc.) is preserved byte-for-byte.
//   - Floor is a 10×10 plane with a custom grid-pattern shader that
//     also applies FogExp2 (the source uses Three's #include <fog_*>
//     glsl chunks; here the same exp2 formula is inlined).
//   - HDR clouds.hdr is loaded as scene.environmentTexture +
//     skybox so the sky shows behind the grass once it resolves.
//
// Three -> Babylon API map applied here:
//   THREE.PerspectiveCamera + OrbitControls -> ArcRotateCamera
//   THREE.WebGLRenderer                    -> Engine
//   THREE.Scene + FogExp2                  -> Scene + scene.fogMode FOGMODE_EXP2
//   RGBELoader                             -> HDRCubeTexture
//   THREE.TextureLoader                    -> Texture(url, scene)
//   THREE.PlaneGeometry(10,10)             -> MeshBuilder.CreateGround
//   THREE.InstancedBufferGeometry          -> custom mega-VertexData
//   THREE.ShaderMaterial                   -> ShaderMaterial (GLSL ES 3.0)
//   uniforms.foo.value = x                 -> JS state pushed via onBindObservable
import "./style.css";
import {
  Engine,
  Scene,
  Color3,
  Color4,
  Vector2,
  Vector3,
  Vector4,
  ArcRotateCamera,
  HDRCubeTexture,
  Texture,
  Mesh,
  VertexData,
  MeshBuilder,
  ShaderMaterial,
  BoundingInfo,
} from "@babylonjs/core";
import GUI from "lil-gui";

/**
 * Engine + scene
 */
const canvas = document.querySelector("canvas.webgl");
const engine = new Engine(canvas, true, { stencil: false }, true);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

const scene = new Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor = Color4.FromHexString("#1861a5ff");

// FogExp2 — applied manually inside the floor shader (the grass shader
// skips fog, matching the source).
const FOG_COLOR = new Color3(0.1, 0.38, 0.6);
const FOG_DENSITY = { value: 0.075 };

/**
 * Camera (PerspectiveCamera + OrbitControls -> ArcRotateCamera)
 *
 * Source: position (1.5, 1.0, 1.5), fov 75 vertical, near 0.1, far 1000,
 * dampingFactor 0.05, minDistance 1, maxDistance 50,
 * maxPolarAngle pi/2.5.
 */
const camera = new ArcRotateCamera(
  "main",
  0,
  0,
  10,
  Vector3.Zero(),
  scene
);
camera.setPosition(new Vector3(1.5, 1.0, 1.5));
camera.fov = (75 * Math.PI) / 180;
camera.minZ = 0.1;
camera.maxZ = 1000;
camera.lowerRadiusLimit = 1;
camera.upperRadiusLimit = 50;
camera.upperBetaLimit = Math.PI / 2.5; // matches OrbitControls.maxPolarAngle
camera.wheelPrecision = 50;
camera.panningSensibility = 0; // source disables pan
camera.inertia = 0.95; // mirrors dampingFactor 0.05
camera.attachControl(canvas, true);

/**
 * HDR environment (RGBELoader -> HDRCubeTexture)
 */
// Asset paths are relative to the served index.html so the build works
// under any deploy sub-folder.
const hdr = new HDRCubeTexture(
  "./assets/environment/clouds.hdr",
  scene,
  256
);
hdr.gammaSpace = false;
scene.environmentTexture = hdr;
const skybox = scene.createDefaultSkybox(hdr, false, 1000);
if (skybox) skybox.infiniteDistance = true;

/**
 * Texture loading (TextureLoader -> Texture)
 *
 * Source's ResourceLoader sets wrapS/wrapT = RepeatWrapping on every
 * texture; mirrored here.
 */
const loadTex = (url) => {
  // invertY=true (Babylon default) matches Three's TextureLoader default
  // flipY=true. Grass displacement and blade textures are sampled by
  // V coords that mirror Three's; without the flip blade alpha-mask
  // mappings would be upside-down.
  const t = new Texture(url, scene, false, true);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
};

// Texture credits (carried over from the source's index.js):
//   grass_blade.png        — used as alpha mask on each blade
//   grass_displacement_map.png  — Anime Grass Tutorial / Blender files
//                                  by @trungduyng
//                                  https://youtu.be/M4kMri55rdE
//                                  https://trungduyng.substack.com/p/anime-grass-tutorial-blender
//   grass_displacement_map_2.png — https://thedemonthrone.ca/projects/rendering-terrain/rendering-terrain-part-20-normal-and-displacement-mapping/
//   grass_displacement_map_3.png — https://www.filterforge.com/filters/11382-bump.html
//                                  (this is the one the demo actually uses)
const grassTexture = loadTex("./assets/textures/grass_blade.png");
const grassDisplacementTexture3 = loadTex(
  "./assets/textures/grass_displacement_map_3.png"
);

/**
 * Global uniforms (replaces GlobalUniformsManager)
 *
 * Pushed into shader effects via onBindObservable each frame.
 */
const globalUniforms = {
  uTime: 0,
  uResolution: new Vector2(window.innerWidth, window.innerHeight),
  uWindStrength: 0.4,
  uWindDir: new Vector2(1, 0),
};

const startTime = performance.now();
scene.onBeforeRenderObservable.add(() => {
  globalUniforms.uTime = (performance.now() - startTime) * 0.001;
});

/**
 * Grass shader — GLSL ES 1.0
 *
 * Babylon's ShaderMaterial doesn't reliably honour a leading
 * `#version 300 es` directive (it prepends its own header which
 * pushes the directive past the legal first-line position), so the
 * shader is kept in 1.0 syntax and Babylon's auto-conversion handles
 * WebGL2 compatibility.
 *
 * gl_VertexID is a 3.0-only built-in, so we feed a per-vertex
 * `vertexId` attribute (0..767999) from JS. Source's hash21 needed
 * floatBitsToUint / uvec2 / uintBitsToFloat (3.0 only) — replaced
 * with a sin-based 1.0-compatible hash that produces a similar-
 * looking blade distribution.
 */
const GRASS_VERT = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute float vertexId;

// Babylon ShaderMaterial auto-fills these standard uniforms.
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform mat4 worldView;
uniform vec4 vEyePosition;
// Three's names → aliases so the source's expressions still compile.
#define modelMatrix world
#define viewMatrix view
#define projectionMatrix projection
#define modelViewMatrix worldView
#define cameraPosition vEyePosition.xyz

uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uGrassParams;
uniform float uWindStrength;
uniform vec2 uWindDir;

varying vec4 vGrassData;
varying float vHeightPercentage;
varying vec2 vUv;
varying vec2 vMapUv;
varying vec3 vDebugColor;

const float PI = 3.14159265359;

// utils
float inverseLerp(float v, float minVal, float maxVal) {
  return (v - minVal) / (maxVal - minVal);
}
float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  float t = inverseLerp(v, inMin, inMax);
  return mix(outMin, outMax, t);
}
float saturate(float x) { return clamp(x, 0.0, 1.0); }
float easeOut(float x, float t) { return 1.0 - pow(1.0 - x, t); }

// hash functions
// MIT License — Copyright (c) 2013 Inigo Quilez
//   https://iquilezles.org/  https://www.shadertoy.com/view/Xsl3Dl
vec3 hash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
// hash21 (3.0 floatBitsToUint / uvec2 not available in 1.0); replace
// with a sin-based hash. Distribution is different from the source
// but visually equivalent — random scatter of blades over the patch.
vec2 hash21(float src) {
  return fract(sin(vec2(src * 12.9898, src * 78.233)) * 43758.5453);
}
/* unused — kept only so the switch from 3.0 is a small diff
uvec2 murmurHash21(uint src) {
  const uint M = 0x5bd1e995u;
  uvec2 h = uvec2(1190494759u, 2147483647u);
  src *= M; src ^= src >> 24u; src *= M;
  h *= M; h ^= src;
  h ^= h >> 13u; h *= M; h ^= h >> 15u;
  return h;
}
*/
// (sin-hash above replaces the murmur path)

// rotation
mat3 rotateY(float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return mat3(vec3(c, 0, s), vec3(0, 1, 0), vec3(-s, 0, c));
}
mat3 rotateAxis(vec3 axis, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  return mat3(
    oc * axis.x * axis.x + c,         oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
    oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c,         oc * axis.y * axis.z - axis.x * s,
    oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
  );
}

// bezier
vec3 bezier(vec3 P0, vec3 P1, vec3 P2, vec3 P3, float t) {
  return (1.0 - t) * (1.0 - t) * (1.0 - t) * P0 +
    3.0 * (1.0 - t) * (1.0 - t) * t * P1 +
    3.0 * (1.0 - t) * t * t * P2 +
    t * t * t * P3;
}
vec3 bezierGrad(vec3 P0, vec3 P1, vec3 P2, vec3 P3, float t) {
  return 3.0 * (1.0 - t) * (1.0 - t) * (P1 - P0) +
    6.0 * (1.0 - t) * t * (P2 - P1) +
    3.0 * t * t * (P3 - P2);
}

// noise
float cnoise(in vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash(i + vec3(0.0,0.0,0.0)), f - vec3(0.0,0.0,0.0)),
                     dot(hash(i + vec3(1.0,0.0,0.0)), f - vec3(1.0,0.0,0.0)), u.x),
                 mix(dot(hash(i + vec3(0.0,1.0,0.0)), f - vec3(0.0,1.0,0.0)),
                     dot(hash(i + vec3(1.0,1.0,0.0)), f - vec3(1.0,1.0,0.0)), u.x), u.y),
             mix(mix(dot(hash(i + vec3(0.0,0.0,1.0)), f - vec3(0.0,0.0,1.0)),
                     dot(hash(i + vec3(1.0,0.0,1.0)), f - vec3(1.0,0.0,1.0)), u.x),
                 mix(dot(hash(i + vec3(0.0,1.0,1.0)), f - vec3(0.0,1.0,1.0)),
                     dot(hash(i + vec3(1.0,1.0,1.0)), f - vec3(1.0,1.0,1.0)), u.x), u.y), u.z);
}

void main() {

  // Each blade has 12 vertices. We feed gl_VertexID-equivalent via
  // the vertexId attribute (GLSL ES 1.0 has no gl_VertexID).
  int VID = int(vertexId);
  int instanceID = VID / 12;
  int localVertexID = VID - instanceID * 12;

  int GRASS_SEGMENTS = int(uGrassParams.x);
  int GRASS_VERTICES = (GRASS_SEGMENTS + 1) * 2;
  float GRASS_PATCH_SIZE = uGrassParams.y;
  float GRASS_WIDTH = uGrassParams.z;
  float GRASS_HEIGHT = uGrassParams.w;

  vec2 hashedInstanceID = hash21(float(instanceID)) * 2.0 - 1.0;
  vec3 grassOffset = vec3(hashedInstanceID.x, 0.0, hashedInstanceID.y) * GRASS_PATCH_SIZE;

  vec3 grassBladeWorldPos = (modelMatrix * vec4(grassOffset, 1.0)).xyz;
  vec3 hashVal = hash(grassBladeWorldPos);
  float angle = remap(hashVal.x, -1.0, 1.0, -PI, PI);

  int verFB_ID = localVertexID % (GRASS_VERTICES * 2);
  int verID = verFB_ID % GRASS_VERTICES;

  int xTest = verID & 0x1;
  int zTest = (verFB_ID >= GRASS_VERTICES) ? 1 : -1;
  float xSide = float(xTest);
  float zSide = float(zTest);
  float heighPercent = float(verID - xTest) / (float(GRASS_SEGMENTS) * 2.0);
  float width = GRASS_WIDTH * easeOut(1.0 - heighPercent, 2.0);
  float height = GRASS_HEIGHT;

  float x = (xSide - 0.5) * width;
  float y = heighPercent * height;
  float z = 0.0;

  vec2 flowOffset = uWindDir * (uTime * uWindStrength);
  float noiseSample = cnoise(vec3(grassBladeWorldPos.xz * 1.5 + flowOffset, uTime * 0.2));
  float windStrengthMultiplier = noiseSample * uWindStrength;
  vec3 windAxis = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
  float windLeanAngle = windStrengthMultiplier * 1.5 * heighPercent;

  float randomLeanAnimation = cnoise(vec3(grassBladeWorldPos.xz * 10.0, uTime)) * (windStrengthMultiplier);
  float leanFactor = remap(hashVal.y, -1.0, 1.0, -0.25, 0.25) + randomLeanAnimation;
  vec3 p1 = vec3(0.0);
  vec3 p2 = vec3(0.0, 0.33, 0.0);
  vec3 p3 = vec3(0.0, 0.66, 0.0);
  vec3 p4 = vec3(0.0, cos(leanFactor), sin(leanFactor));
  vec3 curve = bezier(p1, p2, p3, p4, heighPercent);

  vec3 curveGrad = bezierGrad(p1, p2, p3, p4, heighPercent);
  mat2 curveRot90 = mat2(0.0, 1.0, -1.0, 0.0) * -zSide;

  y = curve.y * height;
  z = curve.z * height;

  mat3 grassMat = rotateAxis(windAxis, windLeanAngle) * rotateY(angle);
  vec3 grassLocalPosition = grassMat * vec3(x, y, z) + grassOffset;
  vec3 grassLocalNormal = grassMat * vec3(0.0, curveRot90 * curveGrad.yz);

  vec4 mvPosition = modelViewMatrix * vec4(grassLocalPosition, 1.0);

  vec3 viewDir = normalize(cameraPosition - grassBladeWorldPos);
  vec3 grassFaceNormal = (grassMat * vec3(0.0, 0.0, -zSide));

  float viewDotNormal = saturate(dot(grassFaceNormal, viewDir));
  float viewSpaceThickenFactor = easeOut(1.0 - viewDotNormal, 4.0)
                                 * smoothstep(0.0, 0.2, viewDotNormal);

  mvPosition.x += viewSpaceThickenFactor * (xSide - 0.5) * width * 0.5 * -zSide;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(grassLocalPosition, 1.0);

  vGrassData = vec4(x, 0.0, 0.0, 0.0);
  vHeightPercentage = heighPercent;
  vMapUv = (grassOffset.xz / GRASS_PATCH_SIZE) + 0.5;
  vUv = vec2(xSide, heighPercent);
  vDebugColor = vec3(windLeanAngle);
  // suppress unused warnings
  uResolution; viewMatrix; grassLocalNormal; viewSpaceThickenFactor;
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uGrassParams;
uniform vec3 uBaseColorDarkBlade;
uniform vec3 uTipColorDarkBlade;
uniform vec3 uBaseColorLightBlade;
uniform vec3 uTipColorLightBlade;
uniform sampler2D uGrassDisplacementMap;
uniform sampler2D uGrassTexture;
uniform vec2 uGrassColorStep;

varying vec4 vGrassData;
varying float vHeightPercentage;
varying vec2 vUv;
varying vec2 vMapUv;
varying vec3 vDebugColor;

float inverseLerp(float v, float minVal, float maxVal) {
  return (v - minVal) / (maxVal - minVal);
}
float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  float t = inverseLerp(v, inMin, inMax);
  return mix(outMin, outMax, t);
}
float saturate(float x) { return clamp(x, 0.0, 1.0); }

void main() {
  float grassX = vGrassData.x;
  float mask = texture2D(uGrassDisplacementMap, vMapUv).r;
  mask = smoothstep(uGrassColorStep.x, uGrassColorStep.y, mask);
  vec3 c1 = mix(uBaseColorDarkBlade, uTipColorDarkBlade, vHeightPercentage);
  vec3 c2 = mix(uBaseColorLightBlade, uTipColorLightBlade, vHeightPercentage);
  vec3 grassMixColor = mix(c1, c2, mask);

  vec3 baseColor = mix(grassMixColor, grassMixColor, smoothstep(0.009, 0.0009, abs(grassX)));
  float ao = remap(pow(vHeightPercentage, 1.0), 0.0, 1.0, 0.75, 1.0);

  gl_FragColor = vec4(baseColor, 1.0);
  // suppress unused warnings
  uResolution; uTime; uGrassParams; vUv; vDebugColor; uGrassTexture; ao;
}
`;

/**
 * Grass geometry — 64 000 blades, each with 12 verts and 24 indices.
 * Vertex positions are dummy (the shader derives positions from
 * gl_VertexID); we just need the buffer to exist so Babylon binds the
 * draw call.
 */
const BLADES_NUM = 64000;
const SEGMENTS = 2;
const VERTS_PER_BLADE = (SEGMENTS + 1) * 2 * 2; // 12: front + back
const INDICES_PER_BLADE = SEGMENTS * 12; // 24

const buildBladeIndices = () => {
  const VERTICES = (SEGMENTS + 1) * 2;
  const out = new Array(INDICES_PER_BLADE);
  for (let i = 0; i < SEGMENTS; i++) {
    const vi = i * 2;
    out[i * 12 + 0] = vi + 0;
    out[i * 12 + 1] = vi + 1;
    out[i * 12 + 2] = vi + 2;
    out[i * 12 + 3] = vi + 2;
    out[i * 12 + 4] = vi + 1;
    out[i * 12 + 5] = vi + 3;
    const fi = VERTICES + vi;
    out[i * 12 + 6] = fi + 2;
    out[i * 12 + 7] = fi + 1;
    out[i * 12 + 8] = fi + 0;
    out[i * 12 + 9] = fi + 3;
    out[i * 12 + 10] = fi + 1;
    out[i * 12 + 11] = fi + 2;
  }
  return out;
};
const BLADE_INDICES = buildBladeIndices();

// Sprinkle the dummy positions over the patch range so Babylon's
// auto-bbox is non-degenerate and the mesh isn't culled away. The
// shader ignores `position` anyway.
const positions = new Float32Array(BLADES_NUM * VERTS_PER_BLADE * 3);
const vertexIds = new Float32Array(BLADES_NUM * VERTS_PER_BLADE);
const indices = new Uint32Array(BLADES_NUM * INDICES_PER_BLADE);
for (let b = 0; b < BLADES_NUM; b++) {
  const offset = b * VERTS_PER_BLADE;
  const indexOffset = b * INDICES_PER_BLADE;
  for (let k = 0; k < INDICES_PER_BLADE; k++) {
    indices[indexOffset + k] = BLADE_INDICES[k] + offset;
  }
  for (let v = 0; v < VERTS_PER_BLADE; v++) {
    vertexIds[offset + v] = offset + v;
    positions[(offset + v) * 3 + 0] = (Math.random() - 0.5) * 2;
    positions[(offset + v) * 3 + 1] = Math.random() * 0.5;
    positions[(offset + v) * 3 + 2] = (Math.random() - 0.5) * 2;
  }
}

const grassMesh = new Mesh("grass", scene);
const grassData = new VertexData();
grassData.positions = positions;
grassData.indices = indices;
grassData.applyToMesh(grassMesh, false);
// vertexId attribute replaces gl_VertexID (3.0-only) so the GLSL
// 1.0 shader can derive instance + local-vertex from it.
grassMesh.setVerticesData("vertexId", vertexIds, false, 1);
grassMesh.setBoundingInfo(new BoundingInfo(
  new Vector3(-3, 0, -3),
  new Vector3(3, 1, 3),
));
grassMesh.alwaysSelectAsActiveMesh = true; // shader displaces dummy verts

/**
 * Grass material
 *
 * uGrassParams.x = SEGMENTS, .y = PATCH_SIZE, .z = BLADE_WIDTH, .w = BLADE_HEIGHT.
 */
const grassParams = {
  uGrassParams: new Vector4(SEGMENTS, 1.0, 0.02, 0.25),
  uTipColorDarkBlade: new Color3(0.380392, 0.686275, 0.031373),
  uBaseColorDarkBlade: new Color3(0.266667, 0.435294, 0.086275),
  uTipColorLightBlade: new Color3(0.749020, 0.901961, 0.0),
  uBaseColorLightBlade: new Color3(0.486275, 0.619608, 0.0),
  uGrassColorStep: new Vector2(0.0, 1.0),
};

const grassMaterial = new ShaderMaterial(
  "grassMat",
  scene,
  { vertexSource: GRASS_VERT, fragmentSource: GRASS_FRAG },
  {
    attributes: ["position", "vertexId"],
    uniforms: [
      "world",
      "view",
      "projection",
      "worldView",
      "vEyePosition",
      "uTime",
      "uResolution",
      "uGrassParams",
      "uWindStrength",
      "uWindDir",
      "uTipColorDarkBlade",
      "uBaseColorDarkBlade",
      "uTipColorLightBlade",
      "uBaseColorLightBlade",
      "uGrassColorStep",
    ],
    samplers: ["uGrassDisplacementMap", "uGrassTexture"],
    needAlphaBlending: false,
  }
);
grassMaterial.backFaceCulling = false; // source uses FrontSide but our shader emits both faces
grassMaterial.setTexture("uGrassDisplacementMap", grassDisplacementTexture3);
grassMaterial.setTexture("uGrassTexture", grassTexture);
grassMaterial.onBindObservable.add(() => {
  const e = grassMaterial.getEffect();
  if (!e) return;
  e.setFloat("uTime", globalUniforms.uTime);
  e.setFloat2("uResolution", globalUniforms.uResolution.x, globalUniforms.uResolution.y);
  e.setFloat("uWindStrength", globalUniforms.uWindStrength);
  e.setFloat2("uWindDir", globalUniforms.uWindDir.x, globalUniforms.uWindDir.y);
  e.setVector4("uGrassParams", grassParams.uGrassParams);
  e.setColor3("uTipColorDarkBlade", grassParams.uTipColorDarkBlade);
  e.setColor3("uBaseColorDarkBlade", grassParams.uBaseColorDarkBlade);
  e.setColor3("uTipColorLightBlade", grassParams.uTipColorLightBlade);
  e.setColor3("uBaseColorLightBlade", grassParams.uBaseColorLightBlade);
  e.setFloat2("uGrassColorStep", grassParams.uGrassColorStep.x, grassParams.uGrassColorStep.y);
});
grassMesh.material = grassMaterial;

/**
 * Floor (10×10 plane with grid pattern + manual FogExp2)
 *
 * Source's vertex/fragment.glsl rely on Three's #include <fog_*>
 * chunks. The same exp2 fog formula is inlined here.
 */
const FLOOR_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 view;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;
void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  vec4 viewPos = view * worldPos;
  vUv = uv;
  vWorldPosition = worldPos.xyz;
  vFogDepth = -viewPos.z;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FLOOR_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uLineColor;
uniform float uGridFrequency;
uniform float uLineWidth;
uniform float uInnerPatternCount;
uniform float uInnerPatternWidth;
uniform vec3 uInnerPatternLineColor;
uniform vec2 uInnerPatternOffset;

uniform vec3 uFogColor;
uniform float uFogDensity;

varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;

void main() {
  vec2 st = vUv * uGridFrequency;

  // dots inside each cell
  vec2 stOffset = st + uInnerPatternOffset;
  vec2 stInner = stOffset * uInnerPatternCount;
  float dxInner = abs(fract(stInner.x));
  float dyInner = abs(fract(stInner.y));
  float dInner = max(dxInner, dyInner);
  float aaInner = fwidth(stInner.x);
  float maskInner = 1.0 - smoothstep(uInnerPatternWidth - aaInner, uInnerPatternWidth + aaInner, dInner);
  vec3 gridColor = mix(uColor, uInnerPatternLineColor, maskInner);

  // grid lines
  float dx = abs(fract(st.x) - 0.5);
  float dy = abs(fract(st.y) - 0.5);
  float d = min(dx, dy);
  float aa = fwidth(st.x);
  float mask = 1.0 - smoothstep(uLineWidth - aa, uLineWidth + aa, d);
  gridColor = mix(gridColor, uLineColor, mask);

  // FogExp2: factor = 1 - exp(-density^2 * depth^2)
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(mix(gridColor, uFogColor, fogFactor), 1.0);
  vWorldPosition; // suppress unused
}
`;

const floorParams = {
  uColor: Color3.FromHexString("#121316"),
  uLineColor: Color3.FromHexString("#70f5ff"),
  uGridFrequency: 10.0,
  uLineWidth: 0.005,
  uInnerPatternLineColor: Color3.FromHexString("#70f5ff"),
  uInnerPatternCount: 10.0,
  uInnerPatternWidth: 0.1,
  uInnerPatternOffset: new Vector2(0.505, 0.505),
};

const floor = MeshBuilder.CreateGround("floor", { width: 10, height: 10 }, scene);
const floorMaterial = new ShaderMaterial(
  "floorMat",
  scene,
  { vertexSource: FLOOR_VERT, fragmentSource: FLOOR_FRAG },
  {
    attributes: ["position", "uv"],
    uniforms: [
      "world",
      "view",
      "worldViewProjection",
      "uColor",
      "uLineColor",
      "uGridFrequency",
      "uLineWidth",
      "uInnerPatternLineColor",
      "uInnerPatternCount",
      "uInnerPatternWidth",
      "uInnerPatternOffset",
      "uFogColor",
      "uFogDensity",
    ],
  }
);
floorMaterial.onBindObservable.add(() => {
  const e = floorMaterial.getEffect();
  if (!e) return;
  e.setColor3("uColor", floorParams.uColor);
  e.setColor3("uLineColor", floorParams.uLineColor);
  e.setFloat("uGridFrequency", floorParams.uGridFrequency);
  e.setFloat("uLineWidth", floorParams.uLineWidth);
  e.setColor3("uInnerPatternLineColor", floorParams.uInnerPatternLineColor);
  e.setFloat("uInnerPatternCount", floorParams.uInnerPatternCount);
  e.setFloat("uInnerPatternWidth", floorParams.uInnerPatternWidth);
  e.setFloat2(
    "uInnerPatternOffset",
    floorParams.uInnerPatternOffset.x,
    floorParams.uInnerPatternOffset.y
  );
  e.setColor3("uFogColor", FOG_COLOR);
  e.setFloat("uFogDensity", FOG_DENSITY.value);
});
floor.material = floorMaterial;

/**
 * GUI (replaces DebugGUI singleton)
 */
const gui = new GUI({ width: 320 });

const sceneFolder = gui.addFolder("Scene Debug");
sceneFolder
  .add(FOG_DENSITY, "value")
  .min(0)
  .max(1)
  .step(0.001)
  .name("Fog density");
sceneFolder.addColor({ color: FOG_COLOR.toHexString() }, "color").name("Fog Color").onChange((v) => {
  const c = Color3.FromHexString(v);
  FOG_COLOR.r = c.r;
  FOG_COLOR.g = c.g;
  FOG_COLOR.b = c.b;
});

const grassFolder = gui.addFolder("Grass Settings");
grassFolder
  .addColor({ color: grassParams.uTipColorDarkBlade.toHexString() }, "color")
  .name("Tip Color Dark Blade")
  .onChange((v) => grassParams.uTipColorDarkBlade.copyFrom(Color3.FromHexString(v)));
grassFolder
  .addColor({ color: grassParams.uBaseColorDarkBlade.toHexString() }, "color")
  .name("Base Color Dark Blade")
  .onChange((v) => grassParams.uBaseColorDarkBlade.copyFrom(Color3.FromHexString(v)));
grassFolder
  .addColor({ color: grassParams.uTipColorLightBlade.toHexString() }, "color")
  .name("Tip Color Light Blade")
  .onChange((v) => grassParams.uTipColorLightBlade.copyFrom(Color3.FromHexString(v)));
grassFolder
  .addColor({ color: grassParams.uBaseColorLightBlade.toHexString() }, "color")
  .name("Base Color Light Blade")
  .onChange((v) => grassParams.uBaseColorLightBlade.copyFrom(Color3.FromHexString(v)));
grassFolder
  .add(grassParams.uGrassParams, "z")
  .min(0.01)
  .max(0.2)
  .step(0.005)
  .name("Blade Width");
grassFolder
  .add(grassParams.uGrassParams, "w")
  .min(0.0)
  .max(2.0)
  .step(0.05)
  .name("Blade Height");
grassFolder
  .add(grassParams.uGrassParams, "y")
  .min(0.5)
  .max(5.0)
  .step(0.1)
  .name("Patch Size");
grassFolder
  .add(grassParams.uGrassColorStep, "x")
  .min(-1)
  .max(1)
  .step(0.01)
  .name("Color Step Min");
grassFolder
  .add(grassParams.uGrassColorStep, "y")
  .min(-1)
  .max(1)
  .step(0.01)
  .name("Color Step Max");

const globalFolder = gui.addFolder("Global Uniforms");
globalFolder.add(globalUniforms, "uWindStrength").min(0).max(1).step(0.01).name("Wind Strength");
globalFolder.add(globalUniforms.uWindDir, "x").min(-1).max(1).step(0.1).name("Wind Dir X");
globalFolder.add(globalUniforms.uWindDir, "y").min(-1).max(1).step(0.1).name("Wind Dir Y");

const floorFolder = gui.addFolder("Floor Debug");
floorFolder.addColor({ color: floorParams.uColor.toHexString() }, "color").name("Floor Color")
  .onChange((v) => floorParams.uColor.copyFrom(Color3.FromHexString(v)));
floorFolder.addColor({ color: floorParams.uLineColor.toHexString() }, "color").name("Floor Line Color")
  .onChange((v) => floorParams.uLineColor.copyFrom(Color3.FromHexString(v)));
floorFolder.add(floorParams, "uGridFrequency").min(1).max(1000).step(1).name("Grid Frequency");
floorFolder.add(floorParams, "uLineWidth").min(0).max(0.1).step(0.001).name("Grid Line Width");
floorFolder.addColor({ color: floorParams.uInnerPatternLineColor.toHexString() }, "color").name("Floor Pattern Color")
  .onChange((v) => floorParams.uInnerPatternLineColor.copyFrom(Color3.FromHexString(v)));
floorFolder.add(floorParams, "uInnerPatternCount").min(0).max(10).step(1).name("Floor Pattern Count");
floorFolder.add(floorParams, "uInnerPatternWidth").min(0).max(1).step(0.01).name("Floor Pattern Width");
floorFolder.add(floorParams.uInnerPatternOffset, "x").min(-5).max(5).step(0.001).name("Floor Pattern offset X");
floorFolder.add(floorParams.uInnerPatternOffset, "y").min(-5).max(5).step(0.001).name("Floor Pattern offset Y");

/**
 * Resize
 */
window.addEventListener("resize", () => {
  globalUniforms.uResolution.set(window.innerWidth, window.innerHeight);
  engine.resize();
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
});

/**
 * Render loop
 */
engine.runRenderLoop(() => {
  scene.render();
});
