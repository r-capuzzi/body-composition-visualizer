# Body Composition Visualizer — frontend

React 19 + Vite SPA with a Three.js/React Three Fiber 3D avatar. Talks to the
FastAPI backend in `../backend` for the weekly projection; set `VITE_API_BASE`
(see `.env.example`) to point at a deployed backend instead of
`http://localhost:8000`.

## Scripts

- `npm run dev` — start the Vite dev server (port 3000; kept fixed so the
  backend's CORS allowlist matches — see `vite.config.js`).
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the `dist/` build locally to sanity-check it.
- `npm test` — run the Vitest suite once.
- `npm run test:watch` — run it in watch mode.

## Body model assets

`public/models/{male,female}.bin` are compact binaries built from MakeHuman
OBJ exports by `scripts/build-bodies.mjs`. Re-run it after re-exporting from
MakeHuman:

```bash
node scripts/build-bodies.mjs
```
