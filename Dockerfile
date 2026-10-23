# Bedebestoon — single-service image: NestJS API serving the built web app.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
# Same-origin build: the web app must call the API on its own origin (empty base URL).
ENV VITE_API_URL=""
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
EXPOSE 3000
CMD ["sh", "-c", "DATABASE_URL=${DIRECT_DATABASE_URL:-$DATABASE_URL} npx prisma db push --schema apps/api/prisma/schema.prisma --skip-generate; node apps/api/dist/main.js"]
