# Hardware Preset Library

This folder contains reusable hardware part presets for the **Hardware Assembly Detail** editor in LinkageLab.

## Files

### `registry.json`
Manifest listing all built-in presets. Each entry:

| Field | Description |
|-------|-------------|
| `id` | Unique preset ID (referenced by assembly parts as `presetId`) |
| `name` | Display name in preset dropdowns |
| `type` | Part type: `bolt`, `bushing`, `washer`, `lockWasher`, `nut`, `beam`, `bracket` |
| `file` | JSON filename in this folder |
| `link` | Optional product/reference URL |

### `*.json` preset files
Each preset file defines shared parameters for a hardware part:

```json
{
  "id": "washer-58-1316-inner",
  "name": "Inner Washer 5/8\"ID 1-5/16\"OD",
  "type": "washer",
  "label": "Inner Washer 5/8\"ID 1-5/16\"OD",
  "cost": 0.08,
  "link": "",
  "params": { "id": 0.625, "od": 1.3125, "thickness": 0.0625 },
  "extras": {}
}
```

- `params` — dimensions/settings passed to the mesh builder
- `extras` — optional non-param fields (`flipAxis`, `holeAlign`, `headAtInsert`, `syncStructure`)

## How It Works

- On load, the designer fetches `hardware/registry.json` and loads each preset file.
- The **Preset** dropdown on each part card lists:
  - **Built-in Library** — presets from this folder (shipped with GitHub Pages)
  - **From Assemblies** — unique parts used in any saved assembly
  - **My Presets** — presets saved in browser localStorage
- Selecting a preset applies shared label, cost, params, and links the part via `presetId` / `bomKey` so the BOM rolls up identical hardware across assemblies.
- If only one preset exists for a part type, it is applied automatically when adding a part.

## Adding a Preset to the Repository

1. In the Hardware Detail editor, configure a part and click **Save** on its preset row (or use **Save preset** in the toolbar).
2. Download the generated `.json` file into this `hardware/` folder.
3. Add an entry to `registry.json` with matching `id`, `name`, `type`, and `file`.
4. Commit and push — the preset is available to all users on GitHub Pages.

## Notes

- Presets must be served over HTTP(S) (`fetch`); use the included local server for development.
- User presets in localStorage are per-browser; built-in presets in this folder are shared for all users.
