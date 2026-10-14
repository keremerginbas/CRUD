FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.15.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY client ./client
COPY public ./public
COPY server ./server
COPY shared ./shared
COPY vite.config.ts tsconfig.json ./
COPY config ./config
RUN pnpm build
FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@10.15.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
ENV NODE_ENV=production
ENV XRE_DATA_DIR=/app/data
VOLUME ["/app/data"]
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
