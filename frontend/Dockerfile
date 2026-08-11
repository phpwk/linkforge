# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: static bundle served by nginx, not the node build toolchain
FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-linkforge-config.sh
RUN chmod +x /docker-entrypoint.d/40-linkforge-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine already runs its worker processes as an unprivileged
# `nginx` user and exposes the standard docker-entrypoint.d hook
# mechanism used above — no need to hand-roll either.
EXPOSE 8080
