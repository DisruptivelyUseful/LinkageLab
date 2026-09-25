# Hardware stacks (parts detail view)

The Hardware Assembly Detail view builds one "stack" of parts per axis of an
assembly (outer V-beam, inner V-beam, H-center, V-center). Since the stack
model v3 the layout is computed, not hand-placed. The engine lives in
`js/linkage/hw-stack-layout.js` (pure math, unit-tested in
`tests/hw-stack-layout.test.js`); `js/linkage/hardware-detail.js` adapts it to
the assembly axes and renders it.

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
2. **`gapBefore`** (inches, never negative) is the only positional input. A
   gap moves the part *and everything after it*. The Tighten button sets every
   gap on the assembly to 0.
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

Catalog parts keep their real dimensions; the check only warns.

### Interaction

- Drag a part along its axis (explode at 0) to change its gap; tiny gaps snap
  flush; dragging past a neighbour swaps their order. Drag the list grip to
  reorder or move between axes.
- Orbit and wheel-zoom freely; the look-at always tracks the assembly's
  bounding-box centre. **R** or Recenter returns to the head-on preset,
  **T** tightens.

### Migration from the old model (`stackModelV3`)

Old configs carried hand-tuned `posAssembled` / `posExploded` /
`qtyExplodeGap` offsets that compensated for the previous block-stacking
layout. On first load they are dropped (`gapBefore = 0` everywhere), the
bolt head side is inferred from the old order (outside when members preceded
the bolt and no nut followed), and `explodeGap` becomes 1.0 in. Re-enter any
deliberate spacing as a gap.
