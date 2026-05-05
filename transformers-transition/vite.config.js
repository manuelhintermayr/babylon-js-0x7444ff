// Audio/texture assets live in the sibling Three.js project's src/assets/
// folder. Vite's default fs sandbox refuses imports above the project
// root, so we explicitly allow reads from the parent so we can `import`
// the .png files via the same path the source uses, without duplicating
// ~5 MB of art.
export default {
  server: {
    fs: {
      allow: [".."],
    },
  },
};
