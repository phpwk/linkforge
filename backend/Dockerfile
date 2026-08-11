# syntax=docker/dockerfile:1

# ---- deps: install once, cached across builds as long as package*.json don't change
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime: minimal image, no build tools, non-root user
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged, non-login user rather than the node image's
# default root — matters when the K8s PodSecurityContext enforces
# runAsNonRoot (see deploy/k8s/base/backend-deployment.yaml).
RUN addgroup -S linkforge && adduser -S linkforge -G linkforge

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER linkforge
EXPOSE 8080

# Used by `docker run --health-cmd`/Compose; Kubernetes uses the
# /healthz and /readyz HTTP probes defined in the Deployment instead.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "require('http').get('http://localhost:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/app.js"]
