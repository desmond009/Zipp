# ---- Build stage: install all deps and compile TypeScript ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: only production deps + compiled JS (smaller, fewer CVEs) ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Don't run as root inside the container.
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
