FROM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild canvas --build-from-source
COPY tsconfig.json ./
COPY src ./src
COPY vendor ./vendor
RUN npm run build && node --input-type=module -e "await import('./dist/vendor/bgutil/session-manager.js')" && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4
RUN apt-get update && apt-get install -y --no-install-recommends libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/vendor ./vendor
USER node
ENV NODE_ENV=production AUTH_MODE=iam PORT=8080
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
