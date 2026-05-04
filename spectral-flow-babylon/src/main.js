// Babylon.js port of `../spectral-flow/src/main.js` (Three.js).
//
// Same caustic-Voronoi shader family as voronoi-electric-pattern, but on
// a 3.5×3.5 plane (not a cube), with a 6-colour organic palette layered
// in via cosine palettes (Inigo Quilez-style). 80+ GUI uniforms across
// 16 folders; uTime is wrapped at 2000s with a +85s offset to land in
// the source's "interesting" portion of the noise field on first frame.
//
// Migration notes (all the same playbook as voronoi-electric-pattern-babylon):
//   • THREE.PlaneGeometry(3.5, 3.5, 64, 64) → MeshBuilder.CreatePlane(size:3.5)
//     (segments don't matter — vertex shader is pass-through).
//   • Vertex: projectionMatrix*modelViewMatrix → worldViewProjection;
//     normalMatrix*normal substituted with `world * vec4(normal, 0)`
//     (no non-uniform scaling on the plane). vNormal/vWorldPos declared
//     for parity even though the fragment uses only vUv.
//   • All 90+ uniforms mirrored into a single JS state object so lil-gui
//     binds directly and onBindObservable pushes them in a tight loop.
//   • Float / vec2 / vec3 uniforms split into three lists for the bind
//     loop; matches the source's THREE.Vector2 / Vector3 / Color usage.
//   • alpha:true → scene.clearColor.a = 0.
//   • OrbitControls + enableDamping → ArcRotateCamera + attachControl
//     + inertia 0.85.
//   • side: DoubleSide → backFaceCulling = false.
//   • uTime = (elapsed + 85) % 2000 — same offset/wrap the source uses
//     to (a) start at a visually-active phase and (b) avoid float drift
//     after long sessions.
//   • Inline shader template literals — no vite-plugin-glsl needed.

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
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vec4 worldPos = world * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Fragment shader — copied byte-for-byte from
// `../spectral-flow/src/shaders/fragment.glsl`.
const FRAG = /* glsl */ `
precision mediump float;
uniform float uTime;
varying vec2 vUv;
varying vec3 vNormal;

#define TAU 2.0 * 3.142857

uniform vec2  uHashFract;
uniform float uHashDot;
uniform vec3  uRandFract;
uniform float uRandDot;
uniform float uNoiseSmoothness;
uniform float uFbmAmp;
uniform float uFbmFreq;
uniform float uFbmFreqMult;
uniform float uFbmAmpMult;

uniform float uVoronoiJitter;
uniform float uVoronoiAnimBase;
uniform float uVoronoiSinSpeed1;
uniform float uVoronoiSinSpeed2;
uniform float uVoronoiSinAmp1;
uniform float uVoronoiSinSpeed3;
uniform float uVoronoiSinSpeed4;
uniform float uVoronoiSinAmp2;
uniform float uVoronoiFbmScale1;
uniform float uVoronoiFbmSpeed1;
uniform float uVoronoiFbmScale2;
uniform float uVoronoiFbmSpeed2;
uniform float uVoronoiFbmDispl;

uniform float uSwirlSmoothStart;
uniform float uSwirlSmoothEnd;
uniform float uSwirlSpeedMult;
uniform float uSwirlNoiseAmp2;
uniform float uSwirlNoiseScale2;
uniform float uSwirlNoiseScale3;
uniform float uSwirlNoiseSpeed1;
uniform float uSwirlNoiseSpeed2;
uniform float uSwirlNoiseSpeed3;
uniform float uSwirlNoiseSpeed4;
uniform float uSwirlRadialFlow;

uniform float uCellCount2;
uniform float uCellCount3;

uniform float uLayer2Speed;
uniform float uLayer2Twist;
uniform float uLayer2NoiseScale;
uniform float uLayer2NoiseAmp;
uniform float uLayer2TimeSpeed;
uniform float uLayer2Seed;

uniform float uLayer3Speed;
uniform float uLayer3Twist;
uniform float uLayer3NoiseScale;
uniform float uLayer3NoiseAmp;
uniform float uLayer3TimeSpeed;
uniform float uLayer3Seed;

uniform float uEdgeNoiseScale;
uniform float uEdgeNoiseSpeed;
uniform float uEdgeWidthMin;
uniform float uEdgeWidthMax;
uniform float uBaseWidth;

uniform float uSecondaryEdgeWidth;
uniform float uSecondaryEdgePow;
uniform float uSecondaryEdgeStrength;

uniform float uTertiaryEdgeWidth;
uniform float uTertiaryEdgePow;
uniform float uTertiaryEdgeStrength;

uniform float uGlow2Start;
uniform float uGlow2End;
uniform float uGlow2Pow;
uniform float uGlow2Strength;

uniform float uGlow3Start;
uniform float uGlow3End;
uniform float uGlow3Pow;
uniform float uGlow3Strength;

uniform float uJunctionWidth;
uniform float uJunctionPow;
uniform float uJunctionStrength;

uniform float uColorNoise2Scale;
uniform float uColorNoise2Speed;
uniform float uColorNoise3Scale;
uniform float uColorNoise3Speed;
uniform float uEdgeBrightnessMin;
uniform float uEdgeBrightnessMax;

uniform float uCellLight2Mult;
uniform float uCellLight2Strength;
uniform float uCellLight3Mult;
uniform float uCellLight3Strength;

uniform float uBgNoiseScale;
uniform float uBgNoiseSpeed;
uniform float uBgDetailScale;
uniform float uBgDetailSpeed;
uniform float uBgValueMin;
uniform float uBgValueMax;
uniform float uBgNoiseStrength;
uniform float uBgDetailStrength;
uniform vec3  uBgColor;

uniform float uSecondaryWeight;
uniform float uTertiaryWeight;
uniform float uGlow2Weight;
uniform float uGlow3Weight;
uniform float uJunctionWeight;

uniform vec3  uColorShift;
uniform float uColorMultiplier;
uniform float uColorGamma;

uniform float uFresnelPow;
uniform float uFresnelStrength;

uniform vec3 uWarmColor1;
uniform vec3 uWarmColor2;
uniform vec3 uWarmColor3;
uniform vec3 uCoolColor1;
uniform vec3 uCoolColor2;
uniform vec3 uCoolColor3;

uniform float uColorZone1Influence;
uniform float uColorZone2Influence;
uniform float uCellColorInfluence;

float hash(vec2 p) {
  p = fract(p * uHashFract);
  p += dot(p, p + uHashDot);
  return fract(p.x * p.y);
}

vec2 rand01(vec2 p) {
  vec3 a = fract(p.xyx * uRandFract);
  a += dot(a, a + uRandDot);
  return fract(vec2(a.x * a.y, a.y * a.z));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (uNoiseSmoothness - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = uFbmAmp;
  float freq = uFbmFreq;
  for (int i = 0; i < 1; i++) {
    value += amp * noise(p * freq);
    freq *= uFbmFreqMult;
    amp  *= uFbmAmpMult;
  }
  return value;
}

vec3 voronoiF1F2F3(vec2 uv, float time, float seed, float cells) {
  float INF = 1e6;
  float min1 = INF;
  float min2 = INF;
  float min3 = INF;

  vec2 cellUv    = fract(uv * cells) - 0.5;
  vec2 cellCoord = floor(uv * cells);

  for (float xo = -1.0; xo <= 1.0; xo += 1.0) {
    for (float yo = -1.0; yo <= 1.0; yo += 1.0) {
      vec2 off = vec2(xo, yo);
      vec2 nc  = cellCoord + off;
      vec2 r   = rand01(nc + seed);
      vec2 jitter = (r - 0.5) * uVoronoiJitter;

      vec2 sinPart = vec2(
        sin(time * uVoronoiSinSpeed1 + r.x * TAU) + uVoronoiSinAmp1 * cos(time * uVoronoiSinSpeed2 + r.x * TAU * uVoronoiSinAmp1),
        cos(time * uVoronoiSinSpeed3 + r.y * TAU) + uVoronoiSinAmp2 * sin(time * uVoronoiSinSpeed4 + r.y * TAU * uVoronoiSinSpeed2)
      ) * uVoronoiAnimBase;

      vec2 fb = vec2(
        fbm(nc * uVoronoiFbmScale1 + vec2(time * uVoronoiFbmSpeed1)),
        fbm(nc * uVoronoiFbmScale2 - vec2(time * uVoronoiFbmSpeed2))
      );
      vec2 fbDispl = (fb - 0.5) * uVoronoiFbmDispl;

      vec2 point = off + jitter + sinPart + fbDispl;
      float d = length(cellUv - point);

      if (d < min1)      { min3 = min2; min2 = min1; min1 = d; }
      else if (d < min2) { min3 = min2; min2 = d; }
      else if (d < min3) { min3 = d; }
    }
  }
  return vec3(min1, min2, min3);
}

vec2 organicSwirlUV(vec2 uv, float speed, float twist, float noiseScale, float noiseAmp) {
  vec2 c = uv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x);

  float n  = fbm(uv * noiseScale + vec2(uTime * uSwirlNoiseSpeed1));
  float n2 = fbm(uv * (noiseScale * uSwirlNoiseScale2) - vec2(uTime * uSwirlNoiseSpeed2));
  float n3 = fbm(uv * (noiseScale * uSwirlNoiseScale3) + vec2(uTime * uSwirlNoiseSpeed3, -uTime * uSwirlNoiseSpeed4));

  float fall = smoothstep(uSwirlSmoothStart, uSwirlSmoothEnd, r);
  a += speed * uSwirlSpeedMult * fall + twist * r * r + (n - 0.5) * noiseAmp + (n2 - 0.5) * noiseAmp * uSwirlNoiseAmp2;

  float radialFlow = (n3 - 0.5) * uSwirlRadialFlow * fall;
  r = max(0.0, r + radialFlow);

  vec2 rotated = vec2(cos(a), sin(a)) * r;
  return rotated + 0.5;
}

vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 getOrganicColor(vec2 uv, float cellDist, float noise1, float noise2, float noise3) {
  float baseGradient   = vUv.y;
  float cellInfluence  = smoothstep(0.0, 0.3, cellDist);
  float colorZone1     = noise1;
  float colorZone2     = noise2;
  float colorZone3     = noise3;

  float warmCoolBalance = baseGradient
    + (colorZone1 - 0.5) * uColorZone1Influence
    + (colorZone2 - 0.5) * uColorZone2Influence;
  warmCoolBalance = clamp(warmCoolBalance, 0.0, 1.0);

  vec3 warmPalette = cosinePalette(
    colorZone2,
    vec3(0.6, 0.5, 0.5),
    vec3(0.6, 0.6, 0.5),
    vec3(1.0, 0.7, 0.4),
    vec3(0.0, 0.15, 0.20)
  );
  vec3 coolPalette = cosinePalette(
    colorZone3,
    vec3(0.5, 0.5, 0.6),
    vec3(0.6, 0.6, 0.6),
    vec3(1.0, 1.0, 0.5),
    vec3(0.8, 0.9, 0.3)
  );

  vec3 finalColor = mix(warmPalette, coolPalette, warmCoolBalance);

  vec3 accentColor = cosinePalette(
    cellInfluence,
    vec3(0.8, 0.5, 0.4),
    vec3(0.4, 0.5, 0.4),
    vec3(2.0, 1.0, 1.0),
    vec3(0.0, 0.25, 0.25)
  );

  finalColor = mix(finalColor, accentColor, cellInfluence * uCellColorInfluence);
  return finalColor;
}

void main() {
  vec2 baseUV = vUv;

  vec2 uv2 = organicSwirlUV(baseUV, uLayer2Speed, uLayer2Twist, uLayer2NoiseScale, uLayer2NoiseAmp);
  vec3 F2  = voronoiF1F2F3(uv2, uTime * uLayer2TimeSpeed, uLayer2Seed, uCellCount2);

  vec2 uv3 = organicSwirlUV(baseUV, uLayer3Speed, uLayer3Twist, uLayer3NoiseScale, uLayer3NoiseAmp);
  vec3 F3  = voronoiF1F2F3(uv3, uTime * uLayer3TimeSpeed, uLayer3Seed, uCellCount3);

  float e12_2 = F2.y - F2.x;
  float e12_3 = F3.y - F3.x;

  float edgeNoise = fbm(uv2 * uCellCount2 * uEdgeNoiseScale + vec2(uTime * uEdgeNoiseSpeed));
  float widthMod  = mix(uEdgeWidthMin, uEdgeWidthMax, edgeNoise);
  float baseWidth = uBaseWidth * widthMod;

  float secondaryEdge = pow(1.0 - smoothstep(0.0, baseWidth * uSecondaryEdgeWidth, e12_2), uSecondaryEdgePow) * uSecondaryEdgeStrength;
  float tertiaryEdge  = pow(1.0 - smoothstep(0.0, baseWidth * uTertiaryEdgeWidth,  e12_3), uTertiaryEdgePow)  * uTertiaryEdgeStrength;

  float glow2 = pow(1.0 - smoothstep(baseWidth * uGlow2Start, baseWidth * uGlow2End, e12_2), uGlow2Pow) * uGlow2Strength;
  float glow3 = pow(1.0 - smoothstep(baseWidth * uGlow3Start, baseWidth * uGlow3End, e12_3), uGlow3Pow) * uGlow3Strength;

  float junction2 = pow(1.0 - smoothstep(0.0, baseWidth * uJunctionWidth, e12_2 + (F2.z - F2.y)), uJunctionPow) * uJunctionStrength;

  float colorNoise2    = noise(uv2 * uCellCount2 * uColorNoise2Scale + vec2(uTime * uColorNoise2Speed));
  float colorNoise3    = noise(uv3 * uCellCount3 * uColorNoise3Scale - vec2(uTime * uColorNoise3Speed));
  float colorNoiseSlow = noise(baseUV * 3.0 + vec2(uTime * 0.05));

  float edgeBrightness = mix(uEdgeBrightnessMin, uEdgeBrightnessMax, colorNoise2);

  float cellLight2 = exp(-F2.x * F2.x * uCellLight2Mult) * uCellLight2Strength;
  float cellLight3 = exp(-F3.x * F3.x * uCellLight3Mult) * uCellLight3Strength;

  float bgNoise  = fbm(uv2 * uCellCount2 * uBgNoiseScale  + vec2(uTime * uBgNoiseSpeed));
  float bgDetail = fbm(uv3 * uCellCount3 * uBgDetailScale - vec2(uTime * uBgDetailSpeed)) * 0.5;

  float bgValue  = mix(uBgValueMin, uBgValueMax, cellLight2 + cellLight3);
  bgValue       += bgNoise * uBgNoiseStrength + bgDetail * uBgDetailStrength;

  vec3 bgColorPalette = getOrganicColor(baseUV, F3.x, bgNoise, bgDetail, colorNoiseSlow * 0.5);
  vec3 baseColor      = bgColorPalette * bgValue * 0.3;

  vec3 organicColor = getOrganicColor(baseUV, F2.x, colorNoise2, colorNoise3, colorNoiseSlow);
  vec3 causticColor = organicColor * edgeBrightness;
  vec3 color = baseColor;

  color += causticColor * (secondaryEdge * uSecondaryWeight + tertiaryEdge * uTertiaryWeight);
  color += causticColor * (glow2 * uGlow2Weight + glow3 * uGlow3Weight);

  vec3 junctionColor = getOrganicColor(baseUV + vec2(0.1), F2.x * 0.5, colorNoise3, colorNoise2, 1.0 - colorNoiseSlow);
  color += junctionColor * (junction2 * uJunctionWeight);

  color *= uColorShift;

  color = clamp(color, 0.0, 1.0) * uColorMultiplier;

  vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
  color = mix(gray, color, 1.4);

  color = pow(color, vec3(uColorGamma));

  gl_FragColor = vec4(color, 1.0);
}
`;

