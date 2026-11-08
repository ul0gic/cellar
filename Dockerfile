FROM node:26.13.0-trixie-slim AS build
RUN npm install -g pnpm@10.22.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/
COPY catalog/package.json catalog/
COPY contract/package.json contract/
COPY frontend/package.json frontend/
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:frontend
RUN node backend/scripts/licenses.ts
RUN node catalog/bin/cellar-catalog.ts build --out catalog/out
RUN pnpm deploy --legacy --prod --filter @cellar/backend /stage/backend \
  && chmod 0755 /stage/backend/bin/cellar.ts \
  && contract="$(readlink -f /stage/backend/node_modules/@cellar/contract)" \
  && mv "${contract}" /stage/contract \
  && ln -s "$(realpath --relative-to="$(dirname "${contract}")" /stage/contract)" "${contract}" \
  && ln -s "$(realpath --relative-to=/stage/contract "$(dirname "$(dirname "${contract}")")")" /stage/contract/node_modules

FROM node:26.13.0-trixie-slim AS final
ARG CELLAR_VERSION
LABEL org.opencontainers.image.version="${CELLAR_VERSION}" \
  org.opencontainers.image.source="https://github.com/ul0gic/cellar"
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
  && ln -s /app/backend/bin/cellar.ts /usr/local/bin/cellar
WORKDIR /app
COPY --from=build /stage /app
COPY --from=build /src/frontend/dist /app/frontend/dist
COPY --from=build /src/backend/generated/licenses.json /app/backend/generated/licenses.json
COPY --from=build /src/catalog/out/ /app/catalog/
ENV NODE_ENV=production CELLAR_SHIPPED_CATALOG_DIR=/app/catalog
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["cellar", "healthcheck"]
ENTRYPOINT ["cellar"]
CMD ["serve"]
