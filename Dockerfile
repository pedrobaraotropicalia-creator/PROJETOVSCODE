FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/dist/server.js"]
