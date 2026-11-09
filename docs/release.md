# Cutting a release

The steps the maintainer runs to publish a Cellar version: the catalog release if the dataset changed, the multi-architecture image, and the GitHub release with `compose.yaml` and `openapi.json`. Run them from the repository root on a clean checkout of the commit being released.

The image path `ghcr.io/ul0gic/cellar` and the release URLs under `github.com/ul0gic/cellar` are the ones `compose.yaml`, the `Dockerfile` label and the default `CELLAR_CATALOG_URL` already use. If the publish location changes, change those three places first.

## Before you start

- Docker with `buildx`, signed in to the registry: `docker login ghcr.io`.
- The GitHub CLI signed in with permission to create releases: `gh auth status`.
- `pnpm install` done, and `pnpm typecheck`, `pnpm lint`, `pnpm build:frontend` and `pnpm openapi` passing on this commit.

In the steps, `1.0.0` stands for the version being released. Use the same value everywhere.

## 1. Bump the version

Set `"version"` to the new value in each workspace manifest:

```
package.json
backend/package.json
contract/package.json
catalog/package.json
frontend/package.json
tests/package.json
```

`backend/package.json` is the one Cellar reports: `cellar version`, the About screen and the startup log read it. `contract/package.json` sets the version in `openapi.json`. Commit the bump.

Confirm:

```sh
node backend/bin/cellar.ts version
```

```
Cellar 1.0.0 (node 26.13.0)
```

## 2. Publish the catalog release (only when the dataset changed)

Skip this step if `catalog/dataset/version.json` has the same `version` as the newest entry in the published `catalog-index.json`.

The image build packs the dataset into the image; the catalog release on GitHub is what running installs download when the owner checks for updates. Both come from the same `catalog/dataset/`, so publish the catalog for every dataset change before the image that ships it.

1. Build the release folder:

   ```sh
   pnpm catalog:build
   ```

   It writes `catalog/out/cellar-catalog-<version>/`, where `<version>` is the one in `catalog/dataset/version.json`. If that folder already exists it stops with exit 5; delete the folder, or run `node catalog/bin/cellar-catalog.ts build --out catalog/out --force`.

2. Download the published index and the previous release, and unpack it into `catalog/out/` (here the previous release is `2026.11.08-1`):

   ```sh
   gh release download catalog --pattern catalog-index.json --dir catalog/published
   gh release download catalog --pattern cellar-catalog-2026.11.08-1.zip --dir catalog/published
   unzip -qn catalog/published/cellar-catalog-2026.11.08-1.zip -d catalog/out
   ```

3. Pack the new release against it (here the new release is `2026.11.09-1`):

   ```sh
   node catalog/bin/cellar-catalog.ts pack catalog/out/cellar-catalog-2026.11.09-1 \
     --previous catalog/out/cellar-catalog-2026.11.08-1 \
     --index catalog/published/catalog-index.json \
     --base-url https://github.com/ul0gic/cellar/releases/download/catalog
   ```

   It writes `catalog/out/cellar-catalog-2026.11.09-1.zip` and a new `catalog/out/catalog-index.json` with the release added first. Exit 6 means the version isn't newer than the previous one or is already in the index: bump `version` in `catalog/dataset/version.json` and start again at 1.

   For the very first catalog release, pass `--first` instead of `--previous` and leave out `--index`.

4. Upload the zip first, then replace the index:

   ```sh
   gh release upload catalog catalog/out/cellar-catalog-2026.11.09-1.zip
   gh release upload catalog catalog/out/catalog-index.json --clobber
   ```

   In this order the index never lists a zip that isn't there yet. The `catalog` release is permanent and holds every zip; keep the older ones, since the index still lists them.

5. Delete `catalog/published/`.

## 3. Build and push the image

The image is built for linux/amd64 and linux/arm64 in one `buildx` run. Building arm64 on an amd64 machine needs QEMU and a `docker-container` builder; set them up once:

```sh
docker run --privileged --rm tonistiigi/binfmt --install arm64
docker buildx create --name cellar-release --driver docker-container --use
```

Build and push, tagging the full version, the minor line, the major line and `latest`:

```sh
VERSION=$(node -p "require('./backend/package.json').version")
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg CELLAR_VERSION="$VERSION" \
  -t ghcr.io/ul0gic/cellar:1.0.0 \
  -t ghcr.io/ul0gic/cellar:1.0 \
  -t ghcr.io/ul0gic/cellar:1 \
  -t ghcr.io/ul0gic/cellar:latest \
  --push .
```

`CELLAR_VERSION` sets the `org.opencontainers.image.version` label from `backend/package.json`. `compose.yaml` uses the major tag (`:1`), so installs pick up the release with `docker compose pull`.

Confirm both architectures and the version:

```sh
docker buildx imagetools inspect ghcr.io/ul0gic/cellar:1.0.0
docker run --rm ghcr.io/ul0gic/cellar:1.0.0 version
```

The first lists `linux/amd64` and `linux/arm64`; the second prints `Cellar 1.0.0 (node 26.13.0)`.

## 4. Generate openapi.json

```sh
pnpm openapi
pnpm exec validate-api contract/dist/openapi.json
```

`pnpm openapi` writes `contract/dist/openapi.json`.

## 5. Create the GitHub release

Tag the bumped commit and create the release with `compose.yaml` and `openapi.json` attached:

```sh
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 compose.yaml contract/dist/openapi.json --title "Cellar 1.0.0" --notes-file release-notes.md
```

Write this release's notes in `release-notes.md` first; keep it out of the commit. The install guide downloads `compose.yaml` from `releases/latest/download/compose.yaml`, so every release attaches it, and the release must be marked latest (the default for `gh release create`).

## 6. Check the published release

On a machine without the repository:

```sh
mkdir -p /tmp/cellar-release-check/data && cd /tmp/cellar-release-check
curl -fsSLO https://github.com/ul0gic/cellar/releases/latest/download/compose.yaml
docker compose up -d
docker logs cellar
```

The log ends with `Cellar 1.0.0 is ready on port 8080 at /`. Then `docker compose down` and delete the folder.

## If something goes wrong

- A pushed image is wrong: fix it, bump to the next patch version, and release again. Don't move an existing version tag; installs that pinned it expect it unchanged.
- The catalog index was replaced with a bad one: upload the previous `catalog-index.json` again with `--clobber`. Installs that already applied the bad release keep what it added; the next good release adds only what they don't hold.
