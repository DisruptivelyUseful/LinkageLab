# The 3D viewer: studio rendering, day/night and the deploy preview

LinkageLab's viewport uses the same rendering recipe as the StarShade website
viewer (`DisruptivelyUseful/starshade`, `js/model-viewer.js`), ported to the
three r128 build the app already loads. This page explains what changed, where
each piece lives, and how to work with it.

## The short version

- **Colour and light are physically based now.** sRGB output, ACES filmic tone
  mapping, `physicallyCorrectLights`, an image-based environment (a PMREM of the
  inline room environment) and soft 2048 px shadows. Hex colours ported from
  StarShade are converted to linear (`hexToLinear`) because r128 treats hex
  literals as linear.
- **The scene has a sky.** The WebGL canvas is transparent; `#viewport` (and the
  part-view `.hw-viewport`) draws a CSS gradient from `--sky-top` / `--sky-bottom`.
  A dark circular shadow-catcher with a cyan-tinted grid sits under the
  structure's lowest beam, a star dome and a moon sprite appear at night.
- **Time of day is a 24 h clock.** The scene slider (`state.sunTime`, 0-100; 50 =
  noon, so saved configs still open at noon) drives real solar geometry
  (`simulationLatitude`, `simulationDayOfYear`) *unclamped*, so night exists.
  The sun is the warm key light by day; the moon takes over as the cool key
  (and the shadow caster) at night.
- **Materials.** Beams are `MeshStandardMaterial` with a subtle procedural wood
  grain running along the beam; hardware is dark metal; solar panels are a
  single mesh with a procedural mono-crystalline cell texture on a clearcoat
  `MeshPhysicalMaterial` (top), an anodised frame (sides) and a white backsheet
  (bottom).
- **IBC totes are a battery gauge.** The tote bottle is drawn as a 10-segment
  gauge (segments below the state of charge glow green). At night the column
  throws a pulsing green light onto the beams and panel undersides.
- **Deploy preview.** The *Deploy* button in the top bar bakes the same
  "Deploy" clip the GLB exporter writes and plays it live: the packed bundle
  rises out of the IBC column, is carried and laid flat, the scissor unfolds,
  the roof beams fly in and the panels mount one by one. Scrub it, play it with
  the day clock, or hit *Exit*.

## Module map

| File | Role |
| --- | --- |
| `js/linkage/sky-model.js` | Pure day/night model: `skyModel({ sunElevationDeg })`, `skyModelForState(state)`, solar position, clock formatting, the colour palette. No THREE. |
| `js/linkage/room-environment.js` | Inline port of three's `RoomEnvironment` and the PMREM helper. |
| `js/linkage/materials.js` | Cached material factories (`getWoodMaterial`, `getHardwareMaterial`, `getPanelMaterials`), the procedural wood-grain and panel-cell textures, `setEnvMapScale` for day/night, `cloneMaterialForMutation`. Pure helpers (`panelCellGrid`, `woodUvScale`, `woodColorFor`) are unit-tested. |
| `js/linkage/render-studio.js` | Renderer flags, the light rig, ground/grid/stars/moon, `applySkyModel` (lights, exposure, env scale, CSS sky), `updateStudioFrame` (follows the structure), `isLowFx`. |
| `js/linkage/render-loop.js` | A gated `requestAnimationFrame` loop with named *frame drivers*; runs only while something animates (deploy playback, day clock, night glow pulse, camera fly-to). `flyCameraTo` eases `state.cam`. |
| `js/linkage/ibc-power.js` | Battery-gauge shader material (`onBeforeCompile`), the glow lights / halos, the state-of-charge model, `updateIbcPower`. |
| `js/linkage/deploy-preview.js` | Enter / exit / scrub / play the baked sequence; Pack entry; `deployPhaseLabel` and `describePackMeta` (unit-tested). |
| `js/linkage/fold-sequence.js` | Deploy order and the master-progress → per-copy angle schedule of the sequential fold (pure). |
| `js/linkage/pack-layout.js` | Where the folded bundles go: upright in the IBC column when they fit, flat beside it otherwise (pure). |
| `js/linkage/deploy-timeline.js` | Clip timing: the single-structure timeline and per-copy windows for a sequential array (pure). |
| `js/linkage/bom.js` | Per-structure and whole-array bill of materials shared by the drawer, guide, PDF/CSV and exports (pure). |
| `js/linkage/gltf-export.js` | `prepareExportScene(units, coordSys, options)` builds the export scene and bakes the clip without exporting; `exportToGLTF` and the preview both call it. Builders take materials from `materials.js` (`forExport` = plain untextured standard materials, so GLBs stay small). |

Load order (see `config/linkage-manifest.json`): sky-model → room-environment →
materials → render-studio → render-loop → ibc-power → renderer-3d …
deploy-preview → ui-bindings. None of the new modules import `app-state.js`
(they read `globalThis.state` at call time) because `app-state`'s defaults
depend on `hardware-detail.js`, which imports the renderer.

## Render flow

Geometry changes still go through `requestRender()` → `renderThreeJS()`, which
rebuilds every mesh. Anything that only moves lights or the camera calls
`renderFrameOnly()`; the frame loop does the same and skips its own draw when a
full render already happened in that frame (`threeRenderer._lastRenderTs`).

