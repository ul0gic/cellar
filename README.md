# Cellar

Cellar is a self-hosted home-bar app for one household. It keeps cocktail recipes, the ingredients and the bottles on your shelf, and answers what you can make now, what one bottle would unlock, and what to buy. Each person keeps tasting notes, shared or private, plus favorites and a wishlist. A live menu shows on the living-room TV from a link. Backups restore in one step, and AI help is optional, with your own key.

It runs as one Docker container with one data folder, on your own network.

## Quick start

```sh
mkdir -p ~/cellar/data && cd ~/cellar
curl -fsSLO https://github.com/ul0gic/cellar/releases/latest/download/compose.yaml
docker compose up -d
```

Open `http://<this computer's address>:8080` and create the owner.

[docs/install.md](docs/install.md) covers HTTPS behind a proxy, upgrades and rollback, backup and restore, every setting and exit code, and the TV menu.

## Development

Requires Node 26.13.0 and pnpm 10. The workspace packages are `backend/` (the Fastify server and the `cellar` command), `frontend/` (the web app), `contract/` (the API in Zod, and the OpenAPI document generated from it) and `catalog/` (the recipe catalog builder).

```sh
pnpm install
pnpm typecheck        # tsc for every package
pnpm lint             # Biome, then light check on frontend/src
pnpm build:frontend   # Vite build of the web app
pnpm openapi          # writes contract/dist/openapi.json
pnpm catalog:build    # builds the catalog release into catalog/out
pnpm docker:build     # builds the image as cellar:dev
```

To run the server from source on port 8080, create its data folder and a shipped catalog first:

```sh
mkdir -p .rig/dev-data
node catalog/bin/cellar-catalog.ts build --out .rig/dev-catalog
CELLAR_SHIPPED_CATALOG_DIR=.rig/dev-catalog pnpm dev
curl -fsS http://localhost:8080/healthcheck
```

The development-only settings are listed at the end of [docs/install.md](docs/install.md#development-only). Releases are cut as described in [docs/release.md](docs/release.md).