// ── Engine + scene ──────────────────────────────────────────────────────

const canvas = document.querySelector("canvas.webgl");

const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);

const camera = new ArcRotateCamera("camera", 0, Math.PI / 2, 1, Vector3.Zero(), scene);
camera.setPosition(new Vector3(0, 0, 2.5));
camera.minZ = 0.1;
camera.maxZ = 100;
camera.fov  = (75 * Math.PI) / 180;
camera.inertia = 0.85;
camera.attachControl(canvas, true);

// ── Mesh ────────────────────────────────────────────────────────────────

const plane = MeshBuilder.CreatePlane("plane", { size: 3.5 }, scene);

// ── Uniform state — all defaults from the source ────────────────────────

const params = {
  uHashFract: [123.34, 456.21],
  uHashDot: 45.32,
  uRandFract: [123.5, 234.34, 345.65],
  uRandDot: 34.45,
  uNoiseSmoothness: 3.0,
  uFbmAmp: 2.0, uFbmFreq: 0.5, uFbmFreqMult: 2.1, uFbmAmpMult: 0.5,
  uVoronoiJitter: 0.5, uVoronoiAnimBase: 0.08,
  uVoronoiSinSpeed1: 0.6, uVoronoiSinSpeed2: 0.8, uVoronoiSinAmp1: 0.6,
  uVoronoiSinSpeed3: 0.5, uVoronoiSinSpeed4: 0.7, uVoronoiSinAmp2: 0.5,
  uVoronoiFbmScale1: 0.4, uVoronoiFbmSpeed1: 0.06,
  uVoronoiFbmScale2: 0.45, uVoronoiFbmSpeed2: 0.04, uVoronoiFbmDispl: 0.08,
  uSwirlSmoothStart: 0.0, uSwirlSmoothEnd: 0.5, uSwirlSpeedMult: 3.0,
  uSwirlNoiseAmp2: 0.6, uSwirlNoiseScale2: 1.5, uSwirlNoiseScale3: 0.7,
  uSwirlNoiseSpeed1: 0.15, uSwirlNoiseSpeed2: 0.10, uSwirlNoiseSpeed3: 0.08, uSwirlNoiseSpeed4: 0.06,
  uSwirlRadialFlow: 0.04,
  uCellCount2: 2.5, uCellCount3: 3.5,
  uLayer2Speed: 2.0, uLayer2Twist: 0.6, uLayer2NoiseScale: 20.0, uLayer2NoiseAmp: 0.7, uLayer2TimeSpeed: 1.4, uLayer2Seed: 77.0,
  uLayer3Speed: 2.0, uLayer3Twist: 1.4, uLayer3NoiseScale: 20.0, uLayer3NoiseAmp: 1.2, uLayer3TimeSpeed: 0.8, uLayer3Seed: 133.0,
  uEdgeNoiseScale: 2.0, uEdgeNoiseSpeed: 0.12, uEdgeWidthMin: 0.6, uEdgeWidthMax: 1.8, uBaseWidth: 0.015,
  uSecondaryEdgeWidth: 1.8, uSecondaryEdgePow: 3.5, uSecondaryEdgeStrength: 0.9,
  uTertiaryEdgeWidth: 2.5, uTertiaryEdgePow: 2.0, uTertiaryEdgeStrength: 0.5,
  uGlow2Start: 1.0, uGlow2End: 8.0,  uGlow2Pow: 4.5, uGlow2Strength: 0.45,
  uGlow3Start: 2.0, uGlow3End: 10.0, uGlow3Pow: 4.0, uGlow3Strength: 0.28,
  uJunctionWidth: 3.0, uJunctionPow: 8.0, uJunctionStrength: 1.4,
  uColorNoise2Scale: 5.0, uColorNoise2Speed: 0.25,
  uColorNoise3Scale: 3.0, uColorNoise3Speed: 0.15,
  uEdgeBrightnessMin: 0.6, uEdgeBrightnessMax: 1.0,
  uCellLight2Mult: 15.0, uCellLight2Strength: 0.35,
  uCellLight3Mult:  8.0, uCellLight3Strength: 0.18,
  uBgNoiseScale: 2.5, uBgNoiseSpeed: 0.06, uBgDetailScale: 1.5, uBgDetailSpeed: 0.04,
  uBgValueMin: 0.05, uBgValueMax: 0.25, uBgNoiseStrength: 0.04, uBgDetailStrength: 0.02,
  uBgColor: [0.5, 0.5, 0.5],
  uSecondaryWeight: 1.2, uTertiaryWeight: 1.6,
  uGlow2Weight: 1.0, uGlow3Weight: 0.7, uJunctionWeight: 0.9,
  uColorShift: [0.3, 0.2, 1.0],
  uColorMultiplier: 3.2, uColorGamma: 0.82,
  uFresnelPow: 2.0, uFresnelStrength: 0.3,
  uWarmColor1: [1.0, 0.3, 0.15],
  uWarmColor2: [1.0, 0.6, 0.2],
  uWarmColor3: [1.0, 0.85, 0.3],
  uCoolColor1: [0.4, 0.85, 1.0],
  uCoolColor2: [0.5, 0.7, 1.0],
  uCoolColor3: [0.6, 0.5, 1.0],
  uColorZone1Influence: 0.4,
  uColorZone2Influence: 0.3,
  uCellColorInfluence:  0.2,
};

