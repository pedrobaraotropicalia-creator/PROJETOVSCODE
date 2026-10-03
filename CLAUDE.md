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

Testes: `npm test` (vitest), só para as agregações do relatório (`client/src/relatorioDados.test.ts`). Não há linter nem script de typecheck. `npm run build` só faz typecheck do server (`server/tsconfig.json`); o client não tem `tsconfig` e o Vite não checa tipos. Para checar o client:

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
- Datas são gravadas em UTC (`CURRENT_TIMESTAMP`). O relatório agrupa por dia com `date(finalizado_em, '-3 hours')`, e o client formata em `America/Sao_Paulo`.
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
- Todo texto e valor digitado pelo usuário tem limite em `server/src/limites.ts` (nome, e-mail, senha em bytes, unidade, maquininha, motivo de saída, valores e quantidades). O server valida com o helper `texto()` do `server.ts` e o client importa o mesmo arquivo para o `maxLength` dos inputs; campo novo entra nos dois.
- Cada PUT troca só os filhos da própria etapa e chama `salvarTotal`, que usa `recalcularDiferencas` (`db.ts`), a única fonte das fórmulas (em SQL). Negativa = falta, positiva = sobra:
  - `diferenca_dinheiro = dinheiro_fisico - (saldo_inicial + entrada 'dinheiro' - total_saidas)` (quebra da gaveta);
  - `diferenca_cartoes = total_maquininhas - (total_entradas - entrada 'dinheiro')` (cartões, Pix e vales passam pelas maquininhas);
  - `diferenca` = soma das duas. Não use a total para decidir se o caixa bateu: falta num lado compensada por sobra no outro daria zero.
- "Bateu" (`client/src/quebra.ts`): quebra de dinheiro dentro da tolerância **e** cartões exatos (centavo). A tolerância (`tolerancia_dinheiro`) e o `fechamento_cego` ficam na tabela `configuracoes`, editadas só pelo dono (`GET/PUT /configuracoes`).
- **Fechamento cego** (ligado por padrão): para quem não confere (funcionário e admin com cargo Caixa), `ocultarDiferencas` remove `diferenca*` das respostas da API e `GET /configuracoes` devolve `ve_diferenca: false`. O client trata campo ausente como "oculto"; nunca recalcule a diferença no client a partir dos totais.
- `carregarEditavel` bloqueia a edição de caixa que não esteja `aberto` (409). Para editar, é preciso `/reabrir`.
- Status: `aberto` → `finalizado` → `conferido` (só o dono, via `/conferir`, que recusa caixa aberto). `/reabrir` volta para `aberto`.
- `finalizado_em` guarda a **primeira** finalização (`COALESCE`), então reabrir e finalizar de novo não muda o dia do caixa no faturamento. Caixas nunca finalizados ficam fora do faturamento.

### Client (`client/src/`)

