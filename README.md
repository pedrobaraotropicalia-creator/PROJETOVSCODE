# Fechamento de Caixa

Aplicacao web para controle de fechamento de caixa em rede de restaurantes. As unidades oficiais sao TERRA E MAR, RESTAURANTE E PIZZARIA, DELIVERY e DOCELATTO.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior

## Rodar localmente

```bash
npm install
copy .env.example .env
npm run dev
```

API: http://localhost:3000/api
Frontend: http://localhost:5173

Para preparar o usuario dono:

```bash
npx tsx server/src/seed.ts
```

A senha inicial do dono e `TroqueEssaSenha123`; altere-a apos o primeiro login.

## Producao

```bash
npm install
npm run build
npm start
```

Use um processo como PM2, Nginx e HTTPS (Certbot). Mantenha o arquivo SQLite em um disco persistente, por exemplo `/var/lib/fechamento-caixa/caixa.db`. Nunca versione `.env` ou o arquivo `.db`.

## Deploy no Google Cloud

1. Crie um projeto no Google Cloud, ative faturamento e Compute Engine API.
2. Crie uma VM Ubuntu `e2-small` e reserve IP estatico.
3. Instale Node.js 20+, Git, Nginx e PM2.
4. Clone o repositorio e execute `npm ci`, configure `.env`, crie a pasta persistente do SQLite e rode `npm run build`.
5. Inicie com `pm2 start server/dist/server.js --name fechamento-caixa` e `pm2 save`.
6. Configure Nginx como proxy para `localhost:3000`.
7. Libere somente TCP 80 e 443 no firewall.
8. Rode `sudo certbot --nginx -d seu-dominio.com` para HTTPS.
9. Para atualizar: `git pull`, `npm ci`, `npm run build` e `pm2 restart fechamento-caixa`.

Cloud Run nao deve usar SQLite no filesystem temporario. Para Cloud Run, migre o Prisma/SQLite para PostgreSQL no Cloud SQL ou monte armazenamento persistente com uma estrategia de bloqueio adequada.