const FLOAT_UNIFORMS = [
  "uTime", "uHashDot", "uRandDot", "uNoiseSmoothness",
  "uFbmAmp", "uFbmFreq", "uFbmFreqMult", "uFbmAmpMult",
  "uVoronoiJitter", "uVoronoiAnimBase",
  "uVoronoiSinSpeed1", "uVoronoiSinSpeed2", "uVoronoiSinAmp1",
  "uVoronoiSinSpeed3", "uVoronoiSinSpeed4", "uVoronoiSinAmp2",
  "uVoronoiFbmScale1", "uVoronoiFbmSpeed1",
  "uVoronoiFbmScale2", "uVoronoiFbmSpeed2", "uVoronoiFbmDispl",
  "uSwirlSmoothStart", "uSwirlSmoothEnd", "uSwirlSpeedMult",
  "uSwirlNoiseAmp2", "uSwirlNoiseScale2", "uSwirlNoiseScale3",
  "uSwirlNoiseSpeed1", "uSwirlNoiseSpeed2", "uSwirlNoiseSpeed3", "uSwirlNoiseSpeed4",
  "uSwirlRadialFlow",
  "uCellCount2", "uCellCount3",
  "uLayer2Speed", "uLayer2Twist", "uLayer2NoiseScale", "uLayer2NoiseAmp", "uLayer2TimeSpeed", "uLayer2Seed",
  "uLayer3Speed", "uLayer3Twist", "uLayer3NoiseScale", "uLayer3NoiseAmp", "uLayer3TimeSpeed", "uLayer3Seed",
  "uEdgeNoiseScale", "uEdgeNoiseSpeed", "uEdgeWidthMin", "uEdgeWidthMax", "uBaseWidth",
  "uSecondaryEdgeWidth", "uSecondaryEdgePow", "uSecondaryEdgeStrength",
  "uTertiaryEdgeWidth", "uTertiaryEdgePow", "uTertiaryEdgeStrength",
  "uGlow2Start", "uGlow2End", "uGlow2Pow", "uGlow2Strength",
  "uGlow3Start", "uGlow3End", "uGlow3Pow", "uGlow3Strength",
  "uJunctionWidth", "uJunctionPow", "uJunctionStrength",
  "uColorNoise2Scale", "uColorNoise2Speed", "uColorNoise3Scale", "uColorNoise3Speed",
  "uEdgeBrightnessMin", "uEdgeBrightnessMax",
  "uCellLight2Mult", "uCellLight2Strength", "uCellLight3Mult", "uCellLight3Strength",
  "uBgNoiseScale", "uBgNoiseSpeed", "uBgDetailScale", "uBgDetailSpeed",
  "uBgValueMin", "uBgValueMax", "uBgNoiseStrength", "uBgDetailStrength",
  "uSecondaryWeight", "uTertiaryWeight", "uGlow2Weight", "uGlow3Weight", "uJunctionWeight",
  "uColorMultiplier", "uColorGamma", "uFresnelPow", "uFresnelStrength",
  "uColorZone1Influence", "uColorZone2Influence", "uCellColorInfluence",
];
const VEC2_UNIFORMS = ["uHashFract"];
const VEC3_UNIFORMS = [
  "uRandFract", "uBgColor", "uColorShift",
  "uWarmColor1", "uWarmColor2", "uWarmColor3",
  "uCoolColor1", "uCoolColor2", "uCoolColor3",
];

