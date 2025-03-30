FROM node:lts-alpine AS builder

RUN apk add --no-cache openssl bash

WORKDIR /app

COPY package.json ./

# COPY prisma ./prisma
COPY . .

RUN npm install --frozen-lockfile && \
  npm run build

COPY . .

EXPOSE 3001

CMD ["node", "build/shared/infra/http/server.js"]
