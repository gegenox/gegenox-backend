FROM node:lts-alpine AS builder

RUN apk add --no-cache openssl bash

WORKDIR /app

COPY package.json ./

# COPY prisma ./prisma
COPY . .

RUN npm install --frozen-lockfile 
COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
