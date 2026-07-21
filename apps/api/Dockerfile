FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain ./packages/domain
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
# El prebuild de @finanzas/api genera Prisma Client antes de invocar tsc.
RUN pnpm --filter @finanzas/domain build && pnpm --filter @finanzas/api build

FROM node:24-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@finanzas/api", "start"]
