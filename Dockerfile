FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM litestream/litestream:0.5.17 AS litestream

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist
# Litestream copia o SQLite para o Cloud Storage quando LITESTREAM_BUCKET está definido (deploy/iniciar.sh); os certificados
# são para ele falar HTTPS com o Google, porque a imagem slim do Node não os traz
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=litestream /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY deploy/litestream.yml /etc/litestream.yml
COPY deploy/iniciar.sh ./deploy/iniciar.sh

ENV PORT=8080
ENV DATABASE_FILE=/tmp/data/caixa.db
EXPOSE 8080
CMD ["sh", "deploy/iniciar.sh"]
