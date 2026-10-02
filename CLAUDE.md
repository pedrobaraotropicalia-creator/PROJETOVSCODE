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

Não há testes, linter nem script de typecheck. `npm run build` só faz typecheck do server (`server/tsconfig.json`); o client não tem `tsconfig` e o Vite não checa tipos. Para checar o client:

```bash
cd client && npx tsc --noEmit --ignoreConfig --jsx react-jsx --strict --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --types vite/client src/*.tsx src/api.ts
```

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

A cada entrega: `npm run build` (typecheck do server), `preview_start` com o nome da worktree, login e navegação até a tela alterada. Para o perfil de funcionário, cadastre um usuário `@caixa.test` pela tela de login com uma senha gerada na própria sessão. No modo automático, ler a senha do dono no `.env` é bloqueado. Para testar como dono, suba uma instância à parte com banco descartável no scratchpad e credenciais de teste criadas na sessão: `env DATABASE_FILE=<scratchpad>/t.db JWT_SECRET=<teste> ADMIN_EMAIL=<teste>@caixa.test PORT=<api> WEB_PORT=<web> npm run dev`, depois `ADMIN_PASSWORD=<teste> npm run server:seed` com o mesmo `DATABASE_FILE`. As variáveis do ambiente têm prioridade sobre o `.env`. Derrube essa instância ao terminar.

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
- **Vínculo com unidades** (`usuario_unidades`, várias por usuário): funcionário e admin só enxergam e operam as unidades vinculadas (`GET /unidades`, maquininhas, caixas, abertura). O dono não tem restrição e é o único que altera vínculos (`PATCH /usuarios/:id` com `unidades`). Na criação da tabela, cada usuário foi vinculado às unidades onde já tinha caixa (`db.ts`, roda uma vez só).
- Só o dono confere caixas (`/conferir`) e acessa o faturamento. O admin é supervisor operacional: vê usuários (só leitura), maquininhas e caixas das próprias unidades.
- `allow(...roles)` restringe por `tipo`. As rotas de fechamento usam `podeEditar`: dono, admin sem cargo Caixa ou quem abriu o caixa. As respostas de `GET /fechamentos` e `GET /fechamentos/:id` trazem `pode_editar` já calculado para o client.

### Fechamento de caixa

O caixa é preenchido em etapas, salvas separadamente e em momentos diferentes:

| Etapa | Rota | Grava |
|---|---|---|
| Abertura | `POST /fechamentos` (cria), `PUT /fechamentos/:id/abertura` | unidade, turno, contagem → `saldo_inicial` |
| Entradas | `PUT /fechamentos/:id/entradas` | formas de pagamento fixas → `total_entradas` |
| Maquininhas | `PUT /fechamentos/:id/maquininhas` | só maquininhas ativas da unidade → `total_maquininhas` |
| Saídas | `PUT /fechamentos/:id/saidas` | `total_saidas` (opcional) |
| Contagem final | `PUT /fechamentos/:id/contagem-final` | contagem → `dinheiro_fisico` |
| Finalizar | `POST /fechamentos/:id/finalizar` | `status='finalizado'` |

- Os payloads são validados com zod. O error handler global converte `ZodError` em 400; não use `try/catch` por rota.
- Cada PUT troca só os filhos da própria etapa e chama `salvarTotal`, a única fonte da fórmula (em SQL): `diferenca = dinheiro_fisico + total_maquininhas - (saldo_inicial + total_entradas - total_saidas)`. Negativa = falta, positiva = sobra.
- `carregarEditavel` bloqueia a edição de caixa que não esteja `aberto` (409). Para editar, é preciso `/reabrir`.
- Status: `aberto` → `finalizado` → `conferido` (admin/dono via `/conferir`, que recusa caixa aberto). `/reabrir` volta para `aberto`.
- `finalizado_em` guarda a **primeira** finalização (`COALESCE`), então reabrir e finalizar de novo não muda o dia do caixa no faturamento. Caixas nunca finalizados ficam fora do faturamento.

### Client (`client/src/`)

- `api.ts` tem `request()` e `money()`. `datas.ts` concentra datas: exibição sempre `DD/MM/AAAA` e `HH:mm` em 24h no fuso de Brasília (`formatDate`, `formatDateTime`, `formatDay`). Entrada de data/hora usa texto com máscara (`PatternFormat`) + `parseDateTime`; não use `<input type="datetime-local">`, que mostra AM/PM conforme o idioma do navegador. `CaixaEditor.tsx` é o editor em etapas, React puro: abre na primeira etapa obrigatória pendente e cada etapa salva e avança.
- **Padrão de select**: todo `<select>` usa o `<select>` nativo, estilizado globalmente em `styles.css` (seta própria, 44px de altura, estados de foco e desabilitado, placeholder `value=""` em cinza). Não crie dropdown customizado nem estilize select por tela. O cargo do usuário é um select com a lista fixa de `cargoOptions` (`App.tsx`), validada no server (`cargos` em `server.ts`; as duas listas precisam andar juntas). Um cargo antigo fora da lista continua válido para quem já o tem.
- **Seleção de várias unidades** usa `UnitMultiSelect` (`react-select`, menu fica aberto enquanto marca, renderizado em portal para não ser cortado por modal). Seleção de uma unidade só (ex.: abertura de caixa) continua no `<select>` nativo.
- **Modais**: ações no `.modal-footer` (rodapé fixo, alinhado à direita), botão secundário (`ghost`, ex.: Cancelar/Fechar) antes e ação principal por último. Escolhas que fazem parte do conteúdo (ex.: Conferido/Certo/Errado) ficam no corpo.
- Menu lateral: recolhe para 72px só com os ícones (`.menu-recolhido`, preferência em `localStorage`, só no desktop); a data do dia fica abaixo do logo. Cada botão do menu precisa de `title` (vira a dica no modo recolhido) e do formato `ícone <span>rótulo</span>`, porque o CSS esconde o `span`.
- Inputs de dinheiro usam `MoneyInput` e as quantidades de cédulas usam `QuantityInput` (`react-number-format`, formato `R$ 4.500,40`, sem negativos). Use esses componentes em qualquer campo novo de valor.
- `App.tsx` ainda tem hacks de DOM fora do fluxo do caixa:
  - o botão "Consolidado" é injetado na `nav` e monta `RevenueDashboard` com um segundo `createRoot` (só para o dono);
  - os botões "Excluir" do histórico são injetados por índice de linha.
  - Antes de mudar classes ou textos, procure por `querySelector` que dependam deles.
- `VITE_API_URL` define a base da API; sem ele o client usa `/api` (o proxy do Vite em dev, a mesma origem em produção).

## Deploy

- `Dockerfile` multi-stage (Node 20), porta 8080, voltado para Cloud Run. No Cloud Run o SQLite fica em `/tmp` e é **perdido** a cada nova instância/revisão — o README recomenda migrar para Cloud SQL ou usar VM com disco persistente.
- O README descreve o deploy alternativo em VM (PM2 + Nginx + Certbot).
- `.env` e arquivos `*.db` não devem ser versionados (ver `.gitignore`).
