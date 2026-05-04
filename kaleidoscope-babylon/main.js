// Babylon.js port of `../kaleidoscope/main.js` (vanilla WebGL).
//
// Pipeline parity with the original:
//   1. A single full-screen quad rendered every frame.
//   2. Fragment shader receives `uTime` (seconds) + `uResolution` (px).
//   3. Output is the kaleidoscope colour field; no scene, no camera.
//
// What changes from the WebGL source:
//   • Manual `gl.createShader` / `useProgram` / attribute-buffer setup
//     becomes `EffectWrapper` + `EffectRenderer` — Babylon's high-level
//     full-screen-quad primitive.
//   • The original's two attributes (`a_position` / `a_uv`) collapse to
//     one: EffectRenderer pre-binds a `position` attribute (vec2 in
//     clip space [-1, +1]); we derive `vUv` as `position * 0.5 + 0.5`,
//     which gives the same 0..1 range the source's `a_uv` carried.
//   • Fixed 500×500 internal canvas size is preserved via
//     `engine.setSize` (the displayed CSS size is 600×600 from style.css —
//     the browser scales the framebuffer, exactly like the original).

import "./style.css";
import { ThinEngine } from "@babylonjs/core/Engines/thinEngine";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";

console.log("Developed by SK027 — Babylon.js port");

// ── Shaders ─────────────────────────────────────────────────────────────

// Pass-through vertex used by EffectRenderer. The renderer pre-binds a
// 2D quad in clip space, so we just convert position → uv (0..1).
const VERT = /* glsl */ `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Kaleidoscope fragment — copied byte-for-byte from
// `../kaleidoscope/shaders/fragment.js`. The only edit: the source's
// `varying vec2 v_uv` becomes `varying vec2 vUv` to match the vertex
// shader above.
const FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;

vec3 gradient(float distance) {
  vec3 a = vec3(0.5, 0.5, 0.7);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.25, 0.4, 0.5);
  return a + b * cos(6.28318 * (c * distance + d));
}

void main() {
  // Shift origin to the centre, scale to [-1, +1] like the source.
  vec2 shifted_uv = vUv - 0.5;
  vec2 fixed_uv   = shifted_uv * 2.0;
  vec2 uv_0       = fixed_uv;
  vec3 final_color = vec3(0.0);

  for (float i = 0.0; i < 2.7; i++) {
    fixed_uv *= 1.5;
    fixed_uv  = fract(fixed_uv);
    fixed_uv -= 0.5;

    // Aspect-correct so the pattern stays circular regardless of canvas size.
    fixed_uv.x *= uResolution.x / uResolution.y;

    float d = length(fixed_uv) * exp(-length(uv_0));
    vec3 colour = gradient(length(uv_0) + i * 0.4 + uTime * 0.4);

    d = sin(d * 8.0 + uTime) / 8.0;
    d = abs(d);
    d = pow(0.007 / d, 1.3);

    final_color += colour * d;
  }

  gl_FragColor = vec4(final_color, 1.0);
}
`;

// ── Engine + render ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("shaderCanvas");

  // ThinEngine is the no-scene flavour of Babylon's renderer — perfect for
  // a single full-screen-quad demo with no meshes, no cameras, no lights.
  const engine = new ThinEngine(canvas, /* antialias */ true, {
    preserveDrawingBuffer: false,
    stencil: false,
  });

  // Match the source's fixed 500×500 internal framebuffer. CSS in
  // style.css upscales the canvas to 600×600 on display.
  engine.setSize(500, 500);

  const effectRenderer = new EffectRenderer(engine);
  const effect = new EffectWrapper({
    name: "kaleidoscope",
    engine,
    vertexShader:   VERT,
    fragmentShader: FRAG,
    attributeNames: ["position"],
    uniformNames:   ["uResolution", "uTime"],
  });

  // The render loop — same shape as the source's `requestAnimationFrame`
  // recursion, just using Babylon's internal scheduler.
  engine.runRenderLoop(() => {
    if (!effect.isReady()) return;

    const e = effect.effect;
    e.setFloat2("uResolution", engine.getRenderWidth(), engine.getRenderHeight());
    e.setFloat("uTime", performance.now() / 1000);

    effectRenderer.render(effect);
  });
});
