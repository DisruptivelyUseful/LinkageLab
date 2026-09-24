# Build Steps: step-by-step fabrication and assembly guide with animation

## Context

LinkageLab can already produce a static Build Guide (parts list, beam specs, drill templates, bracket drawing, PDF/CSV export) and, on the `refactor/optimization-unified-app` branch, a Hardware Assembly Detail editor where the user defines the exact hardware at each joint (bolts, bushings, washers, lock washers, nuts including rivet nuts, Unistrut bracket GLB) and their stack order along each joint axis.

What is missing is any notion of *sequence*: there is no way to say "first cut these, then drill these, then bolt this module together", no per-step camera view, and no animation of fabrication operations. The goal is a SketchUp-scenes-like system: an ordered, drag-reorderable list of steps, each with a saved camera view, optional notes, and an animated operation (cut, drill, place, fasten), with smooth camera transitions between steps, full play-through, and export of the sequence into the Build Guide, the PDF, and a WebM video. The steps travel with the design (saved in the config/project file).

### Critical finding: which branch to build on

`main` (and the designated branch `claude/build-guide-steps-mhh7e1`, currently identical to `main`) is a single 23,000-line `index.html` with **no** hardware-detail system. The parts-detail work the user refers to lives on `origin/refactor/optimization-unified-app` (40 commits ahead of main, none behind): modular ES-module code under `js/linkage/`, `hardware/registry.json` presets, `partials/` DOM, vitest unit tests, Playwright e2e, GitHub Actions CI.

**Decision: rebase the designated branch onto the refactor branch** (`git checkout -B claude/build-guide-steps-mhh7e1 origin/refactor/optimization-unified-app`, force-with-lease push is safe since the branch has no unique commits). All work below targets that codebase. The PR should target `refactor/optimization-unified-app`.

### Decisions already made with the user
- Cut/drill steps stage the beam on a **virtual workbench** (isolated, laid flat, stock length shown for cuts); place/fasten steps animate **in the assembly**.
- **Nuts are not auto-generated.** They remain a hardware-detail part type. A fasten step takes a bolt and an *optional* nut; with a nut, bolt and nut counter-rotate to their seats; without (welded/rivet nut, or bracket-tapped), only the bolt turns in.
- **Auto-generate** a full default sequence from the design, then edit/reorder.
- Outputs: in-app playback, Build Guide + PDF step pages, **and WebM video export**.

## What exists that we reuse (refactor branch paths)

| Need | Existing code |
|---|---|
| Geometry with per-part identity fields | `solveLinkage` (`js/linkage/solver.js:1118`, returns beams/brackets/bolts/washers/hardwareAssemblyPlacements); `Beam3D` has `moduleIndex, stackType, stackId, patternId` (`js/linkage/geometry-classes.js:24-73`); `buildLinkageGeometry` (`js/linkage/linkage-geometry.js:3670`) |
| Bolt holes per beam | `getBeamBoltIntersections(beam, bolts)` and `buildBeamMeshWithHoles` (`js/linkage/renderer-3d.js:838, 917`) |
| Mesh builders | `createBeamMesh`, `createBoltMesh`, `createBracketMesh`, `createWasherMesh` (`renderer-3d.js`); hardware part meshes `createHWBoltMesh`, `createHWNutMesh`, `buildHardwareAssemblyGroup`, `hwLayoutAxisParts`, `hwComputeAxisLayout`, `hwComputeAssemblyTransform` (`js/linkage/hardware-detail.js:1163, 1257, 2141, 462, 375, 2079`) |
| Scene rebuild + render | `updateThreeJSScenes`, `renderThreeJS` (`js/linkage/scene-render.js:54, 474`); `requestRender` (`js/linkage/render-app.js:36`) |
| Camera | `state.cam {yaw,pitch,dist,panX,panY}` (`js/linkage/app-state.js:182`), `updateMainCamera` (`renderer-3d.js:253`) |
| Tween pattern / rAF loop | `animateActuatorFold`, `animateFold` (`js/linkage/animation.js:209, 50`) |
| Drag-reorder list pattern | hardware part cards: grip `⠿`, HTML5 DnD, `.hw-drop-before/after`, `hwHandleDrop` (`hardware-detail.js:2760-2800, 3089-3102`; CSS `css/linkage.css:1710-1722`) |
| Persistence | `getConfigSnapshot` / `applyV30Config` / `applyConfig` (`js/linkage/config-persistence.js:377, 60, 686`); `LINKAGE_CONFIG_KEYS` (`js/core/project-store.js:302`); autosave (`js/linkage/main.js:151`) |
| Build Guide HTML + PDF | `showBuildGuide`, `exportGuidePDF`, `checkPageBreak`, `gatherBOMData` (`js/linkage/build-guide.js:256, 1844, 1881, 1687`) |
| Module registration | `bridgeGlobals(exports, name)` (`js/linkage/global-bridge.js`), `config/linkage-manifest.json` scripts/partials lists, init hooks in `initLinkageLab` (`js/linkage/main.js:18-24`) |
| Toasts | `showToast` (`js/core/feedback.js`) |
| Tests | vitest + happy-dom (`tests/setup.js`, `tests/helpers/state-fixture.js`), Playwright (`e2e/helpers/app-ready.js`) |

