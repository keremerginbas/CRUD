FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/app/data/santral.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY hatlar.csv ./
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/index.js"]
