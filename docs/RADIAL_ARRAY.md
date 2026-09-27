# Radial Array

The **Radial Array** group (sidebar → Structure section) repeats the whole
designed structure around a central anchor point.

- **Horizontal (cylinder) structures** tile in the ground plane. Six 6-module
  hexagons around a seventh centre hexagon give a honeycomb.
- **Vertical (arch) structures** are placed on radial planes around the anchor
  so N arches sweep out a toroid (a bent tunnel). Combine it with the arch
  **Array Count** (linear tunnel) to get a segmented toroid: each tunnel
  segment becomes one copy.

## Controls

| Control | State key | Meaning |
|---|---|---|
| Enable Radial Array | `radialArrayEnabled` | Master switch. |
| Ring Count | `radialCount` | Copies placed around the anchor (1–12). |
| Structure at Center | `radialCenter` | Keep the original structure at the anchor (the 7th hexagon). |
| Rotate Copies | `radialRotateCopies` | Rotate each copy with its position on the ring. Off = translate only. Rotating is what makes a toroid; for a hexagon the two look the same. |
| Auto Ring Radius | `radialRadiusAuto` | Distance from anchor to each copy follows the structure footprint (below). Untick to type a radius; the box starts from the last auto value. |
| Ring Radius | `radialRadius` | Manual radius (inches internally, shown in the preferred unit). |
| Spacing Offset | `radialSpacing` | Added to the radius, auto or manual. Negative values overlap neighbours. |
| Start Angle | `radialStartAngle` | Rotates the whole pattern about the anchor. |
| Copy Spin | `radialSpin` | Extra rotation of every copy about its own axis. |
| Height Offset | `radialHeightOffset` | Raises or lowers the ring copies relative to the centre. |

### Auto radius

- Horizontal: the anchor is the ring's circumcentre (computed from three
  module centres, so it is valid at any fold angle). Copy 0 is placed against
  module 0's flat face at twice that face's reach from the centre, so
  neighbours share a face like honeycomb cells. The other copies follow at
  360°/N steps.
- Vertical: the anchor is the arch footprint centre. The radius is chosen so
  the inner feet of adjacent arches just meet:
  `radius = halfWidth + depth / (2·sin(π/N))`.

## Performance guard

While the array is active, **Full Detail** and **Shadows** are switched off
and their checkboxes are locked. They are restored when the array is disabled
again. Physics Check stays available because collisions are evaluated on the
single solver structure, which the array only copies. Press **F** (fit) to
back the camera off in proportion to the pattern.

## Where it lives

- `js/linkage/radial-array.js` — pure geometry: footprint analysis, slot
  planning and rigid cloning of beams, brackets, bolts, washers, hardware
  placements, support beams and panels. No DOM, no THREE.
- `js/linkage/linkage-geometry.js` → `buildLinkageGeometry()` applies it as
  the **last** assembly step, after the arch transform, the linear array,
  support / reciprocal beams and solar panels. The solver itself stays
  single-structure, so collision checks, reciprocal seeding and the golden
  metrics are unaffected. Exports, the BOM, build steps and the GLB all go
  through `buildLinkageGeometry`, so they include every copy.
- `js/linkage/radial-array-ui.js` — sidebar checkboxes, live readout and the
  performance guard. Numeric inputs use the regular `idMap` binding
  (`dom-setup.js`, `state-sync.js`), so validation, unit conversion and undo
  history come for free.
- Persistence: `mode.radialArray` in the v30 config
  (`config-persistence.js`). Older configs without it keep the current state.
- Every copy tags its parts with `arrayIndex = slot × linearCount + linearIndex`,
  so part keys (`part-keys.js`) stay unique and build steps can address a
  single copy.

Tests: `tests/radial-array.test.js` (geometry), `tests/config-persistence.test.js`
and `tests/part-keys.test.js` (round trip, unique keys), `e2e/radial-array.spec.js`
(sidebar, guard, toroid, save/load).
