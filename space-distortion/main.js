// Babylon.js port of SahilK-027/0x7444ff/space-distortion
//
// Pipeline parity with the original:
//   - Two render passes: 50 cloned blob sprites are rendered into an
//     offscreen render-target; that texture becomes the "mask" sampler
//     on the background plane's shader, which then warps the bg image
//     by the blob alpha. The foreground plane composites on top.
//   - The source uses two THREE.Scene instances. Babylon's idiom is one
//     Scene + a RenderTargetTexture with renderList=[...blobs], plus
//     layerMask isolation so the main camera excludes the blobs (it
//     would otherwise overwrite the warped output with raw blob sprites).
//   - Raycaster on the bgMesh -> scene.pick on pointermove. The picked
//     world point seeds new blob positions when each blob's life cycle
//     wraps.
//
// Three -> Babylon API map applied here:
//   THREE.Scene + scene1                    -> Scene + RenderTargetTexture
//   THREE.PerspectiveCamera (no controls)   -> FreeCamera, controls detached
//   THREE.WebGLRenderTarget                 -> RenderTargetTexture
//   THREE.RawShaderMaterial                 -> ShaderMaterial (vertex/fragment lists)
//   THREE.MeshBasicMaterial+AdditiveBlend   -> small ShaderMaterial + ALPHA_ADD
//   THREE.PlaneGeometry(w,h,32,32)          -> MeshBuilder.CreatePlane (no displacement)
//   THREE.TextureLoader                     -> Texture(url, scene)
//   THREE.Raycaster.intersectObjects        -> scene.pick(x, y, predicate)
//   uniforms.foo.value = x                  -> JS state pushed via onBindObservable
import "./style.css";
import {
  Engine,
  Scene,
  FreeCamera,
  Vector3,
  Color4,
  Color3,
  MeshBuilder,
  ShaderMaterial,
  Texture,
  RenderTargetTexture,
  Constants,
} from "@babylonjs/core";
// Side-effect import: scene.pick relies on the Ray module being loaded.
import "@babylonjs/core/Culling/ray";
import GUI from "lil-gui";

const rangeFunction = (a, b) => {
  const r = Math.random();
  return a * r + b * (1 - r);
};

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/**
 * Engine + scene
 */
const canvas = document.querySelector("canvas.webgl");
const engine = new Engine(canvas, true, { stencil: false }, true);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

const scene = new Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor = new Color4(0, 0, 0, 0);

/**
 * Cameras
 *
 * Source: PerspectiveCamera(75deg vfov, aspect, 0.1, 100) at (0,0,0.425).
 * No OrbitControls (commented out in the source).
 *
 * Two cameras share the same transform; layerMask isolates them:
 *   - mainCamera renders bgMesh + fgMesh (main canvas pass).
 *   - rttCamera renders the blobs into the RenderTargetTexture.
 */
const FOV_VERTICAL = (75 * Math.PI) / 180;

const mainCamera = new FreeCamera("main", new Vector3(0, 0, 0.425), scene);
mainCamera.setTarget(Vector3.Zero());
mainCamera.fov = FOV_VERTICAL;
mainCamera.minZ = 0.1;
mainCamera.maxZ = 100;

const rttCamera = new FreeCamera("rtt", new Vector3(0, 0, 0.425), scene);
rttCamera.setTarget(Vector3.Zero());
rttCamera.fov = FOV_VERTICAL;
rttCamera.minZ = 0.1;
rttCamera.maxZ = 100;

scene.activeCamera = mainCamera;

