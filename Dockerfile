# ---- Build stage ----
FROM node:22-slim AS build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json .
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:22-slim AS runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

USER node

EXPOSE 3000
# Default entrypoint runs the API + listener; docker-compose overrides `command` to also
# run a dedicated consumer service.
CMD ["node", "dist/server.js"]
