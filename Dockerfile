FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci


FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_CLOUDBASE_ENV_ID=shangmethod-poc-d7fuug6m5e37ad8d
ARG NEXT_PUBLIC_CLOUDBASE_REGION=ap-shanghai

ENV NEXT_PUBLIC_CLOUDBASE_ENV_ID=$NEXT_PUBLIC_CLOUDBASE_ENV_ID
ENV NEXT_PUBLIC_CLOUDBASE_REGION=$NEXT_PUBLIC_CLOUDBASE_REGION
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
