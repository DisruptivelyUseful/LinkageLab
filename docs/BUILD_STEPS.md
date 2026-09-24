# Build Steps

Build Steps turn a LinkageLab design into a step-by-step fabrication and assembly guide: an ordered list of steps, each with a saved camera view, optional notes and an animated operation, that plays back in the viewport and exports into the Build Guide, the PDF and a WebM video. The steps are saved with the design.

## Using it

Open the **Build Steps** group in the left sidebar.

| Control | What it does |
|---|---|
| **⚙ Auto** | Generates a complete sequence from the current design: cut steps (one per identical beam group, with stock length and offcut), drill steps (one per hole pattern, hole positions in the notes), then the assembly in shop order — *bottom ring with its brackets and pivot bolts → top ring built beside it as a mirror (parked on the ground) → V modules with their centre bolts → attach the V modules to the bottom ring → lift the top ring onto the V modules → secure the top brackets* — then a deploy step, support beams, reciprocal bolts and solar panels. Each per-module operation is emitted once per module and grouped. Existing steps are replaced after a confirmation. |
| **+ Step** | Adds an empty view step after the selected one. |
| **▶ Build Mode** | Enters playback: the viewport stages the assembly for the selected step and shows the transport bar. **Space** plays/pauses, **Esc** exits. |
| **🎬** | Plays the whole sequence once and downloads it as a WebM video. |

Drag the **⠿** grip to reorder steps; **⧉** duplicates and **✕** deletes. Click a step to edit it:

**Groups and repeats.** Operations that repeat once per module (set the bottom H-beams ×8, fit the brackets ×8, …) are *grouped*: adjacent steps sharing a group show a coloured rail and a `×N` badge on the first one. Auto creates these groups; to group by hand, Ctrl/Cmd-click or Shift-click adjacent steps and press **⧉ Group** (**Ungroup** dissolves). The **Repeats** selector chooses how a group plays:

- *First only + "Do this N×"* — only the first member animates, the caption says **Do this N×**, and playback jumps past the rest (their parts appear at once). Videos and PDFs stay short.
- *Fast-forward the rest* — every member animates, but members after the first run 4× faster, so you still get a sense of quantity.

Clicking any member in the list or the transport still plays it normally. The Build Guide and PDF list a group once with "Do this N×".

- **Kind** — *View* (camera only), *Place* (parts move into position), *Fasten* (bolts turn in, nuts thread on), *Cut* and *Drill* (workbench animations with a circular saw or a drill).
- **Parts in this step** — add targets with the picker (beams by stack type / module / layer / pattern, joints by module and ring, bolts, brackets, hardware assemblies, panels) or with **🎯 Pick in 3D** (click parts in the viewport, Shift-click for the whole stack or joint).
- **Camera view** — **Capture** saves the current camera and fold angle, **Auto-frame** frames the step's parts, **Go to** moves the camera there, **Clear** falls back to auto-framing at playback time.
- **Transition / Duration** — camera tween time and operation time in milliseconds.
- Kind-specific fields: stock length and kerf (cut), bit diameter (drill), approach direction and travel (place), turns and *All modules* (fasten).
- Place steps can *park* their parts: `op.parkOffset = { mode: 'beside' }` seats them on the ground beside the structure (used for the top ring built as a mirror), and a later place step with `op.from = 'parked'` lifts them into position. Fasten steps on hardware assemblies can name the assembly axes to turn (`op.axes`, e.g. `['down','up']` for the bracket-to-ring bolt, `['right','left']` for the V-stack bolts).
- **Notes / tips** — shown in the caption during playback and in the guide.

In playback, parts that a later *place* or *fasten* step introduces are hidden; the current step's parts are highlighted. Cut and drill steps hide the structure and show a workbench with one representative beam per group of identical beams (the caption lists the counts). Beams whose holes run through the width are laid on their side so every hole is drilled straight down.

The **Build Guide** (📋) gains an *Assembly Steps* card with a rendered thumbnail, summary and notes per step; **Export PDF** includes the same as an *Assembly Steps* section, and **🎬 Export Video** records the sequence.

## Data model

Steps live on `state.buildSteps` and are saved as the `buildSteps` key of the v30 config and of the project document (`LINKAGE_CONFIG_KEYS`). Loading a design always replaces the steps, so a design without steps never inherits stale ones. Playback state lives on `state.buildPlayback` and is never saved.

```js
{ id, title, notes, kind: 'view'|'place'|'fasten'|'cut'|'drill', stage: 'assembly'|'bench',
  targets: [selector...], view: { yaw, pitch, dist, panX, panY, anchor, foldAngleDeg } | null,
  transitionMs, durationMs, op: { ...kind specific }, groupId: string|null }
```

`buildSteps.settings = { repeatMode: 'skip'|'fast', fastFactor }` travels with the steps. Groups are runs of adjacent steps with the same `groupId`; `normalizeGroups` dissolves broken or singleton groups after every reorder or delete.

Targets are *selectors*, not object references, because the solver rebuilds every part on each solve. `js/linkage/part-keys.js` derives a deterministic key for every beam, bolt, washer, bracket and hardware placement from its semantic fields (module, stack type, layer, ring, role, ...) and matches selectors with wildcards, arrays and ranges. A *joint* selector matches everything at one pivot, including the hardware assembly placement that replaces the legacy bolts when Full Detail is on.

## Modules

| File | Role |
|---|---|
| `js/linkage/part-keys.js` | Stable part keys, joint keys, selectors, labels, bounds (pure). |
| `js/linkage/build-steps.js` | Step model, persistence helpers, view tweening, visibility map, bench planning, auto-generation (pure). |
| `js/linkage/build-steps-anim.js` | Playback engine: transitions, op-driver registry, scene staging hook, camera pinning (`state.cam.target`), `renderFrameOnly` frames. |
| `js/linkage/build-steps-ops.js` | Workbench scene, place / cut / drill drivers, saw and drill meshes. |
| `js/linkage/build-steps-fasten.js` | Fasten driver for legacy bolts and hardware-assembly bolt/nut pairs. |
| `js/linkage/build-steps-export.js` | Step thumbnails and WebM recording. |
| `js/linkage/build-steps-ui.js` | Sidebar list, editor, picker, transport bar, caption. |

Solver objects carry the identity fields the keys need (`layerIndex` on beams; `moduleIndex`, `ring`, `role` on bolts and washers; `pivotRole` on brackets; `ring` on placements; `arrayIndex` on array copies). Hardware part meshes carry `userData.build` with their axis and seated position so the fasten animation needs no layout re-derivation.

## Tests

- `tests/part-keys.test.js` — key uniqueness over real solver output and all presets, joint keys, selectors.
- `tests/build-steps.test.js` — model operations, views, visibility map, config round trip.
- `tests/build-steps-generate.test.js` — bench planning and auto-generation invariants.
- `e2e/build-steps.spec.js` — editor, reorder, persistence, playback staging, auto-generate, bench, place, pick, guide card and PDF export. Set `LINKAGE_E2E_CDN_DIR` to a directory holding the pinned npm packages to run it without CDN access (see `e2e/helpers/offline-cdn.js`).
