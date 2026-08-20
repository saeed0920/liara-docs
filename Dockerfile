# 1) Build
FROM node:20-alpine AS builder

ARG MY_BASE_URL
ARG MY_API_KEY

ENV MY_BASE_URL=$MY_BASE_URL
ENV MY_API_KEY=$MY_API_KEY

WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile

COPY . /app/

# Build runs sitemap, models, prisma client, then the Next app.
RUN yarn build

# 2) Run — Next standalone Node server
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Standalone output bundles server + minimal node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma schema + generated engine for `migrate deploy` on start.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