/**
 * Render target — receives blob sprites, sampled as `mask` on bgMesh.
 *
 * generateMipMaps: false to match THREE.WebGLRenderTarget defaults.
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

const rtt = new RenderTargetTexture(
  "blobsRTT",
  { width: sizes.width, height: sizes.height },
  scene,
  false
);
rtt.clearColor = new Color4(0, 0, 0, 0);
rtt.activeCamera = rttCamera;
rtt.renderList = [];
scene.customRenderTargets.push(rtt);

// Babylon's layerMask-isolation didn't reliably keep the blob meshes
// out of the main camera pass (they appeared additively-blended
// over the bg, blowing the image to white) AND simultaneously kept
// them included in the RTT pass. Switch to isVisible-toggle around
// the RTT render: blobs are isVisible=true only while the RTT is
// rendering, isVisible=false during the main pass.
rtt.onBeforeRenderObservable.add(() => {
  for (const b of allBlobs) b.isVisible = true;
});
rtt.onAfterRenderObservable.add(() => {
  for (const b of allBlobs) b.isVisible = false;
});

/**
 * Textures
 *
 * Demo switcher (Demo 1 vs Demo 2) swaps both bg and fg textures.
 * Mirrors the source's changeDemo function.
 */
const loadTexture = (url) => {
  // invertY=true (Babylon default) matches Three's TextureLoader default
  // flipY=true so the bg/fg images render right-side up.
  const t = new Texture(url, scene, true, true);
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
};

// Asset paths are relative to the served index.html so the build works
// under any deploy sub-folder.
let bgTexture = loadTexture("./textures/bg.png");
let fgTexture = loadTexture("./textures/fg.png");
const blobTexture = loadTexture("./blob.png");

/**
 * Shader source
 *
 * Background shader: sample bg, displace by mask.a * uMovementStrength,
 * dim by strength so the mask edges fade out. Source preserved 1:1 —
 * only the mat4 boilerplate collapses to Babylon's worldViewProjection.
 *
 * Foreground shader: trivial texture sample.
 */
const VERT = /* glsl */ `
precision mediump float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUv = uv;
}
`;

const FRAG_BG = /* glsl */ `
precision mediump float;
uniform sampler2D uTexture;
uniform sampler2D mask;
uniform float uMovementStrength;
varying vec2 vUv;
void main() {
  // bgMesh transparent except at cursor.
  // Babylon's RTT with ALPHA_ADD blending doesn't accumulate alpha
  // the same way Three does — m.a stays 0 even where blobs were
  // painted. Use the RGB luminance instead (the blob sprite is
  // white-glow so high luminance == cursor area).
  vec4 m = texture2D(mask, vUv);
  float strength = max(m.r, max(m.g, m.b));
  strength *= uMovementStrength;
  strength = min(1.0, strength);
  vec4 textureColor = texture2D(uTexture, vUv + (1.0 - strength) * 0.1);
  gl_FragColor = vec4(textureColor.rgb * strength, strength);
}
`;

const FRAG_FG = /* glsl */ `
precision mediump float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}
`;

// Tiny shader for the additive-blended blob sprites — replaces
// MeshBasicMaterial(map, blending: AdditiveBlending, transparent).
const FRAG_BLOB = /* glsl */ `
precision mediump float;
uniform sampler2D uTexture;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTexture, vUv);
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
}
`;

/**
 * State (GUI-driven, pushed to GPU via onBindObservable each frame)
 */
const blobParams = {
  blobsRadius: isMobile ? 0.0001 : 0.001,
  blobsdispersion: isMobile ? 0.01 : 0.03,
  blobsSpeed: 0.2,
  blobsCount: isMobile ? 20 : 50,
  edgeOpacity: 0.9,
  distortionSize: isMobile ? 0.03 : 0.07,
};

const bgParams = {
  uMovementStrength: 6.0,
};

/**
 * BG mesh
 */
const bgMesh = MeshBuilder.CreatePlane("bg", { size: 1 }, scene);
bgMesh.scaling.y = 2 / 3;
bgMesh.position.z = 0.125;
bgMesh.layerMask = 0x0fffffff;

