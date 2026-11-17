# The http-render website: static site plus the request relay, one small Node server.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @http-render/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/apps/web/dist-server ./dist-server
USER node
EXPOSE 8080
CMD ["node", "dist-server/server.js"]
