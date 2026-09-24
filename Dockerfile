# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-alpine
ENV NODE_ENV=production PORT=3002
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY db ./db
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["node", "dist/index.js"]
