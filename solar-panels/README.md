# Solar Panel Preset Library

Reusable solar panel specifications for the **Solar Panels** section in LinkageLab. Presets are synced from the Solar Designer component library (`js/core/constants.js` → `PANEL_PRESETS`).

## Files

### `registry.json`
Manifest of built-in panel presets shipped with GitHub Pages.

| Field | Description |
|-------|-------------|
| `id` | Unique preset ID (stored on `topPanels.presetId` / `sidePanels.presetId`) |
| `name` | Display name in the preset dropdown |
| `file` | JSON filename in this folder |
| `link` | Optional product/reference URL |

### `*.json` preset files
Each file defines dimensions, electrical specs, cost, and estimated weight:

```json
{
  "id": "generic-250w",
  "name": "Generic 250W",
  "wmp": 250,
  "vmp": 30.5,
  "voc": 37.5,
  "isc": 8.8,
  "imp": 8.2,
  "widthMm": 1650,
  "heightMm": 992,
  "panelWidthIn": 64.961,
  "panelLengthIn": 39.055,
  "panelThicknessIn": 1.5,
  "cost": 120,
  "weight": 45,
  "link": ""
}
```

## How It Works

- LinkageLab loads `solar-panels/registry.json` and each preset file (requires HTTP, not `file://`).
- **Top Panels** and **Side / Arch Panels** each have their own preset dropdown.
- Selecting a preset applies dimensions, electrical values, BOM cost, and weight.
- **Save** stores a custom preset in browser localStorage and downloads a JSON file for this folder.
- Add downloaded files + registry entries to git to share presets via GitHub Pages.

## Regenerating from Solar Designer

When `PANEL_PRESETS` in `js/core/constants.js` changes, regenerate this folder:

```bash
node scripts/generate-solar-panel-presets.cjs
```

Commit the updated JSON files and `registry.json`.