Gaps to close: no stable IDs on bolts/brackets/placements (bolts lack `moduleIndex`), meshes rebuilt every frame (no render-only path), no per-part visibility, no camera target/lookAt override, no picking in the main viewport, no easing/tween utility, no stock-length notion.

## Architecture

New modules (all `js/linkage/`, ES modules bridged via `bridgeGlobals`):

1. **`part-keys.js`** (pure, THREE-free; imports only `math.js`). `partKey(obj)` → deterministic string, e.g. `beam:horizontal-top:a0:m3:s7:A:L1`, `bolt:vstack:inner:a0:m3:bot`, `bracket:a0:m3:bot:outer`, `hwpl:outerVBeam:a0:m3:bot`, `hwpart:outerVBeam:a0:m3:bot:r-bolt:0`. `jointKey(obj)` → canonical joint id `{arrayIndex, moduleIndex, ring, role}` shared by a legacy bolt **and** the hardware placement that replaces it when Full Detail is on (the solver omits outer/inner bolts in that mode, `solver.js:2026-2070`), so a fasten target survives toggling the representation. `matchSelector(obj, selector)` for wildcard refs (`{kind:'beam', stackType:'horizontal-top'}` = all top H-beams; `moduleIndex:'*'`). `resolveTargets(data, refs)` → matched geometry objects + placements.
   - Solver identity edits (all needed to make keys unique; verified collisions today): add `layerIndex: i` in `createBeamStack` (`solver.js:885-890`) and the vertical/cap/fixed-beam constructors (~1569-1727); propagate `patternId`/`layerIndex` and add `arrayIndex` in the array-duplication copies of beams, bolts, brackets and placements (`solver.js:2655-2758`); add `moduleIndex`, `ring:'bottom'|'top'|'center'` and `role:'inner'|'outer'|'center'|'cap'` to vstack/hstack/hpivot bolts and their washers at creation (`createHorizontalBolt` 1884, `createVerticalBolt` 1911, `createHPivotBolt` 1931-1967, hstack center 2242-2266, cap bolts 2114-2122); add an index to `rcp-ring`/`rcp-cross` bolts (`linkage-geometry.js:3462, 3505`); add `pivotRole` to brackets (`solver.js:1828-1849`). Keys are computed lazily by `partKey`, never stored on the objects.
   - Hardware edits: `addAssemblyInstance` (`scene-render.js:162-178`) sets `instance.userData.placement` + `placementKey`; `hwLayoutAxisParts` (`hardware-detail.js:462-495`) stashes `userData.build = { axis: dirVec, cross: crossVec, axisPos, crossPos, len, copyIndex, flip, partsAxisKey, renderAxisKey }` on each part group so the fasten animator repositions parts without re-deriving the layout (non-focus instances are built with `explode: 0`, so `axisPos` is the seated position).

