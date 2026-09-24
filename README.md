# LinkageLab
A solver for designing deployable structures with scissor linkages.


## Testing in the browser (no local checkout)

The app is static files, so GitHub Pages serves it directly from `main` with no build step:

- Site: https://disruptivelyuseful.github.io/LinkageLab/
- Enable once: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
- Every push to `main` is live about a minute later. Pages caches files for 10 minutes, so use a hard refresh (**Ctrl+Shift+R**, or DevTools → Network → *Disable cache*) to be sure you see the latest code.

Work on feature branches is fast-forwarded into `main` when it is ready to test.

## Running locally

```
npm ci
npm run serve          # http://localhost:8000  (use `node scripts/static-server.mjs --port 8765` if 8000 is blocked)
npm test               # vitest unit tests
npm run test:e2e       # Playwright end-to-end tests
```
