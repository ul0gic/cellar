# Cellar

A self-hosted home-bar app for one household. Cellar keeps your cocktail recipes, ingredients and the bottles on your shelf, and tells you what you can make now, what one more bottle would unlock, and what to buy. Everyone keeps their own tasting notes, favorites and wishlist. A live drinks menu shows on the living-room TV from a link.

It ships as one Docker image with everything inside, including a catalog of 663 cocktails, 296 ingredients and their photos. Nothing is downloaded when you set it up.

## Install

You need Docker with Compose v2 on linux/amd64 or linux/arm64.

```sh
mkdir -p ~/cellar/data && cd ~/cellar
curl -fsSLO https://github.com/ul0gic/cellar/releases/latest/download/compose.yaml
docker compose up -d
```

Open `http://<server address>:7380`, create the owner, and leave "Load the recipe book" on.

Create `data` yourself, as above: if Docker creates it, root owns it and Cellar can't write to it. Cellar runs as UID 1000; if your `id -u` is different, set the `user:` line in `compose.yaml`.

## Update

```sh
cd ~/cellar
docker compose pull && docker compose up -d
```

Cellar copies its database before any schema change.

## HTTPS

Put Cellar behind your reverse proxy at its own host name, forwarding to port `7380`, and uncomment `CELLAR_TRUSTED_PROXIES=private` in `compose.yaml`. Step-by-step setups for [Nginx Proxy Manager](docs/install.md#nginx-proxy-manager), [Caddy](docs/install.md#caddy), nginx and Traefik are in the install guide.

## More

[docs/install.md](docs/install.md) covers rollback, backup and restore, the TV menu, and every setting, command and exit code.

## Development

Requires Node 26.13.0 and pnpm 10.

```sh
pnpm install
pnpm typecheck        # tsc for every package
pnpm lint             # Biome, then light check
pnpm build:frontend   # the web app
pnpm openapi          # contract/dist/openapi.json
pnpm docker:build     # the image, as cellar:dev
```

Run the server from source on port 7380:

```sh
mkdir -p .rig/dev-data
node catalog/bin/cellar-catalog.ts build --out .rig/dev-catalog
CELLAR_DATA_DIR=.rig/dev-data CELLAR_SHIPPED_CATALOG_DIR=.rig/dev-catalog node backend/bin/cellar.ts serve
```

The packages are `backend/` (the server and the `cellar` command), `frontend/` (the web app), `contract/` (the API, defined once in Zod) and `catalog/` (the recipe catalog and its builder). See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change and [docs/release.md](docs/release.md) for how releases are cut.
