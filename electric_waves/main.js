// Babylon.js port of SahilK-027/0x7444ff/electric_waves
//
// The source is React + react-three-fiber + drei. Babylon has no
// React bridge in this monorepo, so the port is a full vanilla
// rewrite that reproduces the same scene 1:1:
//   - 100 Catmull-Rom curves wrapping a unit sphere (the rendered
//     curves; the source also computes brain-shaped curves from
//     Data.economics[0].paths but never renders them).
//   - One thin glowing tube per curve (radius 0.001, 4 radial segs)
//     with a custom additive vertex/fragment shader that pulses
//     a band along vUv.x and reacts to a `mouse` uniform.
//   - 1000 additive points (10/curve x 100 curves) traveling along
//     each curve at random speeds; positions updated every frame.
//
// React/r3f -> Babylon API map applied here:
//   <Canvas camera={...}>          -> Engine + Scene + FreeCamera
//   <color attach="background">    -> scene.clearColor
//   <ambientLight> + <pointLight>  -> Babylon Hemispheric + PointLight
//                                     (kept for parity; the demo's
//                                     custom shaders ignore lighting)
//   <tubeGeometry args={curve...}> -> MeshBuilder.CreateTube
//   <points>                       -> Mesh + Material.PointFillMode
//   shaderMaterial(uniforms, v, f) -> ShaderMaterial (uniforms list)
//   useFrame(({clock,mouse,vp}))   -> scene.onBeforeRenderObservable
//   THREE.CatmullRomCurve3         -> custom uniform Catmull-Rom sampler
//   THREE.Vector3.setFromSpherical -> manual sin/cos conversion
import "./style.css";
import {
  Engine,
  Scene,
  FreeCamera,
  Vector3,
  Vector2,
  Color3,
  Color4,
  HemisphericLight,
  PointLight,
  Mesh,
  MeshBuilder,
  VertexData,
  ShaderMaterial,
  Material,
  Constants,
} from "@babylonjs/core";

const randomRange = (min, max) => Math.random() * (max - min) + min;

/**
 * Engine + scene + camera (Canvas camera={position:[0,0,2], fov:20})
 */
const canvas = document.querySelector("canvas.webgl");
const engine = new Engine(canvas, true, { stencil: false }, true);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

const scene = new Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor = new Color4(0, 0, 0, 1);

const camera = new FreeCamera("main", new Vector3(0, 0, 2), scene);
camera.setTarget(Vector3.Zero());
camera.fov = (20 * Math.PI) / 180;
camera.minZ = 0.01;
camera.maxZ = 100;

// Lights are present in the source but the demo's custom shaders
// don't sample them — kept here for parity.
new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
const pointLight = new PointLight("p", new Vector3(1, 1, 1), scene);
pointLight.intensity = 5;

/**
 * Build 100 Catmull-Rom curves wrapping a unit sphere.
 *
 * Source: each curve has 100 control points generated via
 * setFromSphericalCoords; phi sweeps from PI down to PI - PI*length,
 * theta is fixed per curve (i/100 * 2*PI).
 */
const NUM_CURVES = 100;
const NUM_CONTROL_POINTS = 100;
const curves = [];

