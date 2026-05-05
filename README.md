<img width="100%" height="40px" alt="0x7444ff" src="https://github.com/user-attachments/assets/8faac6a0-9f17-46a1-88ae-7c51b6c557ee" />

# babylon-js-0x7444ff

A **Babylon.js port of [SahilK-027's `0x7444ff` shader collection](https://github.com/SahilK-027/0x7444ff)** — 19 interactive WebGL2 demos rebuilt in [Babylon.js](https://www.babylonjs.com/) so that everyone in the Babylon ecosystem can study, fork and learn from the same techniques the original Three.js projects pioneered. Every shader, mesh-construction trick, post-processing chain, GPGPU ping-pong and HDRi setup is reproduced 1:1 — the browser shouldn't notice the engine change.

> Live gallery: **<https://projects.manuelhintermayr.com/babylon-js-0x7444ff/index.html>**

---

## Credits

This repository is **a derivative work**. All design ideas, shader maths, model selection, music selection and project structure were authored by **[@SahilK-027](https://github.com/SahilK-027)**. The Babylon.js ports were written by [@manuelhintermayr](https://github.com/manuelhintermayr).

### Original creator

- **Sahil K. ([@SahilK-027](https://github.com/SahilK-027))** — designed and built every original Three.js demo. Source: <https://github.com/SahilK-027/0x7444ff>. Each port's underlay carries his GitHub link and the original publish date.

### Shader-author attributions (carried over from the source shaders)

- **Stefan Gustavson** (https://github.com/stegu/webgl-noise) — Classic Perlin 2D / 3D noise used by `abstract-pattern`, `organic-pattern`, `perlin-noise-advanced-abstract-pattern`, `spectral-flow`, `voronoi-electric-pattern`, `glowing-phoenix`, `poly-ele`.
- **Ian McEwan, Ashima Arts** — Simplex 4D noise used by `wobbly-sphere`, `particles-GPGPU`.
- **Inigo Quilez** ([iquilezles.org](https://iquilezles.org/), MIT-licensed) — `hash()` function used by `grass` (https://www.shadertoy.com/view/Xsl3Dl).

### Asset / inspiration credits (carried over from the source projects)

- **Models on Sketchfab** — `particles-GPGPU` rotates through four models, each linked from the in-page "Model Credits" anchor (Spring Rose Garden, MV Spartan, Flowers in Vase, Parsons Chameleon).
- **Music on Pixabay** — `particles-GPGPU` background tracks: lesfm-22579021, humanoide_media-12661853, oleksii_kalyna-39191707, shidenbeatsmusic-25676252.
- **`grass` displacement maps**:
  - `grass_displacement_map.png` — Anime Grass Tutorial Blender files by **@trungduyng** (<https://youtu.be/M4kMri55rdE>, <https://trungduyng.substack.com/p/anime-grass-tutorial-blender>).
  - `grass_displacement_map_2.png` — <https://thedemonthrone.ca/projects/rendering-terrain/rendering-terrain-part-20-normal-and-displacement-mapping/>.
  - `grass_displacement_map_3.png` — <https://www.filterforge.com/filters/11382-bump.html> (the one this demo actually uses).
- **`iron-man-hologram` "Inspired By" image** carried over verbatim from the source.

If a credit was visible on the original Three.js page (`Made with 💜 by SK027`, original publish date, model link, music link, "Inspired By", etc.) it is mirrored on the Babylon-port page.

---

## Collection

| # | Preview | Project | Live | Local |
|---|---|---|---|---|
| 1 | <img width="180" src="./kaleidoscope/kaleidoscope.png" alt=""> | **Kaleidoscope** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/kaleidoscope/) | `kaleidoscope/` |
| 2 | <img width="180" src="./electric_waves/waves.png" alt=""> | **Electric Waves** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/electric_waves/) | `electric_waves/` |
| 3 | <img width="180" src="./black-pearl-flag/flag.png" alt=""> | **Black Pearl Flag** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/black-pearl-flag/) | `black-pearl-flag/` |
| 4 | <img width="180" src="./abstract-pattern/a_pattern.png" alt=""> | **Abstract Pattern** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/abstract-pattern/) | `abstract-pattern/` |
| 5 | <img width="180" src="./peacock/peacock.png" alt=""> | **Peacock** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/peacock/) | `peacock/` |
| 6 | <img width="180" src="./particles-GPGPU/particles_gpgpu.png" alt=""> | **Particles-GPGPU** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/particles-GPGPU/) | `particles-GPGPU/` |
| 7 | <img width="180" src="./iron-man-hologram/ironman.png" alt=""> | **Iron Man Hologram** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/iron-man-hologram/) | `iron-man-hologram/` |
| 8 | <img width="180" src="./space-distortion/space_distortion.png" alt=""> | **Space Distortion** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/space-distortion/) | `space-distortion/` |
| 9 | <img width="180" src="./poly-ele/poly_ele.png" alt=""> | **Poly Ele** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/poly-ele/) | `poly-ele/` |
| 10 | <img width="180" src="./glowing-phoenix/phoenix.png" alt=""> | **Glowing Phoenix** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/glowing-phoenix/) | `glowing-phoenix/` |
| 11 | <img width="180" src="./perlin-noise-advanced-abstract-pattern/advance_pattern.png" alt=""> | **Advanced Abstract Pattern** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/perlin-noise-advanced-abstract-pattern/) | `perlin-noise-advanced-abstract-pattern/` |
| 12 | <img width="180" src="./transformers-transition/transformers.png" alt=""> | **Transformers Transition** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/transformers-transition/) | `transformers-transition/` |
| 13 | <img width="180" src="./wobbly-sphere/wobbly_sphere.png" alt=""> | **Wobbly Sphere** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/wobbly-sphere/) | `wobbly-sphere/` |
| 14 | <img width="180" src="./organic-pattern/organic_pattern.png" alt=""> | **Organic Pattern** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/organic-pattern/) | `organic-pattern/` |
| 15 | <img width="180" src="./2D-day-night/sdf.png" alt=""> | **2D Day-Night SDF** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/2D-day-night/) | `2D-day-night/` |
| 16 | <img width="180" src="./scrolling-textures/scrolling.png" alt=""> | **Scrolling Textures** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/scrolling-textures/) | `scrolling-textures/` |
| 17 | <img width="180" src="./grass/grass.png" alt=""> | **Grass** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/grass/) | `grass/` |
| 18 | <img width="180" src="./voronoi-electric-pattern/voronoi.png" alt=""> | **Voronoi Electric Pattern** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/voronoi-electric-pattern/) | `voronoi-electric-pattern/` |
| 19 | <img width="180" src="./spectral-flow/spectral-flow.png" alt=""> | **Spectral Flow** | [↗](https://projects.manuelhintermayr.com/babylon-js-0x7444ff/spectral-flow/) | `spectral-flow/` |

`starter/template-purple-canvas/` is included as a Babylon.js boilerplate (single full-screen quad) for anyone who wants a clean ThinEngine + EffectRenderer starting point.

---

## Running locally

Each project is self-contained. Clone the repo, then:

```bash
cd <project-name>
npm install
npm run dev
```

The dev server runs on Vite (typically `http://localhost:5173/`). All projects target **WebGL2-capable browsers**.

> [!IMPORTANT]
> **Performance note** — some demos (1M-vertex Perlin terrain, 64 000 grass blades, 256² particle grid) are intentionally GPU-intensive. Test on a desktop with a modern dGPU first; mobile may struggle.

---

## Tech stack

- **[Babylon.js](https://www.babylonjs.com/) v7** — 3D graphics library
- **WebGL2** — graphics API
- **GLSL ES** — shader language (1.0 + 3.0)
- **[Vite](https://vitejs.dev/)** — build tool / dev server
- **[lil-gui](https://lil-gui.georgealways.com/)** — debug UI panels
- Vanilla JavaScript (ESM)

Babylon-only port-level patches are described as **side-by-side fixes** in the corresponding commit messages. Frequent themes:

- `world` / `view` / `viewProjection` / `vEyePosition` (Babylon) instead of `modelMatrix` / `viewMatrix` / `projectionMatrix` / `cameraPosition` (Three).
- Effect.ShadersStore registration for inline PostProcess sources.
- `engine.resize()` paired with explicit `canvas.style.width = innerWidth + "px"` so demos whose source CSS hard-codes 600px (or omits a size) still render fullscreen.
- `invertY = true` on `Texture` (Babylon's default, but spelled out so the parity with Three's `flipY` is intentional).
- `useRightHandedSystem = true` whenever the source's camera transforms or vertex math expects Three's right-handed convention.

---

## License

MIT — same as the original repository. See [LICENSE](LICENSE).

The original Three.js code by [@SahilK-027](https://github.com/SahilK-027) is also MIT-licensed; this Babylon.js port keeps the same license and preserves all attribution.

---

> Babylon.js port by [@manuelhintermayr](https://github.com/manuelhintermayr) — original demos by [@SahilK-027](https://github.com/SahilK-027).
