FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci \
  && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
RUN npm run build -- --declaration false --declarationMap false --sourceMap false \
  && npm cache clean --force

FROM node:24-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -f package-lock.json

COPY --from=build /app/dist ./dist

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
