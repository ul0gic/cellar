# Cutting a release

Merging a pull request into `main` is the release. Pull requests are the only gate: CI runs the checks and builds the image on each one, and `main` accepts only a branch that passed and is up to date. After the merge, the Release workflow (`.github/workflows/release.yml`) runs no checks; when `backend/package.json` carries a version that has no GitHub release yet, it publishes the recipe catalog if the dataset changed, builds the image natively for linux/amd64 and linux/arm64, pushes it to `ghcr.io/ul0gic/cellar` as `1.2.3`, `1.2`, `1` and `latest`, and creates the `v1.2.3` tag and GitHub release with `compose.yaml` and `openapi.json` attached. A merge that keeps the version publishes nothing.

## Steps

1. In the pull request, set `"version"` to the new value in every workspace manifest: `package.json`, `backend/package.json`, `contract/package.json`, `catalog/package.json`, `frontend/package.json`. `backend/package.json` is the one Cellar reports.
2. If the catalog dataset changed, bump `version` in `catalog/dataset/version.json` (for example `2026.11.09-1` to `2026.11.20-1`).
3. Merge the pull request once CI passes, then watch the Release run under Actions.

## First release only

GitHub creates the image package as private. After the first run, open the package (Profile, Packages, `cellar`), choose Package settings, and change its visibility to Public. Until then, `docker compose pull` fails for everyone but you.

## If something goes wrong

- A published image is wrong: fix it in a pull request that bumps the patch version. Never move or reuse a version tag.
- The catalog index is wrong: upload the previous `catalog-index.json` to the `catalog` release again with `gh release upload catalog catalog-index.json --clobber`.
- A run failed before the GitHub release was created: if the cause was transient, re-run the failed jobs under Actions; otherwise fix it in a pull request that keeps the version, and its merge publishes that version, which still has no release.
