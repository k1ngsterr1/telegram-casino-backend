# =========================
# 1. Build stage
# =========================
FROM node:22-alpine AS builder

WORKDIR /app

# deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# source
COPY . .

# prisma + build
RUN yarn prisma generate
RUN yarn build


# =========================
# 2. Runtime stage
# =========================
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# просто копируем готовое окружение
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# Create uploads directory
RUN mkdir -p /app/uploads

EXPOSE 80
CMD ["node", "dist/src/main.js"]
