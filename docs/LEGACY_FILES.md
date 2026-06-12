# Legacy / Dead Files Inventory

Confirmed safe to remove after Phase 8 verification. **Do not delete until e2e passes.**

## Redirect stubs (keep until standalone URLs deprecated)

| File | Status |
|------|--------|
| `solar_designer.html` | Redirect → `index.html#/solar/design` (e2e tested) |
| `solar_simulator.html` | Standalone shell; unified app uses native mount after Phase 7 |

## Candidates for deletion

| File | Status |
|------|--------|
| `solar-builder.html` | **Deleted** (Phase 8) |
| `solar_viewer.html` | **Deleted** (Phase 8) |
| `cleanup-simulator-css.js` | **Deleted** (Phase 8) |
| `partials/linkage-solar-sidebar-palette.html` | Already absent |
| `partials/linkage-solar-sidebar-simulation.html` | Already absent |
| `partials/linkage-solar-sidebar-properties.html` | **Deleted** (Phase 8) |

## Duplication removed by refactor

| Location | Replaced by |
|----------|-------------|
| Inline `PANEL_PRESETS` / `BATTERY_PRESETS` in `solar_simulator.html` | `js/core/constants.js` |
| Inline `createPanel` etc. in `solar-designer.js` | `js/circuit/node-factory.js` |
| Inline wire path math in both files | `js/circuit/wire-renderer.js` |
| Inline `calculatePowerFlow` in designer | `js/circuit/power-flow.js` |