- `api.ts` tem `request()` e `money()`. `datas.ts` concentra datas: exibição sempre `DD/MM/AAAA` e `HH:mm` em 24h no fuso de Brasília (`formatDate`, `formatDateTime`, `formatDay`). Entrada de data ou data e hora usa `DataInput` (`DataInput.tsx`: `react-datepicker` em pt-BR com máscara para digitar; `comHora` para DD/MM/AAAA HH:mm, 24h). Ele troca só texto; quem interpreta no horário de Brasília é `parseDate`/`parseDateTime`. Não use `<input type="date">`/`datetime-local`, que seguem o idioma do navegador (MM/DD, AM/PM). `CaixaEditor.tsx` é o editor em etapas, React puro: abre na primeira etapa obrigatória pendente e cada etapa salva e avança.
- **Padrão de select**: todo `<select>` usa o `<select>` nativo, estilizado globalmente em `styles.css` (seta própria, 44px de altura, estados de foco e desabilitado, placeholder `value=""` em cinza). Não crie dropdown customizado nem estilize select por tela. O cargo do usuário é um select com a lista fixa de `cargoOptions` (`App.tsx`), validada no server (`cargos` em `server.ts`; as duas listas precisam andar juntas). Um cargo antigo fora da lista continua válido para quem já o tem.
- **Seleção de várias unidades** usa `UnitMultiSelect` (`react-select`, menu fica aberto enquanto marca, renderizado em portal para não ser cortado por modal). Seleção de uma unidade só (ex.: abertura de caixa) continua no `<select>` nativo.
- **Modais**: ações no `.modal-footer` (rodapé fixo, alinhado à direita), botão secundário (`ghost`, ex.: Cancelar/Fechar) antes e ação principal por último. Exceção: na consulta do fechamento a conferência do dono (Conferido/Certo/Errado, botões compactos com `aria-pressed`) fica fixa à esquerda do rodapé; escolher outra decisão substitui a anterior e "Desfazer conferência" devolve o caixa para a fila (não há desmarcar clicando de novo). A consulta tem abas Resumo e uma por etapa (`EtapaSomenteLeitura` em `CaixaEditor.tsx`: mesmo visual do editor dentro de `<fieldset disabled>`, com as maquininhas gravadas no caixa, não as ativas da unidade).
- **Largura**: no desktop o conteúdo ocupa toda a largura ao lado do trilho do menu (`.content` sem `max-width`, coluna `minmax(0,1fr)` para conteúdo largo rolar dentro do próprio painel, como o calendário e os mapas de calor do relatório). Não ponha teto de largura em painel; limite só campos que não fazem sentido largos (ex.: valor em Configurações, 320px).
- **Ícones**: só Boxicons, pelo componente `<Icone nome="..." />` de `icones.tsx` (paths copiados de boxicons.com, sem dependência). Para ícone novo, acrescente o path em `caminhos`. Não use caracteres Unicode como ícone.
- **Toasts**: resultado de ação (salvo, excluído, cadastrado) e erro de ação em linha usam `toast.success`/`toast.error` do `sonner` (`<Toaster>` único em `main.tsx`, canto inferior direito). Erro de formulário continua no próprio formulário (`.alert`). Não crie mensagem de sucesso dentro do painel.
- **Texto livre em tabela/lista** (nome, e-mail, unidade): envolva em `.texto-livre`, que quebra em qualquer ponto e limita a largura, para um valor longo não alargar a tabela nem espremer as outras colunas.
- Menu lateral, padrão único (estado `menuAberto` em `App.tsx`, classe `.menu-aberto`): no desktop é sempre um trilho de 72px só com ícones, que abre por cima do conteúdo ao passar o mouse (120ms de atraso), receber foco ou ser tocado (o primeiro toque só abre), sem mover nada de lugar (só ganha largura e rótulos). No celular é a mesma gaveta, fora da tela até tocar no ☰ (`.menu-mobile`, no header). Fecha ao sair com o mouse, escolher um item, tocar fora (`.menu-fundo`) ou com Esc. Não há botão de fixar nem preferência salva. Cada botão do menu precisa de `title` (dica no trilho) e do formato `<Icone /><span>rótulo</span>`, porque o CSS esconde o `span` no trilho.
- **Relatórios** (menu, só dono): `Relatorios.tsx` tem os filtros (atalhos Hoje/7 dias/30 dias/Mês, período só com data, unidades; abre em 30 dias e recarrega sozinho) e as abas Resumo, Faturamento, Quebras e Dinheiro (`Relatorio*.tsx`, gráficos com `recharts`).
  - Dados: `GET /relatorios/caixas?de&ate&unidades` (exclusivo do dono) devolve uma linha por caixa já finalizado alguma vez, com entradas por forma, valores por maquininha e `dinheiro_anterior` (contado no caixa anterior da unidade). O client chama duas vezes, para o período e para o anterior de mesmo tamanho (`periodoAnterior`).
  - Toda agregação fica em `relatorioDados.ts` (funções puras, com testes). Faturamento = `total_entradas`. Quebra, divergência e "bateu" ignoram caixas reabertos (`status='aberto'`) e usam `quebra.ts`. Na cascata da gaveta, o saldo inicial não é somado: é o mesmo troco recontado a cada caixa.
  - Visual em `graficos.tsx`: cor fixa por unidade pela posição na lista completa (o filtro não repinta), legenda com texto em cor de texto, eixo de nomes mais estreito no celular (`useEixoDeNomes`). Mapa de calor e calendário são tabelas em CSS.
  - `troco_continua` (por unidade, editado na tela Unidades pelo dono): ligado quando o dinheiro contado no fechamento fica na gaveta para o caixa seguinte. Só nessas unidades a aba Dinheiro compara saldo inicial × contado no caixa anterior.
