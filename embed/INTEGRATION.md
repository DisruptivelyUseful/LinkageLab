# Embeddable Solar Schematics for Docusaurus

The Solar Circuit Designer can export **read-only, interactive schematics** for documentation. Viewers can pan, zoom, drag nodes for readability, and tap components to see specs — but cannot edit wiring or change the design.

## Quick workflow

1. **Design** your system in `solar_designer.html` (Build mode).
2. Click **📤 Embed** in the toolbar.
3. **Download JSON** and upload it to your Docusaurus `static/` folder (e.g. `static/schematics/my-system.json`).
4. **Copy the iframe code** and paste it into an MDX page.

## Docusaurus setup

### 1. Copy static assets

Copy these into your Docusaurus site (or host them on the same origin as your docs):

```
LinkageLab/
  solar_viewer.html      → static/solar/solar_viewer.html
  solar_designer.html    → static/solar/solar_designer.html
  css/                   → static/solar/css/
```

Or symlink / deploy the whole LinkageLab folder under `static/linkagelab/`.

### 2. Add schematic JSON

Place exported JSON in `static/schematics/`:

```
static/schematics/ecoworthy-sl3500.json
```

### 3. Embed in MDX

```mdx
import BrowserOnly from '@docusaurus/BrowserOnly';

<BrowserOnly>
  {() => (
    <iframe
      src="/solar/solar_viewer.html?config=/schematics/ecoworthy-sl3500.json&title=EcoWorthy%20SL3500%20System"
      title="EcoWorthy SL3500 System schematic"
      width="100%"
      height="640"
      style={{ border: 0, borderRadius: 8, background: '#0a1525' }}
      loading="lazy"
    />
  )}
</BrowserOnly>
```

### 4. Plain HTML (no MDX)

```html
<iframe
  src="/solar/solar_viewer.html?config=/schematics/ecoworthy-sl3500.json&title=My%20System"
  title="My System schematic"
  width="100%"
  height="640"
  style="border:0;border-radius:8px;background:#0a1525;"
  loading="lazy"
></iframe>
```

## URL parameters

| Parameter | Description |
|-----------|-------------|
| `config` | Path or URL to schematic JSON (required for remote embeds) |
| `title` | Display title in the embed toolbar |
| `embed=1` | Set automatically by `solar_viewer.html` |

## JSON format

```json
{
  "version": 1,
  "title": "EcoWorthy SL3500 System",
  "items": [ /* components */ ],
  "connections": [ /* wires */ ]
}
```

Export via **Save**, **📤 Embed → Download JSON**, or the designer’s embed dialog.

## Viewer capabilities

| Allowed | Blocked |
|---------|---------|
| Pan & zoom (mouse, touch, pinch) | Create/delete connections |
| Drag nodes (layout only, not saved) | Add/remove components |
| Select nodes → read-only stats panel | Edit inspector fields |
| System telemetry sidebar | Save, load, library, test mode |

## postMessage API (advanced)

If the parent page and iframe are **same-origin**, you can load a design dynamically:

```javascript
const iframe = document.querySelector('iframe');
iframe.addEventListener('load', () => {
  iframe.contentWindow.postMessage({
    type: 'solar-designer-load',
    payload: { items: [...], connections: [...], title: 'Live System' }
  }, '*');
});
```

The viewer posts `{ type: 'solar-designer-ready' }` when initialized.

## Local preview

```bash
# From LinkageLab root (e.g. start-server.bat on port 8000)
http://localhost:8000/solar_viewer.html?config=/path/to/your-export.json&title=Demo
```

## Troubleshooting

- **Blank canvas** — Check browser console; `config` path must be reachable from the iframe origin.
- **CORS errors** — Host JSON on the same domain as the viewer, or enable CORS on the JSON host.
- **Cross-origin localStorage** — Do not rely on `localStorage` from the parent page; use `?config=` or `postMessage`.
