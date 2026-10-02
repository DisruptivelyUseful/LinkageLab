# Actuation: deploying the ring with motors, actuators, cables and winches

> **Status:** landed. Engine `js/linkage/actuation.js`, sidebar group *Actuation*
> (`partials/linkage-controls-actuation.html`, `js/linkage/actuation-ui.js`), 3D drive
> (`js/linkage/actuation-render.js`), slotted track feet in the Floor group
> (`generateFloorTracks` in `js/linkage/floor-geometry.js`), Build Guide stats and a BOM
> line. Tests: `tests/actuation.test.js`, `tests/floor-geometry.test.js`,
> `e2e/actuation.spec.js`. Deferred: baking the drive hardware into the Deploy preview
> clip and the GLB export; arch (vertical) mode.

The old *Actuator Analysis* sidebar group was removed in commit `309a541`. Its maths
(`weight ÷ a scissor "mechanical advantage" × cos(angle)`) is gone too. The planner
described here replaces it with virtual work on the solved structure.

## 1. What moves when the ring deploys

One fold angle θ describes the whole structure. Each module is a plan-view scissor of two
H beams crossing at the module centre on the bottom ring and again on the top ring, with a
vertical X of uprights between the bottom pivots and the top pivots. The two bottom pivots
of a module are the **inner pivot** (`br`, shared with the next module) and the **outer
pivot** (`tr`). As θ grows:

- the plan **span** between the inner and outer pivot shrinks,
- the **height** grows (`h = √(V² − span²)`),
- the chain of modules **curls** until the ring closes at the deployed angle.

For the default preset (StarShade V1 SOAK 2026, 8 modules, 2×4 lumber):

| θ | span | height | span ÷ height |
|---|---|---|---|
| 6° packed | 92 in | 4 in | ≈ 20 |
| 30° | 89 in | 23 in | 3.8 |
| 90° | 66 in | 64 in | 1.0 |
| 134.9° deployed | 38 in | 84 in | 0.46 |

Two facts shape every drive choice:

1. **The ring is an open chain until the last few degrees.** The chain's module-to-module
   rotation only sums to 360° at the deployed angle, so the structure unfolds as a curling
   arc lying nearly flat, and a closing pin or latch joins the last inner pivot to the first
   once it arrives. The shared inner pivots force every module to the same height, so one
   angle still describes the chain and a drive on *some* modules moves all of them (the H
   beams carry the difference as bending about the shared pins; drive at least every other
   module).
2. **Very little weight is lifted, and only part of the structure rises.** The top ring and
   half the uprights rise with the roof: about 31 lb per module, 260 lb in total of a 520 lb
   structure. A full deploy is about **0.6 Wh** of lift. Energy is not the problem for
   solar; **peak force, stroke and the flat-start singularity** are.

## 2. Virtual work: how the planner estimates force

For any two points *A* and *B* that ride on the structure, with distance *L(θ)* between
them, and the structure's potential energy *U(θ) = Σ weight × height*:

    tension T(θ) = −(dU/dθ) ÷ (dL/dθ)

*T* > 0 means the drive must **pull** its ends together (a cable works), *T* < 0 means it
must **push** them apart (an actuator or lead screw). The planner samples ~25 fold angles
from the packed angle (`getEffectiveMinFoldAngle`) to the deployed angle, runs
`solveLinkage` at each, takes *U* from `calculateCenterOfMass` (panels optional, plus an
extra roof load), and differentiates numerically. Then per drive:

    force = |T| ÷ nDrives ÷ efficiency  +  μ · W_ground · |d(feet)/dθ| ÷ |dL/dθ| ÷ nDrives ÷ efficiency

