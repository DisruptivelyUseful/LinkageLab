# LinkageLab
A solver for designing deployable structures with scissor linkages.


## Testing in the browser (no local checkout)

The app is static files, so GitHub Pages serves it directly from `main` with no build step:

- Site: https://disruptivelyuseful.github.io/LinkageLab/
- Enable once: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
- Every push to `main` is live about a minute later. Pages caches files for 10 minutes, so use a hard refresh (**Ctrl+Shift+R**, or DevTools → Network → *Disable cache*) to be sure you see the latest code.

Work on feature branches is fast-forwarded into `main` when it is ready to test.

## Features worth knowing

- **Radial Array** (sidebar → Structure → Radial Array): repeat the whole structure around a central anchor — six hexagons around a seventh for a honeycomb, or N arches on radial planes for a toroid. See [docs/RADIAL_ARRAY.md](docs/RADIAL_ARRAY.md).
- **Coverings, Floor and Shade Tarps** (sidebar groups): plywood or tensioned-fabric bands between the uprights (with tables), reciprocal floor beams on the bottom ring under a plywood deck, and one rectangular shade tarp per module fanned over the roof, in any colour and opacity. Every spinbox there takes a wide range including negatives. See [docs/COVERINGS_PLAN.md](docs/COVERINGS_PLAN.md).

## One-click testing of a branch

Double-click **`dev-branch.bat`** (Windows) or run **`./dev-branch.sh`** (macOS/Linux) from your repo folder. It fetches and fast-forwards the branch named in `.dev-branch` (`main` by default), installs dependencies on the first run, opens http://localhost:8000 and serves the app. Edit `.dev-branch` to follow a different branch, or pass one as the first argument. It never discards local changes: if the working tree is dirty it stops and tells you. Hard-refresh (Ctrl+Shift+R) after each update so the browser drops its cached files.

## Running locally

```
npm ci
npm run serve          # http://localhost:8000  (use `node scripts/static-server.mjs --port 8765` if 8000 is blocked)
npm test               # vitest unit tests
npm run test:e2e       # Playwright end-to-end tests
```