2. **`build-steps.js`** (pure model, THREE-free).
   ```js
   state.buildSteps = { version: 1, steps: [ {
     id, title, notes,                       // notes = free text tips
     kind: 'cut'|'drill'|'place'|'fasten'|'view',
     stage: 'bench'|'assembly',              // cut/drill default bench
     targets: [ selector, ... ],             // PartRef selectors (see part-keys)
     view: { yaw, pitch, dist, target:{x,y,z}|null, foldAngleDeg } | null,  // null = auto-frame targets
     transitionMs: 800, durationMs: 2500,
     op: {                                    // per kind
       cut:    { stockLengthIn, kerfIn },     // cutAt = beam length
       drill:  { bitDiameterIn, holes:'auto'|[{posL,through,diameterIn}] },
       place:  { approach:'above'|'axis'|'radial', travelIn },
       fasten: { bolt: selector, nut: selector|null, turns, allModules: bool },
       view:   {}
     } } ] };
   ```
   Functions: `createStep(kind, partial)`, `addStep/removeStep/moveStep(fromIdx,toIdx)/duplicateStep`, `normalizeBuildSteps(obj)` (migration + defaults), `computeStepVisibility(steps, idx, data)` → `Map<key, 'done'|'active'|'future'>`, `autoFrameView(targets bbox, fovDeg, aspect)` → view, `tweenView(a, b, t)` (shortest-arc yaw, easeInOutCubic), `cutPlan(beam, op)` → `{stockLen, cutAt, keepLen, offcutLen}`, `drillPlan(beam, intersections, op)` → ordered holes, `generateDefaultBuildSteps(data, state)` (see below).
   - Persistence: add `buildSteps` to `getConfigSnapshot` next to `hardwareAssemblies` (`config-persistence.js:463-474`, emit `undefined` when empty); in `applyV30Config` after the hardwareAssemblies block (147-153) deep-clone + `normalizeBuildSteps`, and reset to empty when absent so presets do not leak stale steps; add `'buildSteps'` to `LINKAGE_CONFIG_KEYS` (`project-store.js:302`) **and** to the explicit key list in `compactProjectForStorage` (269-298); default in `app-state.js`. Step edits call their own debounced persist (copy `hwFlushHardwareConfigSync`, `hardware-detail.js:2660-2671`) plus `saveStateToHistory()`, because autosave only fires on numeric input changes (`main.js:151-166`). Playback state lives in `state.buildPlayback` (never in the snapshot; add `'buildPlayback'` to the skip lists in `history.js:18, 47, 62`). `buildSteps` never enters the geometry cache hash (`cache.js:42-78` reads listed fields only).
   - Step views store the camera relative to an anchor: `{ yaw, pitch, dist, anchor: selector|null, foldAngleDeg }`; the anchor resolves to a world point at runtime (structure center and rotation change with fold, orientation and module count), so views stay valid when the design changes.

