# Coverings plan: plywood walls, tables, and tensioned fabric

> Design document for the Coverings sidebar feature. Written before implementation; update as phases land.
>
> **Status:** Phase 1 landed (geometry module `js/linkage/coverings-geometry.js`, sidebar partial + `js/linkage/coverings-ui.js`, rendering, GLB export, persistence, unit + e2e tests). Phase 2 landed (`js/linkage/sheet-nesting.js`, `js/linkage/fabric-patterns.js`, `js/core/svg-cut-file.js`, `js/core/download.js`, `js/linkage/coverings-plan.js`, SVG cut-file downloads, Build Guide / BOM / CSV / PDF sections, `formatInchesFraction`). Phase 3 landed (`wall` part kind in `js/linkage/part-keys.js`, auto-generated install steps, build playback staging, click-a-span pick mode in the 3D view, dimension labels). Deferred: DXF export, arch and fixed-beam modes, corner bevels applied to piece geometry.
>
> Running the e2e suite where the CDNs are unreachable: install `three@0.128.0 jspdf@2.5.1 jspdf-autotable@3.8.4 d3@7 topojson-client@3 world-atlas@2` into a scratch folder and set `LINKAGE_E2E_CDN_DIR=<that folder>`; point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at a local Chromium if the Playwright cache has none.


## Context

