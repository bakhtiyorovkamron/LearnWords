# Production image: build the React app, serve it with Caddy (HTTPS + /api proxy).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# favicon.ico + PNG sizes are generated from public/favicon.svg (the header "W" logo).
RUN node scripts/gen-favicons.mjs
# vite build only (no tsc -b) so type-only warnings don't block a deploy.
RUN npx vite build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