const bgMaterial = new ShaderMaterial(
  "bgMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG_BG },
  {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "uMovementStrength"],
    samplers: ["uTexture", "mask"],
    needAlphaBlending: true,
  }
);
bgMaterial.backFaceCulling = false;
// Babylon's ShaderMaterial constructor option `needAlphaBlending` is
// only respected on some versions; explicitly override the method
// so the bg mesh is always drawn in the transparent pass.
bgMaterial.needAlphaBlending = () => true;
bgMaterial.setTexture("uTexture", bgTexture);
bgMaterial.setTexture("mask", rtt);
bgMaterial.onBindObservable.add(() => {
  const e = bgMaterial.getEffect();
  if (!e) return;
  e.setFloat("uMovementStrength", bgParams.uMovementStrength);
});
bgMesh.material = bgMaterial;

/**
 * FG mesh
 */
const fgMesh = MeshBuilder.CreatePlane("fg", { size: 1 }, scene);
fgMesh.scaling.y = 2 / 3;
fgMesh.position.z = 0.1;
fgMesh.layerMask = 0x0fffffff;

const fgMaterial = new ShaderMaterial(
  "fgMat",
  scene,
  { vertexSource: VERT, fragmentSource: FRAG_FG },
  {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection"],
    samplers: ["uTexture"],
  }
);
fgMaterial.backFaceCulling = false;
fgMaterial.setTexture("uTexture", fgTexture);
fgMesh.material = fgMaterial;

/**
 * Demo switcher
 */
const swapTextures = (demo) => {
  if (demo === "demo-1") {
    bgTexture.dispose();
    fgTexture.dispose();
    bgTexture = loadTexture("./textures/bg.png");
    fgTexture = loadTexture("./textures/fg.png");
  } else {
    bgTexture.dispose();
    fgTexture.dispose();
    bgTexture = loadTexture("./textures/bird.jpg");
    fgTexture = loadTexture("./textures/bird-bw.jpg");
  }
  bgMaterial.setTexture("uTexture", bgTexture);
  fgMaterial.setTexture("uTexture", fgTexture);
};
document.getElementById("demo-1")?.addEventListener("click", () => swapTextures("demo-1"));
document.getElementById("demo-2")?.addEventListener("click", () => swapTextures("demo-2"));

/**
 * Blob sprites
 */
const allBlobs = [];
const pickedPoint = new Vector3(0, 0, 0);

const makeBlobMaterial = () => {
  const mat = new ShaderMaterial(
    "blobMat",
    scene,
    { vertexSource: VERT, fragmentSource: FRAG_BLOB },
    {
      attributes: ["position", "uv"],
      uniforms: ["worldViewProjection", "uOpacity"],
      samplers: ["uTexture"],
      needAlphaBlending: true,
    }
  );
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.setTexture("uTexture", blobTexture);
  mat.onBindObservable.add(() => {
    const e = mat.getEffect();
    if (!e) return;
    e.setFloat("uOpacity", blobParams.edgeOpacity);
  });
  return mat;
};

const blobMaterial = makeBlobMaterial();

const createBlobs = () => {
  // Remove old blobs
  for (const b of allBlobs) {
    b.dispose();
  }
  allBlobs.length = 0;

  for (let i = 0; i < blobParams.blobsCount; i++) {
    const blob = MeshBuilder.CreatePlane(
      `blob_${i}`,
      { size: blobParams.distortionSize },
      scene
    );
    blob.material = blobMaterial;
    blob.position.z = 0.1;
    blob.alwaysSelectAsActiveMesh = true; // RTT camera needs to see them
    // Hidden in main render; flipped to visible inside the RTT
    // observable hooks below so the blob sprites only paint into the
    // mask, not on top of the bg/fg images.
    blob.isVisible = false;

    const deviation = rangeFunction(0, 2 * Math.PI);
    const r = rangeFunction(blobParams.blobsRadius, blobParams.blobsdispersion);
    blob.position.x = r * Math.sin(deviation);
    blob.position.y = r * Math.cos(deviation);
    blob.metadata = { life: rangeFunction(-2 * Math.PI, 2 * Math.PI) };

    allBlobs.push(blob);
  }
  rtt.renderList = allBlobs;
};

