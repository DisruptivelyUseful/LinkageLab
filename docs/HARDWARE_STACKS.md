# Hardware stacks (parts detail view)

The Hardware Assembly Detail view builds one "stack" of parts per axis of an
assembly (outer V-beam, inner V-beam, H-center, V-center). Each axis starts
**auto** (parts sit flush, computed from their real dimensions) and becomes
**manual** as soon as you place a part by hand.

| File | Role |
|---|---|
| `js/linkage/hw-stack-layout.js` | pure 1-D layout engine: tight stacking, manual positions, fit check, explode (`tests/hw-stack-layout.test.js`, `tests/hw-snap.test.js`) |
| `js/linkage/hw-snap.js` | pure placement helpers: push-stacking, seat detent, snap targets, washers riding under a bolt head (`tests/hw-snap.test.js`, `tests/fasten-riders.test.js`) |
| `js/linkage/hardware-detail.js` | data model, migrations, axis adapter (`hwComputeAxisLayout`), manual-axis API, meshes, modal |
| `js/linkage/hw-detail-interaction.js` | picking, hover, drag, keyboard, snap ring / axis arrows / readout chip |
| `js/linkage/hw-detail-panel.js` | editor panel: axis sections and part cards |

## One axis

```
 datum (bracket wall / center pivot)
 │◄ wall ►│
 │        ├── member ──┬── member ─┬─ washer ┬─ nut ─┐          seq order →
 │        │  (beam)    │ (bushing  │         │       │
 │        │            │  inside)  │         │       │
 ▓▓▓▓ head│═════════════ shank ══════════════════════╡           bolt, head INSIDE
          │                                    head ▓▓▓▓         bolt, head OUTSIDE
          ╞═════════════ shank ═══════════════════════╡
```

Rules, in order of precedence:

1. **Members** (beam, washer, lock washer) and **hex nuts** stack flush in
   `seq` order from the datum. `qty` copies sit flush on each other.
2. **`gapBefore`** (inches, never negative) is the positional input on an
   auto axis. A gap moves the part *and everything after it*.
3. **Inserts** (bushing, rivet nut) sit inside the bore of the part laid just
   before them, flush with that part's outer face. Only a flange adds thickness.
4. **The bolt** never consumes stack thickness. `Head side` decides where it
   seats:
   - *Inside*: the head seats on the inner face of the datum wall and the
     shank runs outward through every part.
   - *Outside*: the head seats on the outermost face of the stack (whatever
     the bolt's position in the list) and the shank runs back through the
     stack and the wall.
   Only one bolt per axis is threaded through; extra bolts are laid out as
   spacers and flagged.
5. **Center axis** stacks straddle the bolt pivot; their thickness is the
   sandwich gap the structure solver uses (`hwGetAssemblySandwichGap`), plus
   any standoff on the two sandwich beams.

### Explode

Exploded positions keep the order and add a uniform per-assembly spacing
(`explodeGap`, the "Spacing" box in the header) between consecutive parts.
The bolt withdraws on its head side. Nothing per part to set.

### Fit check

`checkAxisFit` runs on every layout and shows badges on the part cards plus a
one-line summary per axis:

| code | level | meaning |
|---|---|---|
| `bolt-short` | warn | shank cannot reach through the last part / nut (+2 threads) |
| `bolt-long` | info | more than 0.5 in protrudes past the stack |
| `thread-short` | warn | thread length does not reach the nut |
| `hole-small` | warn | a part's bore is smaller than the bolt (5 mil tolerance) |
| `no-nut` / `no-bolt` | info | an inside-head bolt with no nut, or a nut with no bolt |
| `extra-bolt` | warn | a second bolt on the axis |
| `overlap` | info | two hand-placed parts overlap (allowed) |

Catalog parts keep their real dimensions; the check only warns.

### Hand placement (manual axes)

Placement is permissive: you have the final say, and physically impossible
states (overlaps, a washer inside a beam) are allowed and only noted.

- **Drag** a part along its axis in the view. The first hand edit on an auto
  axis stores every part's current start as `part.pos` (inches from the axis
  datum: bracket wall, centre-slot face or pivot) and sets
  `assembly.manualAxes[axis] = true`, so nothing jumps. From then on positions
  are free. Beams are structure: they keep their tight seat and cannot be
  dragged; their standoff stays a gap.
- **Push-stacking**: a moving part carries everything it runs into in the
  direction it moves. A bolt pushes with its head only (the shank passes
  through), so pushing an outer bolt inward collects the washers under it.
  Pushed parts are not pulled back. Hold **Ctrl** to slide through without
  pushing. Inserts (bushings, rivet nuts) ride with their host part.
- **Snap** (header button or **S**; hold **Alt** while dragging to invert): the
  dragged part is pulled, within about 10 px on screen, onto
  - the middle of the gap between two beams (e.g. a gap washer between the
    H-beams),
  - beam faces, the bracket wall and neighbouring parts (face to face),
  - a bolt's head underside or shank tip onto a face,
  - its own tight position.
  A ring and a label in the readout chip show the target.
- **Seat detent** (snap on): when a push would run a part past a beam or
  bracket face by up to ~3× the snap reach, the move stops with that part
  resting on the face; drag further to push through.
- **Keyboard** (selected part): arrows nudge 1/16 in (Shift 1/4, Alt 1/64,
  Ctrl = no push), Esc deselects, Delete removes, **R** recenters, **T**
  tightens.
- **Card fields**: auto axes show *Gap before*; manual axes show *Position*
  (from the datum). Each axis header shows Auto/Manual and, when manual, a
  *Tighten axis* button.
- **Tighten** (header, or **T**) returns every axis to auto: gaps to 0 and
  `pos` cleared. `seq` is never rewritten by hand placement, so Tighten goes
  back to the list order.
- Dragging while exploded collapses the view to assembled first. During a
  drag positions live in a preview (`hwDetail.preview`); only the focused
  instance is rebuilt per move and the result is committed on release as one
  undo step.
- Orbit and wheel-zoom freely; the look-at tracks the assembly's bounding-box
  centre. **R** or Recenter returns to the head-on preset.

### Build-step animation

Fasten steps drive bolts (and hex nuts) from backed-out to the seated
positions, which are the positions shown in the view, hand placement
included. Washers stacked directly under a bolt head ride in with it.

### Migration from the old model (`stackModelV3`)

Old configs carried hand-tuned `posAssembled` / `posExploded` /
`qtyExplodeGap` offsets that compensated for the previous block-stacking
layout. On first load they are dropped (`gapBefore = 0` everywhere), the
bolt head side is inferred from the old order (outside when members preceded
the bolt and no nut followed), and `explodeGap` becomes 1.0 in. Re-enter any
deliberate spacing as a gap.
