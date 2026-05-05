// Babylon.js port of `../../starter/template-purple-canvas/main.js`
// (vanilla WebGL).
//
// The starter template draws a single full-screen quad in solid purple.
// In Babylon this is just a ThinEngine + EffectRenderer + EffectWrapper
// triple — same setup the kaleidoscope-babylon port uses, just with a
// trivially constant fragment shader.

import "./style.css";
import { ThinEngine } from "@babylonjs/core/Engines/thinEngine";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";

const VERT = /* glsl */ `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Solid purple — copied verbatim from `../../starter/template-purple-canvas/shaders/fragment.js`.
const FRAG = /* glsl */ `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.4549, 0.2667, 1.0, 1.0);
}
`;

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("shaderCanvas");

  const engine = new ThinEngine(canvas, /* antialias */ true, {
    preserveDrawingBuffer: false,
    stencil: false,
  });
  // Source set canvas to window.innerWidth/innerHeight on every frame.
  // engine.resize() in a resize listener gives the same outcome with
  // less per-frame work.
  const fitCanvas = () => engine.resize();
  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  const effectRenderer = new EffectRenderer(engine);
  const effect = new EffectWrapper({
    name: "purple",
    engine,
    vertexShader:   VERT,
    fragmentShader: FRAG,
    attributeNames: ["position"],
  });

  engine.runRenderLoop(() => {
    if (!effect.isReady()) return;
    effectRenderer.render(effect);
  });
});
