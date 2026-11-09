# Cutting a release

Releases are built and published by the Release workflow (`.github/workflows/release.yml`) when a version tag is pushed. It checks the code, publishes the recipe catalog if the dataset changed, builds the image natively for linux/amd64 and linux/arm64, pushes it to `ghcr.io/ul0gic/cellar` as `1.2.3`, `1.2`, `1` and `latest`, and creates the GitHub release with `compose.yaml` and `openapi.json` attached.

## Steps

1. Set `"version"` to the new value in every workspace manifest: `package.json`, `backend/package.json`, `contract/package.json`, `catalog/package.json`, `frontend/package.json`. `backend/package.json` is the one Cellar reports.
2. If the catalog dataset changed, bump `version` in `catalog/dataset/version.json` (for example `2026.11.09-1` to `2026.11.20-1`).
3. Commit, then tag and push:

   ```sh
   git tag v1.2.3
   git push origin main v1.2.3
   ```

4. Watch the run under Actions. The tag must match `backend/package.json`, or the workflow stops before publishing anything.

## First release only

GitHub creates the image package as private. After the first run, open the package (Profile, Packages, `cellar`), choose Package settings, and change its visibility to Public. Until then, `docker compose pull` fails for everyone but you.

## If something goes wrong

- A published image is wrong: fix it, bump the patch version, and release again. Never move or reuse a version tag.
- The catalog index is wrong: upload the previous `catalog-index.json` to the `catalog` release again with `gh release upload catalog catalog-index.json --clobber`.
- A run failed partway: delete the tag (`git push origin :v1.2.3`, `git tag -d v1.2.3`) and the release if one was created, fix the cause, and tag again.
