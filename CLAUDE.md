# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Aplicação de fechamento de caixa para uma rede de restaurantes (unidades oficiais: TERRA E MAR, RESTAURANTE E PIZZARIA, DELIVERY, DOCELATTO). Monorepo com um único `package.json`: API Express + SQLite em `server/`, SPA React + Vite em `client/`. Todo o domínio, mensagens de erro e UI estão em português.

## Comandos

```bash
npm install
cp .env.example .env
npm run dev          # API (tsx watch, PORT) + Vite (WEB_PORT, padrão 5173, com proxy /api -> PORT)
npm run server:seed  # cria/atualiza o usuário "dono" (exige ADMIN_EMAIL e ADMIN_PASSWORD)
npm run build        # tsc do server -> server/dist; vite build -> dist/client
npm start            # node server/dist/server.js (serve API e o SPA compilado)
```

Não há testes, linter nem script de typecheck. `npm run build` só faz typecheck do server (`server/tsconfig.json`); o client não tem `tsconfig` e o Vite não checa tipos.

Todas as dependências estão fixadas em `"latest"` no `package.json` — o `package-lock.json` é o que de fato define as versões.

`JWT_SECRET` e `ADMIN_EMAIL` são obrigatórios: o server lança erro na inicialização sem eles.

## Worktrees e preview (obrigatório em toda sessão)

Várias sessões trabalham ao mesmo tempo, cada uma na sua worktree em `.claude/worktrees/<nome>`. Cada worktree roda o próprio app, com banco e portas próprios.

**Ao terminar qualquer alteração, suba o app no painel do navegador e mostre a tela alterada, sem esperar o usuário pedir.**

Preparação (uma vez por worktree):
1. Crie um `.env` na raiz da worktree (ignorado pelo git) com `JWT_SECRET` aleatório, `ADMIN_EMAIL=dono@caixa.test` e `ADMIN_PASSWORD` aleatória. Não repita a senha no chat: ela fica só no `.env`.
2. `npm install` e `npm run server:seed`. O banco `./data/caixa.db` é relativo à worktree, então cada uma tem o seu.
3. Escolha duas portas livres (confira com `ss -ltn`) e crie `.claude/launch.json` (ignorado pelo git):
   ```json
   { "version": "0.0.1", "configurations": [ { "name": "<nome-da-worktree>", "runtimeExecutable": "env", "runtimeArgs": ["PORT=<api>", "WEB_PORT=<web>", "npm", "run", "dev"], "port": <web> } ] }
   ```
   `PORT` e `WEB_PORT` passados pelo ambiente têm prioridade sobre o `.env`.

A cada entrega: `npm run build` (typecheck do server), `preview_start` com o nome da worktree, login com o dono de teste do `.env` e navegação até a tela alterada. Para testar o perfil de funcionário, cadastre um usuário pela tela de login.

## Arquitetura

### Server (`server/src/`)

- `server.ts` contém **todas** as rotas em um único arquivo, com handlers escritos em uma linha cada. Não há camada de serviço/repositório: SQL direto via `better-sqlite3` (síncrono) dentro dos handlers.
- `db.ts` abre o banco e aplica o schema com `CREATE TABLE IF NOT EXISTS` a cada boot. Migrações são `ALTER TABLE ... ADD COLUMN` dentro de `try/catch` que ignora "coluna já existe". Também garante as unidades oficiais e desativa unidades legadas `UNIDADE N`. Caminho do banco: `DATABASE_FILE`, senão `/tmp/data/caixa.db` no Cloud Run (`K_SERVICE` definido), senão `./data/caixa.db`.
- Exclusões de unidades, maquininhas e usuários são lógicas (`ativo=0`); fechamentos são excluídos de fato (com `ON DELETE CASCADE` nos filhos).
- Datas são gravadas em UTC (`CURRENT_TIMESTAMP`). O dashboard de faturamento agrupa por dia com `date(..., '-3 hours')`, e o client formata em `America/Sao_Paulo`.
- Em produção o mesmo processo serve o SPA de `dist/client` (resolvido relativo a `__dirname`) com fallback para `index.html` em qualquer rota fora de `/api`.

### Autorização

- JWT (`Authorization: Bearer`, 8h), payload só com `sub`; o middleware `auth` recarrega o usuário do banco a cada requisição.
- Perfis (`tipo`): `funcionario`, `admin`, `dono`. O usuário cujo e-mail é igual a `ADMIN_EMAIL` é **sempre** tratado como `dono` por `publicUser`, independentemente do valor gravado.
- Existe uma segunda dimensão, `cargo` (texto livre). `isCaixaOnly`: usuário com cargo `Caixa` (não dono) só vê os próprios fechamentos, mesmo sendo `admin`.
- `allow(...roles)` restringe por `tipo`. Algumas rotas de escrita não usam `allow` e fazem a checagem de dono do registro dentro do handler.

### Fechamento de caixa

Cálculo feito no server em POST e PUT de `/api/fechamentos` (lógica duplicada nos dois handlers):

```
diferenca = dinheiro_fisico + total_maquininhas - (saldo_inicial + total_entradas - total_saidas)
```

O PUT apaga e reinsere todos os filhos (`entradas`, `detalhes_maquininha`, `saidas`, `contagens_dinheiro`). Status: `aberto` → `finalizado` (ao salvar) → `conferido` (por admin/dono via `/conferir`); `/reabrir` volta para `aberto`.

### Client (`client/src/`)

- `App.tsx` concentra quase todo o frontend. Boa parte do comportamento **não** está no JSX: há `useEffect`s que manipulam o DOM diretamente (injetam botões, o seletor de turno, o painel de contagem de cédulas, escondem campos por texto do label) e se comunicam por globais em `window`: `__editCloseId`, `__editingClose`, `__turno`, `__cashCounts`, `__showDelete`, `__showConsolidated`.
- Consequências não óbvias:
  - `request()` reescreve `POST /fechamentos` para `PUT /fechamentos/:id` quando `window.__editCloseId` está definido.
  - O turno é salvo por um `PATCH /fechamentos/:id/turno` separado, disparado dentro de `request()` após o POST.
  - `RevenueDashboard` é montado com um segundo `createRoot` num `div` injetado no DOM pelo botão de navegação criado via DOM (apenas para `dono`).
- Antes de alterar a UI, procure pelo seletor CSS/texto afetado em todo o `App.tsx`: mudar um label ou classe pode quebrar silenciosamente um `querySelector` em outro `useEffect`.
- `VITE_API_URL` define a base da API; sem ele o client usa `/api` (mesma origem, cenário de produção).

## Deploy

- `Dockerfile` multi-stage (Node 20), porta 8080, voltado para Cloud Run. No Cloud Run o SQLite fica em `/tmp` e é **perdido** a cada nova instância/revisão — o README recomenda migrar para Cloud SQL ou usar VM com disco persistente.
- O README descreve o deploy alternativo em VM (PM2 + Nginx + Certbot).
- `.env` e arquivos `*.db` não devem ser versionados (ver `.gitignore`).
