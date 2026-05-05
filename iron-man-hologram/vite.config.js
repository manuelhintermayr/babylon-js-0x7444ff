// Mirrors the Three.js source's vite config — same root + base. The
// publicDir points at the project's static/ so the 15+ MB ironman.glb
// (and the DRACO decoder) is served from there. Path is `../static/`
// because root is `src/`.
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
