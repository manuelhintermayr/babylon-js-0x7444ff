// Mirrors the Three.js source's layout: index.html lives under src/.
export default {
  root: "src/",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
  },
};
