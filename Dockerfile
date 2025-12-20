# Base stage
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare yarn@stable --activate
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json yarn.lock* ./
RUN yarn install --immutable

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn prisma generate
RUN yarn build

# Production stage
FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["yarn", "start:prod"]
