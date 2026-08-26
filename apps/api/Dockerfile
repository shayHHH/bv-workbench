# 构建上下文必须是仓库根目录：
#   docker build -f apps/api/Dockerfile -t bv-workbench-api .
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @bv/shared --workspace @bv/api --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @bv/shared && npm run build -w @bv/api

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./node_modules/@bv/shared/dist
COPY --from=build /repo/packages/shared/package.json ./node_modules/@bv/shared/package.json
COPY --from=build /repo/apps/api/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