The second term is the **feet drag**: the bottom ring slides on the ground as the chain
changes shape (measured relative to the structure's centroid), scaled by a friction
coefficient (0.05 for casters, 0.3 for wood skids on dirt). Pivot friction is the flat
efficiency factor. This is an estimate for motor selection, not a structural analysis: no
dynamics, wind, or uneven load sharing.

Outputs per placement: stroke and length range, mount points, the force curve (gravity and
drag separately), peak force and where it happens, packed and deployed force, a suggested
rating (peak × safety factor), the hand-over angle below which the drive exceeds its rating
and the kick-off helper that gets it there, energy per deploy (Wh), average and peak power
and current for the chosen deploy time and voltage.

## 3. Where force can be applied (the catalog)

Per-drive numbers below are for the default preset, frictionless, every module driven.

| Placement | Stroke | Force packed → deployed | Sense | Verdict |
|---|---|---|---|---|
| **Lead screw across the bottom H-scissor** (r = 24 in from the crossing, 4 in tabs) | ≈ 36 in | 74 → 100 lb, no spike | push | **Smoothest.** Flat gravity curve, ground level, self-locking. Short stroke magnifies feet drag near closure. |
| **Cable + winch along the radial floor track** (outer pivot → inner pivot) | 54 in | 790 → 14 lb | pull | **Cheapest.** 12 V winch per foot, gravity lowers it. Needs a kick-off helper or a packed angle ≥ 25–30°. |
| Lead screw / long actuator along the track | 54 in | same as the cable | push + pull | Self-locking, lowers under power; needs a 54 in stroke device. |
| Diagonal across the vertical X (A foot → B at 60 in) | 24 in | 920 → 70 lb | push | Classic scissor-lift cylinder; worst start-up spike. |
| Vertical jack, bottom → top pivot | 80 in | 31 lb flat | push | Force-ideal, stroke-absurd (comparison only). |
| Central mast, cables to the top ring | ≈ height | ≈ 31 lb per line | pull | One winch, but the mast must out-reach the roof and the ring centre wanders during the unfold. |

Why the H-scissor curve is flat: with same-side mounts at distance *r* from the crossing,
*L ≈ 2 r sin(θ/2)*, so *dL/dθ ≈ r cos(θ/2)*, which falls off at exactly the rate *dh/dθ*
does. The lever arm trades stroke for a force that barely changes from packed to deployed.
Tabs pointing away from each other give the packed clearance a real motor and nut need
(`L_packed = 2e`) at a small cost in flatness.

Why the span and X drives spike: near the packed state the uprights lie almost flat, so a
small change of span or of the X diagonal barely raises the roof (*dh/ds = −s/h → ∞*). The
same singularity a scissor lift has at its lowest position.

### Kick-off helpers (for the cable / track drives)

- **Gas springs or coil springs across each X**, charged when folded, carrying the roof
  the first few inches. The planner reports the hand-over angle and the equivalent lift
  per module they must supply.
- **Don't pack flat.** Set *Animation → Lowest fold angle* to 25–30°: the bundle grows to
  about two feet tall but the start-up pull drops from ~800 lb to ~150 lb.
- **A short kick actuator** between the track and an upright, or a cam under the inner
  pivot bolt, used only for the first few degrees.

## 4. A self-deploying solar structure

Recommended system (12 V, one battery, the circuit designer already models the storage):

1. **Drive:** one 12 V worm-gear motor turning an Acme or ball lead screw per module (or
   every other module), screw on a trunnion tab bolted through the bottom H stack of beam A
   at *r*, nut on a tab on beam B at *r*, tabs pointing apart. Worm gearing is self-locking,
   so the roof holds without power. Screw length ≈ stroke + nut + 6 in.
   *Alternative:* a 12 V ATV-class winch on the tail of each radial track beam pulling the
   inner pivot bolt along the slot, plus gas-spring kick-off; lower under the winch's
   dynamic brake.
2. **Synchronisation:** identical drives on one relay; the shared pivots keep the
   modules together, limit switches at both ends of every stroke, and a current-trip stops
   the lot if one module binds.
3. **Closing latch:** a spring pin at the last inner pivot that drops in when the ring
   closes, released by a lanyard to fold.
4. **Power:** the planner gives average and peak watts and amps for the chosen deploy
   time; a 60 s deploy of the default preset is tens of watts average and a few hundred
   watts peak, well inside a small battery and a 20–50 W panel.

## 5. Radial floor beams as slotted track feet

*Floor → Radial beams → Slotted track feet under the ring.* Each radial floor beam is
**pinned under its module's outer bottom pivot** and runs inward under the inner pivot,
whose bolt is extended down through a **slot** in the beam and retained by a plate washer
(a UHMW strip in the slot keeps it sliding). The beam sits a small clearance below the
bottom H stack, so it is the foot in contact with the ground, and it is drawn at every fold
angle (unlike the reciprocal floor beams, which appear with the raised floor).

- **Slot length** = the span travel from packed to deployed, measured from the pin; the
  readout gives both ends.
- **Swing:** with a 50 % pivot the inner pivot moves on a straight line from the outer
  pivot and the slot needs no swing. With the default 41 % pivot the line turns about
  19° over the deploy, so the beam pivots about its pin to follow (a single vertical bolt
  through the outer pivot does this).
- **Feet drag:** because the chain is open until it closes, the feet move relative to the
  structure's centre during the unfold. The readout gives the per-foot travel; let the
  feet skid or roll until the ring closes, then stake them.
- **Ground:** the live ground plane, the Deploy preview and the GLB lift all drop to the
  track's underside.
- The track drives (*cable + winch* and *lead screw along the track*) place their body on
  the beam's tail behind the pin and act on the slot bolt.

## 6. Code map

| Piece | Where |
|---|---|
| Chain frames and pivots at any angle (no solve) | `computeModuleFrames`, `computeModulePivots` in `js/linkage/joint-kinematics.js` |
| Ring vertical layout shared with the planner | `computeRingVerticalLayout` in `js/linkage/solver.js`; `solveLinkage` returns `frame` and `modulePivots` |
| Placement catalog, anchors, virtual-work engine, normalisation | `js/linkage/actuation.js` (`PLACEMENTS`, `evaluateAnchor`, `sampleDeploySweep`, `analyzePlacement`, `comparePlacements`) |
| Sidebar, readouts, sparkline, compare table | `js/linkage/actuation-ui.js`, `partials/linkage-controls-actuation.html` |
| 3D drive on every drive module and radial copy | `js/linkage/actuation-render.js` (into `threeRenderer.actuatorLineGroup`) |
| Track feet, slot, retaining bolt, readout | `generateFloorTracks`, `trackSpanRange`, `describeFloorTrack` in `js/linkage/floor-geometry.js`; ground in `applyTrackGround` (`linkage-geometry.js`) |
| Persistence | `state.actuation` (`config-persistence.js`, `LINKAGE_CONFIG_KEYS`), `floor.beams.radialMode` and track fields |