3. **`build-steps-anim.js`** (THREE, playback engine).
   - `state.buildPlayback = { active, stepIndex, phase:'transition'|'op'|'hold', t, playing, speed, loop }`.
   - **Scene hook**: `updateThreeJSScenes` calls `applyBuildStepScene(data, sc)` after the hardware-assembly block and before the actuator line (`scene-render.js:202-204`), no-op when `state.hwDetailMode`. Assembly stage: walks beam/bolt/bracket/washer/hardware groups, maps mesh → key, sets `visible=false` for `future`, and for `active` highlight / optional ghost-upcoming **clones the material** (bolts, washers, brackets and hardware parts share `getCachedMaterial` materials, so mutating opacity would dim every bolt; clones lack `_cacheKey` so `clearGroup` disposes them). Bench stage: a third branch beside the `detail` else-branch (216-237) so `updateGroundPlane` → `updateGridVisibility` (`renderer-3d.js:800-809`) cannot re-show the grid; hides `structureGroup`, `panelGroupRoot`, `gridHelper`, human figure, IBC; shows `benchGroup` (owned by this module, under `mainScene`) with synthetic `Beam3D` meshes laid along +X on a simple bench plane at the origin. Non-bench paths reset `structureGroup.visible = true`. `stepIndex` is clamped in the hook (undo/preset load can replace `state.buildSteps` mid-playback).
   - **Render-only path**: new `renderFrameOnly()` exported from `scene-render.js` = `updateMainCamera(center); threeRenderer.main.render(mainScene, mainCamera)`. The animator uses it every frame; full `requestRender()` only on step change, fold-angle transition frames, and when a hole/cut completes (bench group rebuilt locally, cheap). Extend the existing animation gates (`scene-render.js:234, 549`, `render-app.js:215-225`) to `state.animation.playing || state.buildPlayback?.active` so ortho views and the full HUD are skipped during playback.
   - **Animator**: single rAF loop (pattern of `animateFold`) with a clock abstraction (`wallClock` or `fixedStepClock(fps)` for recording). Phases per step: transition (camera + fold tween) → op (kind-specific) → hold. `goToStep(i)`, `play/pause/next/prev`, `scrub(t)`.
   - **Camera**: `state.cam.target` optional world lookAt override honoured by `updateMainCamera` (`renderer-3d.js:253-279`, `const sc = state.cam.target || structureCenter`; pan is world-axis so this is safe). The animator reads `state.cam` every frame (the Fit button replaces the object wholesale, `ui-bindings.js:1442`); `target` is cleared on playback exit and before `openHardwareDetail` (which snapshots `state.cam`, `hardware-detail.js:3361`); `cameraState` snapshot copies scalars only so `target` is never persisted. "Capture view" stores current cam + anchor + `foldAngleDeg`; "Auto-frame" derives the view from the targets' bbox.
   - **Tool meshes** (`createDrillBitMesh(d)`, `createSawBladeMesh(r)`): cached geometries; drill = chuck cylinder + fluted shaft (cylinder with dark helical stripe texture or two intersecting thin boxes) + cone tip; saw = thin disc with ring of tooth wedges + guard/motor box.
   - **Cut op**: bench shows stock beam (length `op.stockLengthIn`, default nearest of 8/10/12/16 ft ≥ beam length, seeded from `state.refBeamLength`). Blade spins about its axis and translates across the beam width at `cutAt`; kerf line appears behind it; at t≥0.7 the stock mesh is replaced by keep + offcut `Beam3D`s and the offcut slides/drops away. Repeat count badge "×N" for grouped beams.
   - **Drill op**: holes from `getBeamBoltIntersections(realBeam, data.bolts)` mapped onto the bench beam; for each hole in sequence: bit positions above the face, plunges `t + margin`, retracts; on retract the bench beam is rebuilt with that hole added via `buildBeamMeshWithHoles`.
   - **Place op**: target meshes start offset along the approach vector (with opacity 0.3) and lerp to final position/opacity 1.
   - **Fasten op**: after each scene rebuild, `findMeshesByKey` returns the bolt (and nut) meshes. Per frame: bolt `rotation.y += ω·dt` about its local axis (both `createBoltMesh` and HW meshes are laid out along local +Y), translation along axis from `unseatOffset` → 0; nut counter-rotates and travels from beyond the stack end to its seat (`userData.seatPos`). `allModules` applies to every placement of the assembly at once.
   - **Recorder**: `recordBuildSteps({from,to,fps:30})` → `canvas.captureStream(0)` + `MediaRecorder` (vp9 → vp8 fallback); the animator runs on `fixedStepClock(fps)`, and after each frame calls `track.requestFrame()` and yields one rAF (several renders in one task would encode only the last). Downloads `LinkageLab_BuildSteps_<ts>.webm`; toast if `MediaRecorder` is unsupported. Step thumbnails: `goToStep(i, {end:true}); renderFrameOnly(); canvas.toDataURL()` synchronously in the same task (Chromium keeps the drawing buffer until the task ends, so no `preserveDrawingBuffer` needed), downscaled through an offscreen 2D canvas because the renderer uses `devicePixelRatio`; yield between steps since fold changes re-solve; restore `state.cam`/`foldAngle` afterwards.