createBlobs();

const TWO_PI = 2 * Math.PI;

const updateBlobs = () => {
  for (const blob of allBlobs) {
    blob.metadata.life += blobParams.blobsSpeed;
    const s = Math.sin(blob.metadata.life / 2);
    blob.scaling.set(s, s, s);

    if (blob.metadata.life > TWO_PI) {
      blob.metadata.life = -TWO_PI;
      const deviation = rangeFunction(0, TWO_PI);
      const r = rangeFunction(blobParams.blobsRadius, blobParams.blobsdispersion);
      blob.position.x = pickedPoint.x + r * Math.sin(deviation);
      blob.position.y = pickedPoint.y + r * Math.cos(deviation);
    }
  }
};

const resizeBlobs = (size) => {
  for (const blob of allBlobs) {
    const old = blob.metadata;
    const oldPos = blob.position.clone();
    blob.dispose();
    const replacement = MeshBuilder.CreatePlane(blob.name, { size }, scene);
    replacement.material = blobMaterial;
    replacement.layerMask = 0x10000000;
    replacement.position.copyFrom(oldPos);
    replacement.position.z = 0.1;
    replacement.alwaysSelectAsActiveMesh = true;
    replacement.metadata = old;
    const idx = allBlobs.indexOf(blob);
    allBlobs[idx] = replacement;
  }
  rtt.renderList = allBlobs;
};

/**
 * Pointer pick — replaces THREE.Raycaster.intersectObjects([bgMesh]).
 *
 * Mesh-based scene.pick was fragile here (predicate / layerMask
 * interactions in Babylon 7), so we compute the ray-plane intersection
 * analytically against the bgMesh's z=0.125 plane. Same effect as
 * the source's raycaster, no mesh-state dependencies.
 */
const BG_MESH_Z = 0.125;
window.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
  const ray = scene.createPickingRay(x, y, null, mainCamera);
  if (Math.abs(ray.direction.z) < 1e-6) return;
  const t = (BG_MESH_Z - ray.origin.z) / ray.direction.z;
  if (t <= 0) return;
  pickedPoint.set(
    ray.origin.x + ray.direction.x * t,
    ray.origin.y + ray.direction.y * t,
    BG_MESH_Z,
  );
});

/**
 * GUI
 */
const gui = new GUI();
gui
  .add(blobParams, "blobsRadius")
  .min(0.0001)
  .max(0.2)
  .step(0.0001)
  .name("Blobs Separation");
gui
  .add(blobParams, "blobsCount")
  .min(0)
  .max(100)
  .step(1)
  .name("Blobs Count")
  .onChange(createBlobs);
gui
  .add(blobParams, "blobsdispersion")
  .min(0.01)
  .max(0.2)
  .step(0.001)
  .name("Blobs Positions");
gui
  .add(blobParams, "edgeOpacity")
  .min(0.0)
  .max(1.0)
  .step(0.0001)
  .name("Edge Opacity");
gui
  .add(blobParams, "distortionSize")
  .min(0.0)
  .max(0.5)
  .step(0.0001)
  .name("Distortion Size")
  .onChange((value) => resizeBlobs(value));
gui.add(blobParams, "blobsSpeed").min(0.01).max(1).step(0.01).name("Blobs Speed");
gui.add(bgParams, "uMovementStrength").min(0.0).max(10.0).step(1).name("Distortion Effect");

/**
 * Resize
 */
window.addEventListener("resize", () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  engine.resize();
  rtt.resize({ width: sizes.width, height: sizes.height });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
});

/**
 * Loader / render loop
 */
const loaderEl = document.querySelector(".loader");
if (loaderEl) loaderEl.style.display = "none";

engine.runRenderLoop(() => {
  updateBlobs();
  scene.render();
});