LinkageLab designs the StarShade scissor-linkage ring but stops at the bare frame. The user wants to turn it into an enclosed space: plywood walls and counter-height tables between adjacent vertical X-stacks (the "uprights"), and tensioned fabric over the sides. The app should visualize the coverings in 3D, measure them, put the plywood cut geometry (angles and dimensions from 4x8 1/2" sheets) in the Build Guide beside the existing beam drill templates, generate fabric cut files, and let the user pick which spans are covered.

Decisions already made with the user:
- **Two bands per span.** Lower band (ground to a split height, default 48") and Upper band (split height to the top ring). Each band is independently `none | plywood | fabric`. Optional table on the lower band's top edge.
- **In scope:** sidebar ring picker, click-a-span-in-3D toggle, walls as a Build Steps part kind, SVG cut files, Build Guide + PDF + BOM/CSV.
- **Deferred:** DXF export, arch mode (show a "cylinder only" hint), fixed-beam mode (same hint).

### Key geometry facts (verified in the solver and in the user's exported 8-module design)

- Units are inches, Y up. Cylinder mode is `state.orientation === 'horizontal'`. The solver chains modules from the origin and `buildLinkageGeometry` later recenters everything by a constant shift, so the ring axis is **not** at the origin until after `shiftGeometryXZ`.
- Each module i emits one vertical X-stack (`stackType 'vertical'`, `stackId i`) in the near-radial plane on the edge shared with module i+1 (`js/linkage/solver.js:1382-1582`). Pattern **A** leans outward going up; pattern **B** leans inward going up. Layers are offset tangentially along `stackDir`, so individual B beams of neighbouring stacks are skew; the pivot-to-pivot **pattern line in the stack mid-plane** is what is coplanar across adjacent uprights (all B lines meet on the ring axis, by symmetry, when `hobermanAng = pivotAng = 0`).
- A `vertical-cap` stack (stackId -1) is emitted in cylinder mode too (`solver.js:1586`) and sits on top of upright N-1 when the ring is closed. It must be ignored when closed.
- Sample numbers (8 modules, fold 134.9°): B line runs r=133, y=3.2 to r=93.3, y=90.2 (tilt ≈ 24.5° from vertical). Chord between adjacent outer feet ≈ 101.8", between inner tops ≈ 71", slant ≈ 95.7". A full-height inward wall is a trapezoid wider than one sheet; a 48" vertical band has ≈ 52.7" slant, so it does not fit one 48" sheet height without the "fit split to one sheet" helper.
- The bottom H-ring scissor lies flat at y≈0 from r≈93 to r≈133; an inward wall mounted on the outside face of the B beams sits ≈ 2" outside the feet and clears it. A clearance warning covers other settings.
- Array mode only exists in arch mode (`solver.js:2635`), so no `arrayIndex` handling is needed.

## Architecture overview

```
state.coverings  ──►  computeCoverings(data)  ──►  data.coverings.shapes  ──►  scene-render (meshes, pick quads, dims)
 (sidebar UI)          [coverings-geometry.js]        │                         gltf-export, geometrySnapshot, part-keys ('wall')
                                                      ▼
                                       computeCoveringCutPlan (memoized)  ──►  Build Guide HTML/PDF/CSV, BOM, SVG downloads
                                       [sheet-nesting.js, fabric-patterns.js, svg-cut-file.js]
```

All new geometry modules are pure (no DOM, no THREE) so they are unit-testable under vitest, following `hw-stack-layout.js`.

## Data shapes

### State (`js/linkage/app-state.js`, mirrored in `tests/helpers/state-fixture.js`)

```js
coverings: {
  enabled: false,
  lean: 'inward',                 // 'inward' (follow B beams) | 'outward' (A beams) | 'vertical' | 'custom'
  customTiltDeg: 0,
  splitHeightIn: 48, bottomIn: 0, topClearanceIn: 1, edgeGapIn: 0.25,
  mount: 'outside',               // 'centerline' | 'outside' | 'inside' face of the guide beams
  sheet:  { widthIn: 48, lengthIn: 96, thicknessIn: 0.5, orientation: 'auto', align: 'center', kerfIn: 0.125 },
  fabric: { rollWidthIn: 60, hemIn: 1, seamIn: 0.5, stretchPct: 2, grommetSpacingIn: 12 },
  table:  { depthIn: 24, thicknessIn: 0.75 },
  spans: [ { lower:'none', upper:'none', table:false } × N ],
  visibility: { walls: true, fabric: true, tables: true },
  showDimensions: false,
  pickMode: false                 // transient, never serialised
},
costPlywoodSheet: 45, costFabricYard: 8, costGrommet: 0.25   // flat cost* keys like the existing ones
```

Helpers in `coverings-geometry.js`: `DEFAULT_COVERINGS`, `createDefaultCoverings()`, `resizeCoveringSpans(cov, n)` (keeps existing entries), `normalizeCoverings(raw)`.

### Computed per render: `data.coverings`

```js
{ enabled, supported, unsupportedReason: null|'arch'|'fixed-beams'|'no-uprights',
  ringCenter:{x,z}, closed, closureErrorDeg, ringTopY, ringUndersideY,
  uprights:[Upright], spans:[Span], shapes:[Shape], pickQuads:[{spanIndex, band, corners3D}],
  warnings:[{spanIndex, band, code, message}], totals:{...} }

Upright = { index, moduleIndex, center, normal /*stackDir*/, halfWidthIn, azimuthDeg, A:Line, B:Line }
Line    = { bot, top, dir, pivotBot, pivotTop }              // projected onto the stack mid-plane
Span    = { index, moduleIndex, left, right, closing, plane, planarityErrorIn, tiltFromVerticalDeg,
            dihedralToNextDeg, sideLines, config, lower:Shape|null, upper:Shape|null, table:Shape|null }
Plane   = { origin, n /*outward*/, u /*horizontal in-plane*/, v /*up-slope in-plane*/ }
Shape   = { type:'covering', kind:'wall'|'fabric'|'table', band:'lower'|'upper'|'table', spanIndex, moduleIndex,
            coverType, plane, corners3D:[BL,BR,TR,TL], slabCorners3D:[8], center,
            corners2D:[{s,t}×4] /*BL at origin, bottom edge along +s*/,
            widthBottomIn, widthTopIn, slantHeightIn, verticalHeightIn, yBottom, yTop,
            tiltFromVerticalDeg, sideTaperDeg:{left,right}, cornerAnglesDeg:[4], edgeBevelDeg:{left,right},
            areaIn2, thicknessIn, mountOffsetIn, warnings:[] }
```

### Cut plan outputs

- `nestPolygonOnSheets(corners2D, stock)` → `{ orientation, cols, rows, pieces:[{ pieceId, row, col, polygon2D (sheet-local), isFullSheet, edges:[{lengthIn, angleDeg, isStock, isSeam, side}], marks:[{side, fromCorner, distIn}], offcut }], sheetCount, utilization, warnings }`
- `buildFabricPattern(corners2D, fabricCfg)` → `{ finished2D, panels:[{ cut2D, finished2D, seamEdges, hemEdges, grommets }], panelCount, grommetCount, fabricYards, areaIn2 }`
- `computeCoveringCutPlan(coverings, state)` (memoized on rounded dims + settings) → `{ walls:[{shape, nest, svg}], tables:[...], fabric:[{shape, pattern, svg}], bom }`

## Math (implement exactly; all in `js/linkage/coverings-geometry.js`)

Vector helpers come from `js/linkage/math.js` (`vAdd, vSub, vScale, vDot, vCross, vNorm, vMag`).

1. **Uprights.** Group `data.beams` with `stackType 'vertical'` (and `'vertical-cap'`) by `stackId`. `n_k = vNorm(cross(dirA, dirB))` (equals the solver's `stackDir`), `c_k = mean(center)`. Project every layer's `p1/p2` onto the mid-plane through `c_k` with normal `n_k`; all A layers collapse to one line, all B layers to another. `pivotBot/Top = ends ∓ dir·state.vertEndOffset`. `halfWidthIn = max |(center−c_k)·n_k| + w/2`. Ring center = circle fit (Kasa) of the B feet in XZ, fallback `data.structureCenter`.
2. **Spans and closure.** `rel = calculateJointPositions(state.foldAngle, {...}).relativeRotation` (`js/linkage/joint-kinematics.js:16`); `closed = |N·|rel| − 360°| < 1°`. Span j uses left upright j−1 and right upright j. Span 0 uses upright N−1 when closed (drop the cap), else the cap upright if present, else it is omitted.
3. **Wall plane.** `inward` → plane through both B lines; `outward` → A lines; `vertical` → vertical plane through the two B feet; `custom(τ)` → vertical plane rotated by τ about the foot chord. Best-fit through the 4 endpoints, `n` flipped outward from the ring center, `planarityErrorIn = max |(P_i − origin)·n|` (warn > 0.25"). `u = vNorm(cross(Y, n))`, `v = cross(n, u)` with `v.y > 0`, `tilt = asin(|n.y|)`.
4. **Side edges** = wall plane ∩ the stack's side plane (normal `n_k`, offset `halfWidthIn + edgeGapIn` toward the span). Standard two-plane intersection line; skip with a warning if the planes are near parallel. This makes the sheet butt the physical stack face rather than the beam centerline (≈ 2.7" inset per side in the sample, bottom width ≈ 96.4").
5. **Band polygon.** Lower `[bottomIn, splitHeightIn]`, upper `[splitHeightIn, ringUndersideY − topClearanceIn]` where `ringUndersideY = min corner.y` over `horizontal-top` beams. `t = (y − origin.y)/v.y`; corners are the side lines evaluated at `t_bot`/`t_top`; rebase so BL = (0,0). Derive widths, slant, area, `sideTaperDeg = atan((TL.s − BL.s)/slant)` etc., corner angles, `edgeBevelDeg = dihedralToNext/2` (informational). `mountOffsetIn` from the max signed distance of the guide beams' `corners` to the plane plus half the sheet thickness. Emit `'beam-protrudes'` when any H-beam corner within the band's Y range crosses the slab's inner face.
6. **Table polygon** at `y = splitHeightIn`: outer edge = inner face of the lower wall at that height, inner edge translated inward horizontally by `depthIn`, sides clipped by the two stack side planes. Sides converge radially, so `widthInner < widthOuter`. Warn `'table-unsupported'` when the lower band is `none`.
7. **Sheet nesting** (`js/linkage/sheet-nesting.js`): tile the polygon bbox with sheet cells (landscape/portrait, left/center align; `auto` picks min sheet count then max utilization), Sutherland–Hodgman clip each cell, snap to 1/64", classify edges as stock/seam/cut, record cut angles (0–180° from the sheet bottom edge) and where each cut meets a stock edge as a distance from the nearest sheet corner. Warnings: `seam-on-taper`, `sliver` (< 4"), and a standing `batten` note per seam.
8. **Fabric** (`js/linkage/fabric-patterns.js`): finished outline = polygon scaled by `1 − stretchPct/100`; split into `ceil(width / (roll − 2·seam))` panels with vertical seams; cut outline = convex edge offset (hem on outer edges, seam on seam edges); grommets evenly along hem edges at `grommetSpacingIn` including corners; yardage from summed panel heights.
9. **Fractions:** add `formatInchesFraction(v, denom = 16)` to `js/core/unit-converter.js` and the `unitConverter` object.

## Phases and file-by-file changes

### Phase 1: geometry, state, rendering, ring picker, persistence

1. **New `js/linkage/coverings-geometry.js`** (pure). Exports the defaults/helpers and `collectUprights`, `collectSpans`, `solveSpanPlane`, `buildBandShape`, `buildTableShape`, `computeCoverings(data, cov, state)`. `bridgeGlobals(..., 'coveringsGeometry')`. Add to `config/linkage-manifest.json` scripts after `joint-kinematics.js`.
2. **`js/linkage/app-state.js`**: add `coverings` and the three `cost*` keys. Mirror in `tests/helpers/state-fixture.js`.
3. **`js/linkage/linkage-geometry.js`**: in `buildLinkageGeometry` after the final bounds recompute (~line 3776, i.e. **after** `shiftGeometryXZ`, so the shift needs no changes) set `data.coverings = state.coverings?.enabled ? computeCoverings(...) : null` inside try/catch. In `buildGeometrySnapshot` (~3229) add a `coverings` block (shapes with rounded corners, dims, type).
4. **`js/linkage/renderer-3d.js`**: in `initThreeJS` create `threeRenderer.coveringGroup` under `structureGroup` with children `coveringWallGroup`, `coveringFabricGroup`, `coveringTableGroup`, `coveringPickGroup`, `coveringDimGroup`. Add `createCoveringMesh(shape)` (box from `slabCorners3D`, materials via `getCachedMaterial`: plywood matte tan, fabric translucent double-sided, table plywood; `userData.covering = shape`) and `createCoveringPickMesh(quad)` (`userData.coveringPick`).
5. **`js/linkage/scene-render.js`** `updateThreeJSScenes`: `clearGroup` the covering subgroups with the others; after the panels block add shapes filtered by `state.coverings.visibility` via `offsetMesh`; add pick quads when `pickMode`; call `globalThis.updateCoveringsReadout?.(data)`.
6. **`js/linkage/ui-bindings.js`** shadows handler (~669-726): include `coveringGroup`. **`js/linkage/gltf-export.js`** (~410-434): add a `Coverings` group like panels.
7. **New `partials/linkage-controls-coverings.html`**, registered in the manifest after `linkage-controls-support.html`. Uses existing classes (`.group/.group-title/.group-content`, `.ctrl-row > .ctrl-head + .input-wrap`, `.chk-label`, `.chk-grid`, `.subhead`, `.sub-block`, `.hint`, `.diag-panel/.kv-grid`, `.btn-sm`). Contents: `#chk-coverings`; `#cov-mode-hint`; `#cov-ring-picker` (SVG injected by JS) + legend; quick buttons `#btn-cov-all-ply`, `#btn-cov-all-fabric`, `#btn-cov-enclose` (lower plywood + upper fabric), `#btn-cov-clear`, `#btn-cov-tables`, `#btn-cov-pick`; sliders `sl/nb-cov-split`, `-bottom`, `-top-clear`, `-edge-gap`; `#btn-cov-fit-sheet`; `#sel-cov-lean` + `sl/nb-cov-tilt`; `#sel-cov-mount`; Sheet sub-block (preset 4x8/5x5/4x10/custom, w/l/t, orientation, align, kerf, `#nb-cost-plywood`); Fabric sub-block (roll, hem, seam, stretch, grommet spacing, `#nb-cost-fabric`, `#nb-cost-grommet`); Tables sub-block (depth, thickness); visibility checkboxes + `#chk-cov-dims`; readout `#cov-readout`; `#btn-cov-cutfiles`, `#btn-cov-guide`.
8. **New `js/linkage/coverings-ui.js`** (imports `requestRender` from `./render-app.js` like `solar-panel-input.js`). Exports `initCoveringsUI`, `syncCoveringsUIFromState`, `renderCoveringRingPicker`, `updateCoveringsReadout`, `cycleSpanBand`, `setCoveringsPickMode`. Numeric binding copies `bindSupportBeamControl` (`ui-bindings.js:176`) but without `invalidateGeometryCache` (coverings are derived) and with `globalThis.scheduleAutoSave?.()`. Ring picker: inline SVG of N wedges placed by `azimuthDeg` in plan-view orientation, three concentric rings (Lower, Upper, Table), click cycles none→plywood→fabric, `data-span`/`data-band` attributes for tests, dashed disabled wedge when the ring is open. Mode hint for arch / fixed beams / open ring. Add to manifest before `render-app.js`... after `solar-panel-input.js`.
9. **`js/linkage/main.js`**: call `initCoveringsUI()` after `initUIBindings()`; hoist the `autoSave` closure (lines 151-166) and bridge it as `scheduleAutoSave`.
10. **`js/linkage/history.js`** `undo`/`redo`: add `globalThis.syncCoveringsUIFromState?.()` after the idMap sync.
11. **`js/linkage/state-sync.js`** `updateState('modules')` (~108): `resizeCoveringSpans(state.coverings, state.modules)` and re-render the picker (mirrors the `archWallFaces` reset).
12. **`js/linkage/config-persistence.js`**: `getConfigSnapshot` adds `coverings` (minus `pickMode`) and the costs; `applyV30Config` applies `normalizeCoverings` or resets to defaults when absent (supportBeams pattern at 321-332), then `resizeCoveringSpans`; `applyConfig` UI block (~1031) calls `syncCoveringsUIFromState()`.
13. **`js/core/project-store.js`**: add `'coverings'` to `LINKAGE_CONFIG_KEYS` (306-322).
14. **`css/sidebar.css`**: `.cov-ring-picker`, `.cov-wedge`, `.cov-legend`, quick-button row.
15. **Tests**: `tests/coverings-geometry.test.js` (closed 8-module state via `createTestState` + `getOptimalClosedAngleForAnimation` + `solveLinkage`: 8 uprights/spans, `closed`, planarity < 0.05", tilt ≈ 24.5°±3, full wall widths ≈ 96/66 ±6, lower band vertical height 48, taper symmetric, table inner < outer, `vStackCount 2` gives the same plane, open ring omits span 0, arch → unsupported, `resizeCoveringSpans` preserves). `tests/config-persistence.test.js` round trip + defaults when absent. `tests/project-store.test.js` key present. `tests/unit-converter.test.js` fraction cases.

### Phase 2: cut planning, SVG cut files, Build Guide, BOM, PDF, CSV

1. **New `js/linkage/sheet-nesting.js`**, **`js/linkage/fabric-patterns.js`**, **`js/core/svg-cut-file.js`** (`buildCutFileSvg` with 1 unit = 1 inch, `width="..in"`, dashed stock rects, piece paths, edge length + angle labels, cut marks, grommet circles, title block with design name, span, band, fold angle, date; `buildWallOverviewSvg(shape, nest)`; `svgForInline`), **`js/core/download.js`** (`downloadBlob`, `downloadText`; switch `gltf-export.js:645` to it). All in the manifest.
2. **New `js/linkage/coverings-plan.js`**: `computeCoveringCutPlan` (memoized) and `coveringBom(plan, state)` → rows for sheets, fabric yards, grommets, batten linear feet.
3. **`js/linkage/coverings-ui.js`**: `#btn-cov-cutfiles` downloads one SVG per wall/table/fabric band (staggered ≥150 ms); readout shows sheets, yards, cost from the plan.
4. **`js/linkage/build-guide.js`**:
   - `buildCoveringsGuideSectionHtml(data)` modelled on `buildElectricalGuideSectionHtml()` (line 122): cards "Wall Panels & Sheet Cuts" (per wall: span label, key-dims table, inline overview SVG, per-piece cut table with angles and marks in fractions, warnings), "Tables", "Fabric Panels" (panel table, hem/seam, grommets, yardage). Insert at ~1017. Stamp the fold angle and warn when it differs from `getOptimalClosedAngleForAnimation()` by > 0.5°.
   - Modal BOM (500-629): new ENCLOSURE section with `data-bom-state="costPlywoodSheet"` etc.; extend `recalcGuideBOM` (1688) and `gatherBOMData` (1753) with `enclosureItems`; `exportBOMcsv` (2621) ENCLOSURE block; `updateHUD` (`render-app.js:176`) includes the enclosure cost.
   - PDF `exportGuidePDF` (insert ~2482): vector drawings with `doc.line`/`doc.text`/`setLineDashPattern` plus autotable piece lists, using `checkPageBreak`.
5. **`css/linkage.css`**: `.guide-cut-svg`, `.guide-cut-table`, print `page-break-inside: avoid`.
6. **Tests**: `tests/sheet-nesting.test.js` (96×48 → one full sheet; 100×48 centered → two 50" pieces; sample trapezoid 101.8/86.4×48 → 2 landscape sheets whose outer pieces have one cut edge at ≈ 81°/99° with correct marks; utilization; auto orientation), `tests/fabric-patterns.test.js` (2 panels at 60" roll, hem bbox growth, 9 grommets on a 96" edge, 2% shrink), `tests/svg-cut-file.test.js` (parse with `DOMParser`, viewBox, inch units, one path per piece), `tests/coverings-plan.test.js` (memoization, BOM rows).

### Phase 3: build steps, 3D pick, dimension lines, polish

1. **`js/linkage/part-keys.js`**: add `'wall'` to `PART_KINDS`; `partKind` returns `'wall'` for `obj.type === 'covering'`; `partKey` = `wall:s{spanIndex}:{band}`; `describePart`, `selectorForPart`, `groupSelectorForPart`, `SELECTOR_FIELDS.wall = ['spanIndex','band','coverType','moduleIndex']`, `collectParts` pushes `data.coverings.shapes`, `partPoints` uses `slabCorners3D`.
2. **`js/linkage/build-steps.js`** `generateDefaultBuildSteps` (after the panels block ~890): `place` steps "Install lower wall panels", "Fit tables", "Hang lower fabric", "Install upper coverings", sequential radial approach.
3. **`js/linkage/build-steps-anim.js`**: `meshPartKey` handles `userData.covering`; `forEachPartMesh` iterates the wall/fabric/table groups. **`js/linkage/build-steps-ui.js`** `partObjectFromHit` returns `{kind:'wall'}` for covering meshes.
4. **3D pick mode** in `coverings-ui.js`: copy the click-vs-drag gate from `build-steps-ui.js:791-809`, raycast `coveringGroup`, hit `coveringPick` or `covering` → `cycleSpanBand` (Shift toggles the table), Escape exits, mutually exclusive with the build-steps picker, `cov-picking` cursor class on `#viewport`.
5. **Dimension lines**: hoist and export `createMeasurementLine3D` from `js/linkage/measurement-overlay.js:1159`; scene-render draws bottom width, top width and slant per visible shape into `coveringDimGroup` (under `structureGroup` so it rotates with the structure) when `showDimensions`, labels via `formatInchesFraction`.
6. **Polish**: hide coverings in hardware-detail mode and during build-step staging like IBC (`build-steps-anim.js:903/938`); README/docs note on the cut-file convention.
7. **Tests**: `tests/part-keys.test.js` wall cases; `tests/build-steps-generate.test.js` three place steps after the panel step; **e2e `e2e/coverings.spec.js`**: `installOfflineCdn`, `waitForAppReady`, enable coverings, click `.cov-wedge[data-span="1"][data-band="lower"]` → `state.coverings.spans[1].lower === 'plywood'`, click Enclose, open the guide and assert "Wall Panels & Sheet Cuts" and a `.guide-cut-svg` exist, reload and assert the autosaved spans restored.

## Risks and edge cases

- **Open ring / fold animation**: walls follow the uprights (dims change live); span 0 disappears when closure error > 1°. Guide and cut files stamp the fold angle and warn when it is not the deployed angle.
- **Non-coplanar guide lines** (`hobermanAng`/`pivotAng` ≠ 0): best-fit plane with a reported `planarityErrorIn`; side edges still follow the stack faces exactly.
- **Fixed beams / arch / array**: `supported=false` with a hint. Array mode is arch-only.
- **Module count change**: `resizeCoveringSpans` keeps selections by module index.
- **Bottom ring interference**: default `mount:'outside'` clears it; the `beam-protrudes` warning suggests a `bottomIn` value otherwise.
- **Split height vs sheet**: slant ≠ vertical height; "Fit split to one sheet" sets `splitHeightIn = bottomIn + min(sheet dims)·cos(tilt)`.
- **Performance**: `computeCoverings` is O(N) per render; nesting/fabric/SVG are memoized and only run for the readout, guide, and downloads.
- **Persistence**: old configs load defaults (disabled). Config golden fixtures snapshot solver metrics only, so they should not change; a changed golden is a regression.
- **Miter vs bevel**: taper angles are in-plane cuts (track saw). The bevel between neighbouring walls is `dihedral/2`, reported only; the guide notes that butt joints with a corner batten also work.

## Verification

1. `npm test`: all new unit tests pass; existing `config-golden`, `part-keys`, `build-steps-generate`, `config-persistence` unchanged.
2. `npm run test:e2e`: new `coverings.spec.js` plus `smoke`, `layout`, `project-roundtrip`.
3. Manual in the browser (`npm run serve`), default cylinder preset: enable Coverings → Enclose → 8 lower plywood walls + 8 upper fabric bands render, rotate with Structure Rotation, cast shadows; fold slider opens the ring → span 1 vanishes, others follow; Arch mode → hint only; back to cylinder → restored. Load the user's `StarShade_8m_Cylinder_12p_1c_2b.json` and confirm lower-band bottom width ≈ 96" and tilt ≈ 24.5°.
4. Readout: sheet count equals the sum of pieces; "Fit split to one sheet" yields one row of pieces per wall.
5. Build Guide: Wall Panels section present with inline SVGs; Export PDF shows vector wall drawings and the enclosure BOM; Export CSV has ENCLOSURE rows; editing a price in the guide updates state, the sidebar input, and the total.
6. Cut files: open a downloaded wall SVG in a browser or Inkscape: document size in inches, dashed 96×48 sheets, taper labels ≈ 81°/99° for the sample, marks in 1/16".
7. Build steps: Auto-generate → new place steps after the solar-panel step; playback slides walls in; 3D pick in the step editor selects a wall.
8. Save/load and undo/redo restore spans and refresh the ring picker; GLB export contains a `Coverings` group.
