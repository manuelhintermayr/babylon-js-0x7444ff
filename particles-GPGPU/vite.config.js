// Mirrors the Three.js source's vite config one-for-one — same `root`,
// same `base`, same build target. Two differences from the original:
//
//   1. publicDir points to the sibling Three.js project's `static/` so
//      the .glb files (15+ MB) are served from a single location instead
//      of being duplicated. The two demos load the exact same models.
//
//   2. No vite-plugin-glsl. Babylon takes shader sources as strings via
//      `EffectWrapper` / `ShaderMaterial`, so `.glsl` files would just be
//      indirection. The shaders live as template literals in script.js.

export default {
  root: "src/",
  publicDir: "./static/",
  base: "./",
  server: {
    host: true,
    // Audio mp3s live in the sibling Three.js project's `src/audio/`.
    // Vite's default fs sandbox refuses imports above the root, so we
    // explicitly allow reads from the parent folder. Same reuse rationale
    // as `publicDir` above — no point duplicating ~11 MB of audio.
    fs: {
      allow: [".."],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
  },
};
