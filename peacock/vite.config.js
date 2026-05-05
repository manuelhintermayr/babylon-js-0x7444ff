// Image assets (image.png + glow.png) live in the sibling Three.js
// project's assets/ folder. Vite's default fs sandbox refuses imports
// above the project root, so we explicitly allow reads from the parent
// — same trick the particles-GPGPU-babylon and transformers-transition-
// babylon ports use to avoid asset duplication.
export default {
  server: {
    fs: {
      allow: [".."],
    },
  },
};