- Inputs de dinheiro usam `MoneyInput` (`inputs.tsx`) e as quantidades de cédulas usam `QuantityInput` (`react-number-format`, formato `R$ 4.500,40`, sem negativos). Use esses componentes em qualquer campo novo de valor.
- Caixas fechados tem as abas "Caixas" (lista) e "Por colaborador" (`ResumoColaboradores.tsx`: quebra por colaborador calculada no client sobre os caixas já filtrados; clicar num colaborador volta à lista filtrada por ele). As abas só aparecem para admin/dono que veem diferença. Filtros ficam em `passaNoFiltro` (`App.tsx`), comuns às duas abas: período (dia da finalização, ou da abertura se em aberto; vazio = todos), unidades, turno e responsável; situação e status valem só na lista, porque no resumo distorceriam a proporção de caixas que não bateram. Situação (bateu/não bateu/falta/sobra, ignorando caixas em aberto, cuja diferença é parcial), status e turno. O botão Excluir é do próprio `CloseTable` (`onDeleted`), por id; não volte a associar ações a linhas por índice.
- **Confirmações e avisos**: não use `window.confirm`/`alert`/`prompt`. Use `useDialogos()` (`dialogos.tsx`: `confirmar`, `avisar`, `pedirTexto`, todos retornam Promise), com `perigo: true` em ação destrutiva (botão vermelho e foco inicial em Cancelar). O `DialogosProvider` envolve o `Dashboard` em `App`. A mensagem deve dizer o que exatamente será afetado (nome, unidade, data).
- Exclusão é sempre o botão de lixeira (`row-action row-action-danger` com `<Icone nome="lixeira" />`, `title` e `aria-label` dizendo o que exclui), seguido do modal `confirmar` com `perigo: true`.
- Tabela de caixas (`CloseTable`): colunas de largura fixa (`.close-table`), coluna Ações com PDF para todos e lixeira só para o dono.
- Cadastro de maquininha usa o modal `MaquininhaForm` nos dois lugares (no editor ele fica fora do `<form>` da etapa, porque também é um `<form>`): etapa Maquininhas do caixa (unidade fixa) e tela Maquininhas (com seletor de unidade). O server aceita o cadastro de qualquer usuário vinculado à unidade; excluir é só admin e dono.
- PDF do caixa: `pdfCaixa.ts` (`jspdf` + `jspdf-autotable`), importado sob demanda pelo botão "Exportar PDF" do detalhe do caixa. Usa os dados de `GET /fechamentos/:id`, então respeita o fechamento cego. Textos passam por `texto()`/`valor()` porque a fonte padrão do jsPDF não cobre espaços Unicode.
- `VITE_API_URL` define a base da API; sem ele o client usa `/api` (o proxy do Vite em dev, a mesma origem em produção).

## Deploy

- `Dockerfile` multi-stage (Node 20), porta 8080, voltado para Cloud Run. No Cloud Run o SQLite fica em `/tmp` e é **perdido** a cada nova instância/revisão — o README recomenda migrar para Cloud SQL ou usar VM com disco persistente.
- O README descreve o deploy alternativo em VM (PM2 + Nginx + Certbot).
- `.env` e arquivos `*.db` não devem ser versionados (ver `.gitignore`).