`updateSunPosition()` applies `skyModelForState(state)` (or the neutral
`studioModel()` in the part view), then `updateIbcPower()`. The sun slider calls
it and re-renders the frame; the deploy preview's day clock calls it per frame.

## Materials and caching

Materials from `materials.js` are shared and cached, keyed by their parameters.
Code that mutates a material (part-view fade, build-step ghost/highlight) must
clone first — `cloneMaterialForMutation()` handles arrays too. `clearGroup()`
and the exporter's dispose helper skip materials carrying `_cacheKey`.

Beam geometry gets planar UVs (u along the length, repeating every
`WOOD_GRAIN_REPEAT_IN` = 24 inches) so the grain runs lengthwise. Panel
geometry is six quads with three material groups (top / bottom / sides); winding
is kept consistent with the outward normal so double-sided lighting is right.

Existing colour assertions hold: the shade tarp keeps its raw hex colour and a
single opaque material (`e2e/coverings.spec.js`).

## The deploy preview

1. *Deploy* in the top bar (icon-only below 1600 px, hidden between 1181 and
   1360 px where the bar has no room) or *Preview deploy sequence* in the
   Animation group → `enterDeployPreview()`. If IBC totes are enabled the tote model
   must have loaded (the bundle rises out of the column); otherwise a toast asks
   you to retry in a moment.
2. The bake (`prepareExportScene('inches', 'yup', { animate: true,
   viewportMaterials: true })`) takes a few seconds for 32 samples. It snapshots
   and restores the reciprocal-roof solver state and suppresses the RCP
   diagnostics panel while sampling.
3. The live structure, panels, human figure, measurements and actuator lines are
   hidden; the baked `CoordSystem` wrapper (never a clone — the clip's tracks are
   keyed by node uuid) is added at the live ground height. The battery gauge and
   glow follow the baked totes.
4. Scrub with the *Sequence* slider (Animation group) or the transport buttons
   / Space. With *Run the day clock* on, Play starts at sunrise, runs one day
   over the sequence, then keeps cycling (charge by day, glow by night) until
   Pause. The fold-sweep Play is untouched outside the preview.
5. Any geometry edit (`invalidateGeometryCache`) exits the preview, as does
   *Exit*; the baked scene is disposed and the live groups restored.
6. **Pack** (top bar, or *Show packed for transport* in the Animation group)
   opens the same preview at t = 0: everything packed for transport. The panel
   shows a pack summary (bundles, where they sit, pack size, volume and the
   whole array's weight from the BOM).

### Arrays: one carrier per structure

With a radial array and/or an arch module array every structure has its own
`Structure_<name>` carrier node in the baked scene (`Structure_Center`,
`Structure_<slot>`, `_S<n>` suffixes for tunnel segments). The clip
(`buildFoldAnimationClip` in `gltf-export.js`):

- samples the kinematics once per angle for all copies (the sampled scenes use
  the deployed scene's pivot and ground lift so the `Structure` root stays
  constant; each carrier grounds its own bundle with a per-sample ground fix);
- measures each copy's folded bundle and gives it a pack slot from
  `js/linkage/pack-layout.js`: if the bundles fit upright inside the IBC tote
  footprint (40 × 48 in nominal, measured tote when loaded, up to 12 ft tall)
  they stand in the column and the top tote is raised by the gap; otherwise
  they lie flat beside the IBC in layers, lumber style. The last placed leaves
  first;
- with **Fold structures one at a time** on (Animation group,
  `state.animation.sequentialFold`, saved as `mode.sequentialFold`) gives every
  copy its own window of the clip (`js/linkage/deploy-timeline.js`, ~9 s per
  copy: rise → carry → lower → lay → unfold → roof beams → panels), in deploy
  order: the centre first when present and visible, then the ring copies.
  Otherwise all copies move together on the single-structure timeline;
- flies each copy's roof beams and panels from the shared pile and stack in
  that copy's window. Phase labels name the copy ("Copy 2 · Unfolding 63°").

The live fold sweep follows the same order: with the option on, the fold
slider / Play / Fold / Unfold are a master progress and copy *j* of *K* moves
while the progress crosses [j/K, (j+1)/K] (`js/linkage/fold-sequence.js`);
`buildLinkageGeometry` assembles at most three single structures per frame
(folded, deployed and the moving copy) and replicates them per copy.

## Low-effects mode

`?lowfx=1` or `navigator.webdriver` (Playwright) switches to 1024 px shadow
maps, no halo sprites, no glow pulse loop and instant camera moves, so the
software-rendered e2e runs stay fast and deterministic.

## Tests

- Unit: `tests/sky-model.test.js`, `tests/materials-params.test.js`,
  `tests/deploy-preview-phases.test.js`, `tests/fold-sequence.test.js`,
  `tests/pack-layout.test.js`, `tests/deploy-timeline.test.js`, `tests/bom.test.js`.
- e2e: `e2e/viewer-quality.spec.js` (renderer flags, materials, night sky, IBC
  gauge, deploy preview enter / scrub / play / exit).
