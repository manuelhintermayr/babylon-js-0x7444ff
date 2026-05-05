// Mirrors the Three.js source's vite config one-for-one — same `root`,
// same `base`, same build target. One thing differs from a stock vite
// config:
//
//   - No vite-plugin-glsl. Babylon takes shader sources as strings via
//     `EffectWrapper` / `ShaderMaterial`, so `.glsl` files would just be
//     indirection. The shaders live as template literals in script.js.
//
// `publicDir: "../static/"` is relative to `root` (`src/`), so it
// resolves to the port-root `static/` folder where the .glb models live.

export default {
  root: "src/",
  publicDir: "../static/",
  base: "./",
  server: {
    host: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
  },
};
