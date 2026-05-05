// publicDir → ./public/ so /models/phoenix.glb + /draco/* are served from
// there. `target: esnext` is needed because main.js uses top-level
// await for SceneLoader.ImportMeshAsync.
export default {
  base: "./",
  publicDir: "./public/",
  build: {
    target: "esnext",
  },
};
