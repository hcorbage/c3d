# C3D STL Enhancer

## Overview

Professional 3D mesh repair and optimization tool. pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: bcryptjs + JWT (localStorage token, injected into all API calls via custom-fetch.ts)
- **Payments**: Stripe Checkout (standard SDK, no Replit-specific integration)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API, Vite for frontend)
- **Frontend**: React + Vite, Tailwind CSS, framer-motion, Three.js (@react-three/fiber)
- **Deployment**: Docker + nginx (see `docker-compose.prod.yml`)

## Features

### Mesh Enhancement Options
- **Fill Holes** — detects and closes open boundary edges (included in base credit)
- **Fix Normals** — recalculates inverted faces (included)
- **Remove Duplicates** — cleans zero-area triangles and overlapping vertices (included)
- **Laplacian Smoothing** — smooths rough edges (0–20 passes, included)
- **Merge Shells** — welds disconnected bodies into one solid (+1 credit)
- **Decimate** — reduces triangle count with voxel-grid clustering (+1 credit)
- **Resolve Intersections** — removes faces hidden inside other shells (+1 credit)
- **Quality Report Panel** — before/after stats, fixes applied, unit detection

### Credit System
- Base repair: 1 credit
- +1 for Merge Shells, +1 for Decimate, +1 for Resolve Intersections (max 4 credits/operation)
- Credit packages: 10=R$9.90 / 40=R$34.90 (Popular) / 100=R$79.90
- New users receive 3 free credits
- Admin user (`ADMIN_USERNAME`) has unlimited credits

### Auth
- JWT stored in localStorage
- Admin: `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars
- New user registration gives 3 free credits

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server listen port |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `ADMIN_USERNAME` | Admin login name (default: hcorbage) |
| `ADMIN_PASSWORD` | Admin login password |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── stl-enhancer/       # React + Vite frontend
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── nginx/nginx.conf         # nginx reverse-proxy config
├── Dockerfile.api           # API Docker build
├── Dockerfile.web           # Frontend Docker build (nginx static serve)
├── docker-compose.prod.yml  # Production orchestration
├── .env.example             # Environment variable template
├── deploy.sh                # VPS deployment helper script
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Deployment (Hostinger VPS)

1. Copy `.env.example` to `.env` and fill all values
2. Run `./deploy.sh` — builds images, runs migrations, starts services
3. App runs on port 80; use `certbot --nginx -d yourdomain.com` for HTTPS

nginx routes:
- `/api/*` → API server container (port 3001)
- `/*` → static frontend files with SPA fallback

## STL Processing Pipeline

`artifacts/api-server/src/lib/`:
- `stl-parser.ts` — binary/ASCII STL parse + write
- `stl-stats.ts` — triangle/vertex/shell/open-edge/manifold/unit stats
- `stl-enhance.ts` — remove duplicates, fix normals, Laplacian smoothing
- `stl-fill-holes.ts` — boundary edge detection + fan-fill
- `stl-shells.ts` — Union-Find shell detection + merge
- `stl-decimate.ts` — voxel-grid clustering decimation
- `stl-boolean.ts` — Möller-Trumbore ray-triangle intersection + centroid test to remove internal faces

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — CORS, JSON/urlencoded, routes at `/api`
- Routes: `src/routes/stl.ts` (enhance + stats), `src/routes/credits.ts`, `src/routes/auth.ts`
- Build: `pnpm --filter @workspace/api-server run build` → `dist/index.cjs`

### `artifacts/stl-enhancer` (`@workspace/stl-enhancer`)

React + Vite frontend. Bilingual (EN/PT-BR).

- `src/pages/Home.tsx` — main UI, all options, credit cost summary
- `src/components/QualityReportPanel.tsx` — before/after stats + fixes
- `src/components/CreditsModal.tsx` — credit purchase modal
- `src/i18n/translations.ts` — all UI strings in EN + PT-BR
- Vite build requires `PORT` and `BASE_PATH` env vars
- Build output: `dist/public/`

### `lib/db` (`@workspace/db`)

Drizzle ORM. Tables: `users`, `credit_transactions`.

- Push schema: `pnpm --filter @workspace/db run push`

### `lib/api-spec` / `lib/api-client-react` / `lib/api-zod`

OpenAPI spec, generated React Query hooks, generated Zod schemas.

- Regenerate: `pnpm --filter @workspace/api-spec run codegen`

### `scripts` (`@workspace/scripts`)

Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`.

## TypeScript Notes

- All packages use `composite: true` extending `tsconfig.base.json`
- Typecheck from root: `pnpm run typecheck`
- `emitDeclarationOnly` — JS bundling via esbuild/Vite, not tsc
- Use `bcryptjs` (NOT native `bcrypt`) for compatibility
- Drizzle atomic increments via `sql` template tag: `sql\`${table.col} + ${n}\``
