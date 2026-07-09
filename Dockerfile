# Thermaltrue WMS — Frontend build image
# Used for CI/CD to produce the production web assets bundled into Tauri
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image (optional: serve via nginx for web preview)
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