const material = new ShaderMaterial(
  "spectralMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG },
  {
    attributes: ["position", "normal", "uv"],
    uniforms: ["world", "worldViewProjection", ...FLOAT_UNIFORMS, ...VEC2_UNIFORMS, ...VEC3_UNIFORMS],
  },
);
material.backFaceCulling = false;

const startT = performance.now() / 1000;

material.onBindObservable.add(() => {
  const e = material.getEffect();
  if (!e) return;
  // Source uses (clock.elapsed + 85) % 2000 — start in an interesting
  // phase of the noise field, wrap to avoid float-precision drift.
  e.setFloat("uTime", ((performance.now() / 1000 - startT) + 85) % 2000);
  for (const k of FLOAT_UNIFORMS) {
    if (k === "uTime") continue;
    e.setFloat(k, params[k]);
  }
  for (const k of VEC2_UNIFORMS) e.setFloat2(k, params[k][0], params[k][1]);
  for (const k of VEC3_UNIFORMS) e.setFloat3(k, params[k][0], params[k][1], params[k][2]);
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

// ── Debug GUI — same folder layout as the source ────────────────────────

const gui = new GUI();
gui.close();

const cellFolder = gui.addFolder("Cell Counts");
cellFolder.add(params, "uCellCount2", 1, 10, 0.1).name("Cell Count 2");
cellFolder.add(params, "uCellCount3", 1, 10, 0.1).name("Cell Count 3");

const layer2Folder = gui.addFolder("Layer 2");
layer2Folder.add(params, "uLayer2Speed",     -2, 2, 0.1).name("Speed");
layer2Folder.add(params, "uLayer2Twist",      0, 2, 0.1).name("Twist");
layer2Folder.add(params, "uLayer2NoiseScale", 1, 20, 0.5).name("Noise Scale");
layer2Folder.add(params, "uLayer2NoiseAmp",   0, 3, 0.1).name("Noise Amp");
layer2Folder.add(params, "uLayer2TimeSpeed",  0, 5, 0.1).name("Time Speed");
layer2Folder.add(params, "uLayer2Seed",       0, 200, 1).name("Seed");

const layer3Folder = gui.addFolder("Layer 3");
layer3Folder.add(params, "uLayer3Speed",     -2, 2, 0.1).name("Speed");
layer3Folder.add(params, "uLayer3Twist",      0, 2, 0.1).name("Twist");
layer3Folder.add(params, "uLayer3NoiseScale", 1, 20, 0.5).name("Noise Scale");
layer3Folder.add(params, "uLayer3NoiseAmp",   0, 3, 0.1).name("Noise Amp");
layer3Folder.add(params, "uLayer3TimeSpeed",  0, 5, 0.1).name("Time Speed");
layer3Folder.add(params, "uLayer3Seed",       0, 200, 1).name("Seed");

const edgesFolder = gui.addFolder("Edges");
edgesFolder.add(params, "uEdgeNoiseScale",        0.5, 5,    0.1).name("Edge Noise Scale");
edgesFolder.add(params, "uEdgeNoiseSpeed",        0,   0.5,  0.01).name("Edge Noise Speed");
edgesFolder.add(params, "uEdgeWidthMin",          0.1, 3,    0.1).name("Edge Width Min");
edgesFolder.add(params, "uEdgeWidthMax",          0.1, 5,    0.1).name("Edge Width Max");
edgesFolder.add(params, "uBaseWidth",             0.001, 0.1, 0.001).name("Base Width");
edgesFolder.add(params, "uSecondaryEdgeWidth",    0.5, 5, 0.1).name("Secondary Width");
edgesFolder.add(params, "uSecondaryEdgePow",      1, 10, 0.1).name("Secondary Pow");
edgesFolder.add(params, "uSecondaryEdgeStrength", 0, 2, 0.1).name("Secondary Strength");
edgesFolder.add(params, "uTertiaryEdgeWidth",     0.5, 5, 0.1).name("Tertiary Width");
edgesFolder.add(params, "uTertiaryEdgePow",       1, 10, 0.1).name("Tertiary Pow");
edgesFolder.add(params, "uTertiaryEdgeStrength",  0, 2, 0.1).name("Tertiary Strength");

const glowsFolder = gui.addFolder("Glows");
glowsFolder.add(params, "uGlow2Start",    0.1, 5,  0.1).name("Glow 2 Start");
glowsFolder.add(params, "uGlow2End",      1,   20, 0.5).name("Glow 2 End");
glowsFolder.add(params, "uGlow2Pow",      1,   10, 0.1).name("Glow 2 Pow");
glowsFolder.add(params, "uGlow2Strength", 0,   2,  0.05).name("Glow 2 Strength");
glowsFolder.add(params, "uGlow3Start",    0.1, 5,  0.1).name("Glow 3 Start");
glowsFolder.add(params, "uGlow3End",      1,   20, 0.5).name("Glow 3 End");
glowsFolder.add(params, "uGlow3Pow",      1,   10, 0.1).name("Glow 3 Pow");
glowsFolder.add(params, "uGlow3Strength", 0,   2,  0.05).name("Glow 3 Strength");

const junctionFolder = gui.addFolder("Junction");
junctionFolder.add(params, "uJunctionWidth",    0.5, 10, 0.1).name("Width");
junctionFolder.add(params, "uJunctionPow",      1,   15, 0.5).name("Power");
junctionFolder.add(params, "uJunctionStrength", 0,   5,  0.1).name("Strength");

const colorNoiseFolder = gui.addFolder("Color Noise");
colorNoiseFolder.add(params, "uColorNoise2Scale",  1, 20, 0.5).name("Noise 2 Scale");
colorNoiseFolder.add(params, "uColorNoise2Speed",  0, 1,  0.01).name("Noise 2 Speed");
colorNoiseFolder.add(params, "uColorNoise3Scale",  1, 20, 0.5).name("Noise 3 Scale");
colorNoiseFolder.add(params, "uColorNoise3Speed",  0, 1,  0.01).name("Noise 3 Speed");
colorNoiseFolder.add(params, "uEdgeBrightnessMin", 0, 1,  0.05).name("Brightness Min");
colorNoiseFolder.add(params, "uEdgeBrightnessMax", 0, 2,  0.05).name("Brightness Max");

const cellLightsFolder = gui.addFolder("Cell Lights");
cellLightsFolder.add(params, "uCellLight2Mult",     1, 50, 1).name("Light 2 Mult");
cellLightsFolder.add(params, "uCellLight2Strength", 0, 1,  0.05).name("Light 2 Strength");
cellLightsFolder.add(params, "uCellLight3Mult",     1, 50, 1).name("Light 3 Mult");
cellLightsFolder.add(params, "uCellLight3Strength", 0, 1,  0.05).name("Light 3 Strength");

const bgFolder = gui.addFolder("Background");
bgFolder.add(params, "uBgNoiseScale",     0.5, 10, 0.1).name("Noise Scale");
bgFolder.add(params, "uBgNoiseSpeed",     0,   0.3, 0.01).name("Noise Speed");
bgFolder.add(params, "uBgDetailScale",    0.5, 10, 0.1).name("Detail Scale");
bgFolder.add(params, "uBgDetailSpeed",    0,   0.3, 0.01).name("Detail Speed");
bgFolder.add(params, "uBgValueMin",       0,   0.5, 0.01).name("Value Min");
bgFolder.add(params, "uBgValueMax",       0,   1,   0.05).name("Value Max");
bgFolder.add(params, "uBgNoiseStrength",  0,   0.2, 0.01).name("Noise Strength");
bgFolder.add(params, "uBgDetailStrength", 0,   0.2, 0.01).name("Detail Strength");
bgFolder.addColor(params, "uBgColor").name("Background Color");

const weightsFolder = gui.addFolder("Caustic Weights");
weightsFolder.add(params, "uSecondaryWeight", 0, 3, 0.1).name("Secondary");
weightsFolder.add(params, "uTertiaryWeight",  0, 3, 0.1).name("Tertiary");
weightsFolder.add(params, "uGlow2Weight",     0, 3, 0.1).name("Glow 2");
weightsFolder.add(params, "uGlow3Weight",     0, 3, 0.1).name("Glow 3");
weightsFolder.add(params, "uJunctionWeight",  0, 3, 0.1).name("Junction");

const gradingFolder = gui.addFolder("Color Grading");
gradingFolder.add(params, "uColorMultiplier", 0.5, 10, 0.1).name("Multiplier");
gradingFolder.add(params, "uColorGamma",      0.3, 2,  0.01).name("Gamma");
gradingFolder.addColor(params, "uColorShift").name("Color Shift");

const voronoiFolder = gui.addFolder("Voronoi Animation");
voronoiFolder.add(params, "uVoronoiJitter",    0,   1,    0.05).name("Jitter");
voronoiFolder.add(params, "uVoronoiAnimBase",  0,   0.3,  0.01).name("Anim Base");
voronoiFolder.add(params, "uVoronoiSinSpeed1", 0,   2,    0.1).name("Sin Speed 1");
voronoiFolder.add(params, "uVoronoiSinSpeed2", 0,   2,    0.1).name("Sin Speed 2");
voronoiFolder.add(params, "uVoronoiSinAmp1",   0,   2,    0.1).name("Sin Amp 1");
voronoiFolder.add(params, "uVoronoiSinSpeed3", 0,   2,    0.1).name("Sin Speed 3");
voronoiFolder.add(params, "uVoronoiSinSpeed4", 0,   2,    0.1).name("Sin Speed 4");
voronoiFolder.add(params, "uVoronoiSinAmp2",   0,   2,    0.1).name("Sin Amp 2");
voronoiFolder.add(params, "uVoronoiFbmScale1", 0.1, 2,    0.05).name("FBM Scale 1");
voronoiFolder.add(params, "uVoronoiFbmSpeed1", 0,   0.3,  0.01).name("FBM Speed 1");
voronoiFolder.add(params, "uVoronoiFbmScale2", 0.1, 2,    0.05).name("FBM Scale 2");
voronoiFolder.add(params, "uVoronoiFbmSpeed2", 0,   0.3,  0.01).name("FBM Speed 2");
voronoiFolder.add(params, "uVoronoiFbmDispl",  0,   0.3,  0.01).name("FBM Displ");

const swirlFolder = gui.addFolder("Swirl");
swirlFolder.add(params, "uSwirlSmoothStart", 0,   1,   0.05).name("Smooth Start");
swirlFolder.add(params, "uSwirlSmoothEnd",   0,   1,   0.05).name("Smooth End");
swirlFolder.add(params, "uSwirlSpeedMult",   0,   10,  0.1).name("Speed Mult");
swirlFolder.add(params, "uSwirlNoiseAmp2",   0,   2,   0.1).name("Noise Amp 2");
swirlFolder.add(params, "uSwirlNoiseScale2", 0.5, 5,   0.1).name("Noise Scale 2");
swirlFolder.add(params, "uSwirlNoiseScale3", 0.5, 5,   0.1).name("Noise Scale 3");
swirlFolder.add(params, "uSwirlNoiseSpeed1", 0,   0.5, 0.01).name("Noise Speed 1");
swirlFolder.add(params, "uSwirlNoiseSpeed2", 0,   0.5, 0.01).name("Noise Speed 2");
swirlFolder.add(params, "uSwirlNoiseSpeed3", 0,   0.5, 0.01).name("Noise Speed 3");
swirlFolder.add(params, "uSwirlNoiseSpeed4", 0,   0.5, 0.01).name("Noise Speed 4");
swirlFolder.add(params, "uSwirlRadialFlow",  0,   0.2, 0.01).name("Radial Flow");

const fbmFolder = gui.addFolder("FBM");
fbmFolder.add(params, "uFbmAmp",      0,   2,  0.1).name("Amplitude");
fbmFolder.add(params, "uFbmFreq",     0.5, 10, 0.1).name("Frequency");
fbmFolder.add(params, "uFbmFreqMult", 1,   5,  0.1).name("Freq Mult");
fbmFolder.add(params, "uFbmAmpMult",  0.1, 1,  0.05).name("Amp Mult");

const colorPaletteFolder = gui.addFolder("Color Palette");
const colorMixingFolder  = colorPaletteFolder.addFolder("Color Mixing");
colorMixingFolder.add(params, "uCellColorInfluence", 0, 1, 0.05).name("Cell Influence");

[cellFolder, layer2Folder, layer3Folder, edgesFolder, glowsFolder, junctionFolder,
 colorNoiseFolder, cellLightsFolder, bgFolder, weightsFolder, gradingFolder,
 voronoiFolder, swirlFolder, fbmFolder, colorPaletteFolder, colorMixingFolder]
  .forEach((f) => f.close());

// ── Render loop ─────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());
