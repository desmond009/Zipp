# ---- Build stage: install all deps, compile the API and bundle the React app ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm run build:web

# ---- Runtime stage: only production deps + compiled JS + static frontend (smaller, fewer CVEs) ----
# React, Vite etc. are devDependencies: they're needed to build the bundle, not to serve it.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
# Don't run as root inside the container.
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