const sphericalToCartesian = (radius, phi, theta) => {
  const sinPhi = Math.sin(phi);
  return new Vector3(
    radius * sinPhi * Math.sin(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.cos(theta)
  );
};

for (let i = 0; i < NUM_CURVES; i++) {
  const points = [];
  const length = randomRange(0.1, 1);
  for (let j = 0; j < NUM_CONTROL_POINTS; j++) {
    points.push(
      sphericalToCartesian(
        1,
        Math.PI - (j / NUM_CONTROL_POINTS) * Math.PI * length,
        (i / NUM_CURVES) * Math.PI * 2
      )
    );
  }
  curves.push(points);
}

/**
 * Uniform Catmull-Rom sampler.
 *
 * Three's CatmullRomCurve3 defaults to centripetal tension; the simple
 * uniform variant is visually equivalent for tightly-spaced control
 * points (100 per curve) and avoids pulling in a curve library.
 */
const sampleCatmullRom = (points, t) => {
  const N = points.length;
  const seg = t * (N - 1);
  const i = Math.min(N - 2, Math.max(0, Math.floor(seg)));
  const u = seg - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(N - 1, i + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  return new Vector3(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3)
  );
};

/**
 * Tube shader (BrainMaterial) — pulses a band along vUv.x via time;
 * deflects each vertex away from `mouse` if within 0.001.
 *
 * Three's auto-injected `projectionMatrix` and `modelViewMatrix`
 * uniforms are listed manually; modelViewMatrix is decomposed into
 * `view * world` so the shader's `p` mutation happens before the
 * combined transform.
 */
const TUBE_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform float time;
uniform vec3 mouse;
varying vec2 vUv;
varying float vProgress;
void main() {
  vUv = uv;
  vProgress = smoothstep(-1.0, 1.0, sin(vUv.x * 8.0 + time * 3.0));
  vec3 p = position;
  float maxDist = 0.001;
  float dist = length(mouse - p);
  if (dist < maxDist) {
    vec3 dir = normalize(mouse - p);
    dir *= (1.0 - dist / maxDist);
    p -= dir;
  }
  gl_Position = projection * view * world * vec4(p, 1.0);
}
`;

const TUBE_FRAG = /* glsl */ `
precision highp float;
uniform float time;
uniform vec3 color;
varying vec2 vUv;
varying float vProgress;
void main() {
  float hideCorners1 = smoothstep(1.0, 0.9, vUv.x);
  float hideCorners2 = smoothstep(0.0, 0.1, vUv.x);
  vec3 finalColor = mix(color, color * 0.24, vProgress);
  gl_FragColor = vec4(finalColor, hideCorners1 * hideCorners2);
}
`;

const TUBE_COLOR = new Color3(0.1, 0.3, 0.6);
const tubeShared = {
  time: 0,
  mouse: new Vector3(0, 0, 0),
};

/**
 * Build one tube per curve. Source uses tubeGeometry with 64 tubular
 * segments + 4 radial segments + radius 0.001; MeshBuilder.CreateTube
 * derives tubular count from path length, so we sample 65 points per
 * curve (= 64 segments).
 */
const TUBULAR_SEGMENTS = 64;
const RADIAL_SEGMENTS = 4;
const TUBE_RADIUS = 0.001;

const tubeMaterial = new ShaderMaterial(
  "tubeMat",
  scene,
  { vertexSource: TUBE_VERT, fragmentSource: TUBE_FRAG },
  {
    attributes: ["position", "uv"],
    uniforms: ["world", "view", "projection", "time", "color", "mouse"],
    needAlphaBlending: true,
  }
);
tubeMaterial.backFaceCulling = false;
tubeMaterial.disableDepthWrite = true;
tubeMaterial.alphaMode = Constants.ALPHA_ADD;
tubeMaterial.onBindObservable.add(() => {
  const e = tubeMaterial.getEffect();
  if (!e) return;
  e.setFloat("time", tubeShared.time);
  e.setColor3("color", TUBE_COLOR);
  e.setVector3("mouse", tubeShared.mouse);
});

const tubeMeshes = [];
for (const controlPoints of curves) {
  const path = new Array(TUBULAR_SEGMENTS + 1);
  for (let k = 0; k <= TUBULAR_SEGMENTS; k++) {
    path[k] = sampleCatmullRom(controlPoints, k / TUBULAR_SEGMENTS);
  }
  const tube = MeshBuilder.CreateTube(
    "tube",
    { path, radius: TUBE_RADIUS, tessellation: RADIAL_SEGMENTS, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );
  tube.material = tubeMaterial;
  tube.rotation.x = Math.PI / 2; // matches r3f's <mesh rotation={[PI/2,0,0]}>
  tubeMeshes.push(tube);
}

/**
 * BrainParticles — 1000 additive points (10/curve), positions walk
 * along the curves at per-particle random speeds.
 */
const DENSITY = 10;
const NUM_POINTS = NUM_CURVES * DENSITY;

const PARTICLE_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute float randomSize;
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
void main() {
  gl_Position = projection * view * world * vec4(position, 1.0);
  vec4 mvPosition = view * world * vec4(position, 1.0);
  gl_PointSize = randomSize * 5.0 * (1.0 / -mvPosition.z);
}
`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;
void main() {
  float disc = length(gl_PointCoord.xy - vec2(0.5));
  float opacity = 0.3 * smoothstep(0.5, 0.4, disc);
  gl_FragColor = vec4(vec3(opacity) * 0.5, 1.0);
}
`;

// Initial positions: random in [-1,1] cube (source initialises this
// way before the first frame walks them onto the curves).
const positions = new Float32Array(NUM_POINTS * 3);
for (let i = 0; i < NUM_POINTS; i++) {
  positions[i * 3] = randomRange(-1, 1);
  positions[i * 3 + 1] = randomRange(-1, 1);
  positions[i * 3 + 2] = randomRange(-1, 1);
}

const randomSizes = new Float32Array(NUM_POINTS);
for (let i = 0; i < NUM_POINTS; i++) {
  randomSizes[i] = randomRange(0.1, 3.0);
}

const myPoints = [];
for (let i = 0; i < NUM_CURVES; i++) {
  for (let j = 0; j < DENSITY; j++) {
    myPoints.push({
      currPosition: Math.random() * 10,
      speed: Math.random() * 0.001,
      curve: curves[i],
    });
  }
}

const particleMesh = new Mesh("particles", scene);
const particleData = new VertexData();
particleData.positions = positions;
// Indices are required by Babylon for VertexData.applyToMesh; one
// index per point so PointFillMode renders all of them.
const indices = new Uint32Array(NUM_POINTS);
for (let i = 0; i < NUM_POINTS; i++) indices[i] = i;
particleData.indices = indices;
particleData.applyToMesh(particleMesh, true);
particleMesh.setVerticesData("randomSize", randomSizes, false, 1);

const particleMaterial = new ShaderMaterial(
  "particleMat",
  scene,
  { vertexSource: PARTICLE_VERT, fragmentSource: PARTICLE_FRAG },
  {
    attributes: ["position", "randomSize"],
    uniforms: ["world", "view", "projection"],
    needAlphaBlending: true,
  }
);
particleMaterial.backFaceCulling = false;
particleMaterial.disableDepthWrite = true;
particleMaterial.alphaMode = Constants.ALPHA_ADD;
particleMaterial.fillMode = Material.PointFillMode;
particleMesh.material = particleMaterial;
particleMesh.rotation.x = Math.PI / 2;
particleMesh.alwaysSelectAsActiveMesh = true; // positions move every frame

/**
 * Mouse uniform — r3f exposes mouse in NDC + viewport in world units.
 * Converts mouse screen pos to a world point at z=0:
 *   width = 2 * camera.z * tan(fov/2) * aspect, height = 2*z*tan(fov/2)
 * (camera.z = 2 here, fov = 20 deg vertical).
 */
const mouseNDC = new Vector2(0, 0);
canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
});

const updateMouseWorld = () => {
  const aspect = engine.getRenderWidth() / engine.getRenderHeight();
  const heightAtZ0 = 2 * camera.position.z * Math.tan(camera.fov / 2);
  const widthAtZ0 = heightAtZ0 * aspect;
  tubeShared.mouse.set(
    (mouseNDC.x * widthAtZ0) / 2,
    (mouseNDC.y * heightAtZ0) / 2,
    0
  );
};

/**
 * Per-frame update — clock + mouse + walk particles
 */
const startTime = performance.now();

const buffer = positions; // alias for the per-frame loop
const updateParticles = () => {
  for (let i = 0; i < NUM_POINTS; i++) {
    const m = myPoints[i];
    m.currPosition = (m.currPosition + m.speed) % 1;
    const pt = sampleCatmullRom(m.curve, m.currPosition);
    buffer[i * 3] = pt.x;
    buffer[i * 3 + 1] = pt.y;
    buffer[i * 3 + 2] = pt.z;
  }
  particleMesh.updateVerticesData("position", buffer, false, false);
};

scene.onBeforeRenderObservable.add(() => {
  tubeShared.time = (performance.now() - startTime) * 0.001;
  updateMouseWorld();
  updateParticles();
});

/**
 * Resize
 */
window.addEventListener("resize", () => {
  engine.resize();
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
});

/**
 * Render loop
 */
engine.runRenderLoop(() => {
  scene.render();
});
