# Thermaltrue WMS — Multi-stage Docker build
#
# NOTE: The API server (server.exe) is Windows-only due to windows-service crate.
# This Dockerfile builds the frontend for:
#   1. Tauri client bundling (CI/CD)
#   2. Standalone web preview via nginx (for development)
#
# For production, build server on Windows: cargo build -p server --release

# ── Stage 1: Frontend build ──
FROM node:20-alpine AS frontend-build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production web image ──
FROM nginx:alpine AS production

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
