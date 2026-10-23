# --- Compilación: backend y página ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY . .
RUN npm run build && npm run build --prefix frontend

# --- Ejecución: solo dependencias de producción ---
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
# Aplica las migraciones pendientes y arranca. Si una falla, el servicio no sube.
CMD ["sh", "-c", "npx typeorm -d dist/database/data-source.js migration:run && node dist/main"]
