# LinkageLab
A solver for designing deployable structures with scissor linkages.


## Testing in the browser (no local checkout)

The app is static files, so GitHub Pages serves it directly from `main` with no build step:

- Site: https://disruptivelyuseful.github.io/LinkageLab/
- Enable once: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
- Every push to `main` is live about a minute later. Pages caches files for 10 minutes, so use a hard refresh (**Ctrl+Shift+R**, or DevTools → Network → *Disable cache*) to be sure you see the latest code.

Work on feature branches is fast-forwarded into `main` when it is ready to test.

## One-click testing of a branch

Double-click **`dev-branch.bat`** (Windows) or run **`./dev-branch.sh`** (macOS/Linux) from your repo folder. It fetches and fast-forwards the branch named in `.dev-branch` (currently the Coverings feature branch), installs dependencies on the first run, opens http://localhost:8000 and serves the app. Edit `.dev-branch` to follow a different branch, or pass one as the first argument. It never discards local changes: if the working tree is dirty it stops and tells you. Hard-refresh (Ctrl+Shift+R) after each update so the browser drops its cached files.

## Running locally

```
npm ci
npm run serve          # http://localhost:8000  (use `node scripts/static-server.mjs --port 8765` if 8000 is blocked)
npm test               # vitest unit tests
npm run test:e2e       # Playwright end-to-end tests
```
