// publicDir → sibling Three.js project's public/ so the HDR
// environment maps and DRACO decoder are served from a single
// location without duplication.
//
// server.fs.allow widens the FS read-allow-list to the parent
// directory so npm's hoisted node_modules (vite client env.mjs etc.)
// resolved from a sibling port don't get blocked.
export default {
  publicDir: "./public/",
  server: {
    fs: { allow: [".."] },
  },
};
