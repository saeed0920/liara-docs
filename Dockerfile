FROM docker-mirror.liara.ir/node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM docker-mirror.liara.ir/node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/validate-deployment-env.mjs ./scripts/validate-deployment-env.mjs

EXPOSE 3000
CMD ["sh", "-c", "node scripts/validate-deployment-env.mjs runtime && exec node server.js"]