4. **`build-steps-ui.js`** + partials.
   - `partials/linkage-controls-build-steps.html` (sidebar group "Build Steps", inserted before support/actuator group): enable toggle, buttons *Auto-generate*, *+ Add step*, *Record video*; vertical step list (grip `⠿`, drag-reorder with the hardware-card DnD pattern, duplicate/delete, kind icon, warning badge when targets resolve to nothing); step editor for the selected step: title, kind, stage, targets picker (category → module → item dropdowns with "All modules"; plus *Pick in 3D* using a new raycaster in `viewport-input.js` that reads `userData` and calls `partKey`), notes textarea, view (*Capture current view* / *Auto-frame* / *Go to view*), transition/duration, kind-specific fields (stock length, bit Ø, approach, bolt/nut selects populated from the assembly's parts for hardware joints or legacy bolt types otherwise, "all modules").
   - `partials/linkage-build-steps-bar.html` (inside `#viewport`, bottom): transport ⏮ ◀ ▶/⏸ ▶| ⏭, loop, speed, scrub slider, step chips (SketchUp-scene-tab style, click to jump), caption overlay with title + notes. Hidden unless build mode enabled.
   - CSS: new `/* Build Steps */` section in `css/linkage.css` using `variables.css` tokens.
   - Wiring: `initBuildStepsUI()` called from `initLinkageLab` after `initHardwareUI()` (`main.js:24`). Manifest (`config/linkage-manifest.json`): `part-keys.js` after `math.js`; `build-steps.js` after `linkage-geometry.js` and before `build-guide.js` (which imports it); `build-steps-anim.js` after `render-app.js`; `build-steps-ui.js` after `hardware-ui-init.js`; the sidebar partial listed **before** `linkage-controls-support.html` (the `#sidebar` element closes there); the transport bar markup goes inside `#viewport` in `linkage-workspace-viewport.html`. Input conflicts: the transport container is excluded from viewport orbit mousedown (`viewport-input.js:48-58, 242-255`, add a `closest('#build-steps-bar')` check); Pick-in-3D uses a move threshold like `hwDetailPointerDown` and guards against the double `initViewportInput` call; Space (fold-animation toggle, `ui-bindings.js:472-479`) is intercepted during playback and `state.animation` is stopped when playback starts; `openHardwareDetail` exits playback; Esc exits playback.

5. **Exports** (`build-guide.js`): "Assembly Steps" card in `showBuildGuide` (numbered list: thumbnail, title, kind/targets summary, notes) and an `ASSEMBLY STEPS` PDF section after drill templates using `checkPageBreak` + `doc.addImage` for thumbnails (rendered on demand before the PDF builds, restoring the camera afterwards). Header button *🎬 Export Video* calls the recorder.

### Auto-generate (`generateDefaultBuildSteps`)
Ordering produced (each a group step with "×N" where parts are identical):
1. **Cut**: one step per (beam class, length, w, t) group across H/V/fixed/support/reciprocal beams.
2. **Drill**: one step per distinct hole pattern (from `getBeamBoltIntersections`, positions rounded to 1/16").
3. **Per module i** (assembly stage, folded pose from `getStructureFoldedAngle`): place bottom H stack → place V stack (patterns A/B) → place brackets → fasten V-stack bolts (inner/outer/center; for detailed hardware assemblies use the assembly's bolt part and nut part on the same axis if present) → place top H stack → fasten H-pivot bolts.
4. Support beams + reciprocal bolts, then solar panels (place).
5. Final **view** step: "Deploy" transition from folded to deployed fold angle.
Views: auto-frame (null), transition 800 ms, duration by kind.

## Implementation phases

**Phase 0 — Branch**: reset `claude/build-guide-steps-mhh7e1` onto `origin/refactor/optimization-unified-app` (done); `npm ci`; run `npm test` and `npm run test:e2e` for a baseline. Known pre-existing failure on the base: `tests/config-golden.test.js` for the 'StarShade V1 - SOAK 2026' preset expects 36 brackets / 93 bolts / 128 washers but the solver now emits 0 / 25 / 64 because that preset enables Full Detail hardware, which suppresses legacy bracket and bolt objects (`solver.js:2026-2070`). Either regenerate the fixture with `npm run test:golden:update` after confirming the behaviour is intended, or keep the failure isolated; it is unrelated to this feature.

**Phase 1 — Foundations**: `part-keys.js` + solver/hardware identity edits + unit tests; `build-steps.js` model + persistence (snapshot/apply/project keys/app-state default) + tests; sidebar list with DnD + editor (title/notes/kind/view capture); `cam.target` + `renderFrameOnly` + camera tween; playback of `view` steps with transitions and transport bar.

**Phase 2 — Staging and place**: visibility map + scene hook (assembly stage), place op, auto-frame, `Pick in 3D`, `generateDefaultBuildSteps` (cut/drill groups as placeholders + module assembly steps).

**Phase 3 — Bench fabrication — DONE**: bench group, saw and drill meshes, cut op (blade traverse, kerf, offcut separation) and drill op (plunge/retract per hole, holes revealed on retract), close-up framing that follows the tool.

**Phase 4 — Fasten — DONE**: legacy bolts and hardware-assembly bolt/nut animation (rivet / welded nuts stay put), `allModules`.

**Phase 5 — Exports — DONE**: Assembly Steps card in the Build Guide with rendered thumbnails, PDF section, WebM recorder (sidebar 🎬 and guide header buttons).

**Phase 6 — Tests, polish, docs — DONE**: e2e spec covers editor, playback, auto-generate, bench, place, pick, guide and PDF; user/developer documentation in `docs/BUILD_STEPS.md`. Also fixed a pre-existing `gD is not defined` error in the bracket diagram of the Build Guide.

## Files

New: `js/linkage/part-keys.js`, `js/linkage/build-steps.js`, `js/linkage/build-steps-anim.js`, `js/linkage/build-steps-ui.js`, `partials/linkage-controls-build-steps.html`, `partials/linkage-build-steps-bar.html`, `tests/part-keys.test.js`, `tests/build-steps.test.js`, `tests/build-steps-generate.test.js`, `e2e/build-steps.spec.js`.

Modified: `js/linkage/solver.js` (bolt/washer identity fields), `js/linkage/hardware-detail.js` (mesh userData for layout), `js/linkage/scene-render.js` (hook, placement userData, `renderFrameOnly`), `js/linkage/renderer-3d.js` (`cam.target`), `js/linkage/app-state.js`, `js/linkage/config-persistence.js`, `js/core/project-store.js`, `js/linkage/history.js` (skip playback), `js/linkage/build-guide.js`, `js/linkage/viewport-input.js` (pick), `js/linkage/main.js`, `config/linkage-manifest.json`, `css/linkage.css`, `partials/linkage-modal-build-guide.html` (video button), `e2e/helpers/app-ready.js` (optional module name).

## Verification

- `npm test`: new unit tests — keys unique over real `solveLinkage` output (runs under happy-dom via `tests/setup.js`) for fixtures with `hStackCount/vStackCount ≥ 3`, `arrayCount 2`, Full Detail on and off, and stable across all golden presets (`tests/fixtures/golden`); `jointKey` equality between a legacy bolt and its replacing placement; model ops (move/duplicate/normalize round-trip through `getConfigSnapshot`→`applyV30Config`), visibility map monotonicity, tween endpoints and shortest-arc yaw, cut/drill plans (offcut = stock − length − kerf; holes match intersections), auto-generate invariants (every beam cut and drilled before it is placed; every fasten after its parts are placed; counts match `gatherBOMData`).
- `npm run test:e2e`: new spec — boot, enable Build Steps, auto-generate (>0 steps), play to step 2, assert `state.buildPlayback.stepIndex` advances and canvas still attached; export config and assert `buildSteps` present; reload and assert steps restored.
- Manual (via `npm run serve`, Chromium/Playwright screenshots): capture/goto views tween smoothly; cut shows blade traverse and offcut separation; drill plunges and leaves holes matching the drill template; fasten with and without nut; hardware full-detail assembly fasten; drag reorder persists; PDF contains step pages; WebM downloads and plays.
