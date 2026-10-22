# Proposta: Vouchers (vales consumo)

Situação: **fase 1 implementada** (cadastro e PDF, 22/10/2026; ver a seção Vouchers do `CLAUDE.md`). Fases 2 e 3 pendentes. Escrita em 22/10/2026 a partir do vale de exemplo enviado pelo cliente (Vale Consumo Terra & Mar Tropicalia de R$ 50,00, emitido pela sala de vendas Royal Prime).

Diferenças da implementação em relação ao texto abaixo: o nome do beneficiário ficou **obrigatório** (pedido do cliente), a validade padrão e as regras padrão ficam em `server/src/voucher.ts` (compartilhado com o client) e o valor também aparece em destaque na faixa do PDF.

## Objetivo

1. **Fase 1, Cadastro e PDF:** cadastro dos vales consumo das unidades (código, e-mail, validade, valor, observações), com a situação de cada um e o PDF do vale no modelo do exemplo.
2. **Fase 2, Resgate no caixa:** o operador lê ou digita o código do vale na etapa do caixa. O sistema valida, marca o vale como usado e lança o valor como forma de pagamento "Voucher" sem gerar falsa divergência de cartões.
3. **Fase 3, opcional:** relatório de cobrança por parceiro, emissão em lote, leitura do código pela câmera do celular e envio por e-mail.

A fase 1 funciona sozinha e já pode ir para produção. A fase 2 depende de respostas do cliente (ver [Decisões pendentes](#decisões-pendentes)).

---

## Leitura do vale de exemplo

O que o PDF precisa reproduzir, de cima para baixo:

| Bloco | No exemplo | De onde vem no sistema |
|---|---|---|
| Cabeçalho | Foto do salão em preto e branco com o logo "Tropicalia Terra & Mar" | Logo da unidade (`client/public/logo-terra-mar.png`) sobre uma faixa escura. A foto entra se o cliente mandar uma por unidade |
| Título | `VALE CONSUMO TERRA & MAR TROPICALIA R${$}50,00` | `VALE CONSUMO <UNIDADE> TROPICALIA R$ 50,00`. O `R${$}` do exemplo é um erro do gerador deles e não deve ser copiado |
| Código | `26102012112898123131519` (23 dígitos) | `vouchers.codigo` |
| Regras de uso | 5 itens: todos os dias, horário 11h às 23h, sem troco, validade de 7 dias, consumação única | Texto de regras da unidade + validade calculada ("Válido até 27/10/2026") |
| Identificação | Nome completo, e-mail, data, emissão, sala de vendas | Nome, e-mail, emissão, validade, origem |
| Endereço | "Avenida Aurora Forti Neves, 579 · Fone (17) 3281-8092" | Endereço e telefone da unidade (campos novos) |
| Código de barras | Barras do código | Code 128 desenhado no PDF |
| Assinatura | "Assinatura do Responsável" | Linha em branco para assinar |
| Rodapé | Logos do GR Group e de empreendimentos parceiros | Fica de fora na fase 1 (ver decisões) |

**Leitura do negócio:** o vale parece ser um brinde que a sala de vendas de um parceiro (GR Group / Royal Prime) entrega ao cliente dela, para consumir no restaurante. Depois o restaurante cobra o parceiro pelos vales usados. Se for isso, cada vale precisa guardar a **origem** (o parceiro), e os resgates precisam de um relatório por origem e período para a cobrança. Esse ponto precisa ser confirmado com o cliente.

---

## Fase 1: Cadastro e PDF

### Modelo de dados (`db.ts`)

```sql
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,              -- normalizado: sem espaços, maiúsculo
  unidade_id INTEGER NOT NULL REFERENCES unidades(id),
  valor REAL NOT NULL CHECK(valor > 0),
  email TEXT NOT NULL,
  nome TEXT NOT NULL,                       -- beneficiário (está no PDF do exemplo)
  origem TEXT,                              -- sala de vendas / parceiro (proposto)
  data_emissao TEXT NOT NULL,               -- AAAA-MM-DD, Brasília
  validade TEXT NOT NULL,                   -- AAAA-MM-DD, último dia em que vale (inclusive)
  observacoes TEXT,                         -- interno, não sai no PDF
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),  -- quem cadastrou
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ativo INTEGER NOT NULL DEFAULT 1,         -- 0 = cancelado (exclusão lógica)
  cancelado_por INTEGER REFERENCES usuarios(id),
  cancelado_em TEXT,
  motivo_cancelamento TEXT
);
CREATE INDEX IF NOT EXISTS vouchers_unidade ON vouchers(unidade_id, data_emissao);
```

Campos novos em `unidades`, pelo padrão `ALTER TABLE ... ADD COLUMN` em `try/catch`:

- `endereco TEXT` e `telefone TEXT`: rodapé do PDF ("É indispensável a apresentação deste").
- `regras_voucher TEXT`: uma regra por linha. Na criação da coluna, todas as unidades recebem o texto do exemplo, sem a linha da validade, que o PDF calcula:
  ```
  Utilização para todos os dias.
  Horário de atendimento das 11h às 23h.
  Não será devolvido troco em caso de não utilização total do voucher.
  Consumação única.
  ```

Os três campos são editados pelo dono no `UnidadeModal`, numa seção "Voucher", e entram no `fotoUnidade`.

**A situação é derivada e não fica gravada**, como o extrato do cofre:

| Situação | Regra |
|---|---|
| Cancelado | `ativo = 0` |
| Resgatado | existe vínculo com caixa (fase 2) |
| Vencido | `validade < hoje()` (dia de Brasília, o mesmo `hoje` do `server.ts`) |
| Disponível | os demais |

Assim, excluir um caixa ou estornar o resgate devolve o vale para Disponível (ou Vencido) sem nenhuma sincronização.

### Código do vale

- **Gerado pelo server** quando o campo vem vazio: 13 dígitos, 12 aleatórios (`crypto.randomInt`) e 1 dígito verificador (Luhn). Só números deixam o Code 128 curto (subconjunto C), e o verificador recusa erro de digitação no resgate antes de consultar o banco.
- **Digitado**, para cadastrar vales já impressos por outro sistema, como o do exemplo, de 23 dígitos: aceita letras, números e traço, normalizado (sem espaços, maiúsculo), até `limites.codigoVoucher`.
- Único na rede: código repetido devolve 409 com a unidade e a situação do vale existente.
- Não pode ser editado depois do resgate.

### Limites (`server/src/limites.ts`, usados pelo server e pelo client)

```ts
codigoVoucher: 40,
nomeBeneficiario: 80,
origemVoucher: 60,
observacaoVoucher: 500,
motivoCancelamento: 200,
enderecoUnidade: 120,
telefoneUnidade: 20,
regrasVoucher: 600,
// valor do vale: o mesmo limites.valor; e-mail: o mesmo limites.email
```

### Rotas (`server.ts`, uma linha por handler, zod, auditoria)

| Rota | Quem | Faz |
|---|---|---|
| `GET /api/vouchers?de&ate&unidades&situacao&busca` | admin (só unidades vinculadas) e dono | Lista com a situação calculada, o caixa do resgate (fase 2) e quem cadastrou. O período filtra pela emissão |
| `GET /api/vouchers/:id` | idem | Um vale, para o modal e o PDF (com endereço, telefone e regras da unidade) |
| `POST /api/vouchers` | idem | Cadastra. Código vazio = gerado. Emissão padrão = hoje, nunca futura. Validade padrão = emissão + 7 dias, nunca antes da emissão |
| `PATCH /api/vouchers/:id` | idem | Edita o que mudou. Depois do resgate, só e-mail, nome, origem e observações |
| `DELETE /api/vouchers/:id` | idem | Cancela (`ativo=0`) com motivo obrigatório. Vale resgatado: 409 "estorne o resgate no caixa #N antes" |
| `POST /api/vouchers/:id/reativar` | dono | Desfaz o cancelamento |

- Auditoria: `Entidade` ganha `'voucher'` e `auditoria.ts` ganha `fotoVoucher(id)` com Código, Unidade, Valor, E-mail, Beneficiário, Origem, Emissão, Validade, Observações, Situação (Disponível/Cancelado) e, na fase 2, Resgate ("Caixa #123 · TERRA E MAR · Almoço de 20/10/2026" ou "—"). O `unidadeId` vem do vale, então o admin vê só as unidades dele. Ações: "Cadastrou", "Alterou", "Cancelou" e "Reativou". O motivo do cancelamento entra na foto.
- `Auditoria.tsx`: rótulo "Voucher" no filtro de registro.

### Tela Vouchers (`client/src/Vouchers.tsx`)

- **Menu:** grupo OPERACIONAL, depois de Cofre (Visão geral, Caixas fechados, Cofre, Vouchers). Caminho `/vouchers` em `telas` (`App.tsx`), `perfis: ['admin', 'dono']`. Ícone novo em `icones.tsx`, com o path do Boxicons (sugestão: `bx-gift` ou `bx-purchase-tag`).
- **Cabeçalho:** eyebrow OPERACIONAL, título "Vouchers", botão "Novo voucher" (`<Icone nome="adicionar" />`).
- **Indicadores** do filtro aplicado: Disponíveis (quantidade e R$), Resgatados (quantidade e R$), Vencidos sem uso e Cancelados.
- **Filtros:** período de emissão com `DataInput` (abre no mês corrente, pelo `mesAtual`), unidades com `UnitMultiSelect`, situação em `<select>` nativo e busca livre por código, e-mail ou nome. "Limpar filtros" volta ao mês corrente.
- **Tabela** `tabela-cartoes`, paginada com `Paginacao` (50 por página) e contador "N vouchers":
  - `cartao-titulo`: Código, com dígitos tabulares.
  - `cartao-destaque`: Situação (chip) e Valor.
  - `cartao-meta`: Unidade · Emissão · Validade.
  - `cartao-campo`: Beneficiário (nome ou e-mail, em `.texto-livre`) e Origem.
  - `cartao-acoes`: PDF, lixeira "Cancelar voucher" (com `confirmar` + `perigo: true` e o motivo pedido por `pedirTexto`) e, no filtro Cancelados, "Reativar" (dono).
  - Linha clicável (`.clickable-row`) abre a edição. As ações fazem `stopPropagation`.
- **`VoucherModal`** (mesmo modal para criar e editar, ações no `.modal-footer`):
  - Unidade: `<select>` nativo, já escolhida para quem tem uma unidade só.
  - Código: vazio = "Gerado ao salvar".
  - Valor (`MoneyInput`), E-mail, Nome do beneficiário e Origem (com `<datalist>` das origens já usadas).
  - Emissão e Validade (`DataInput`). Ao mudar a emissão, a validade acompanha (+7 dias) até ser editada à mão.
  - Observações gerais (textarea, interno).
  - Rodapé: Cancelar (`ghost`) e, na criação, "Salvar e baixar PDF". Na edição, "PDF" e "Salvar".
  - Vale resgatado: aviso no topo "Resgatado no caixa #123 · TERRA E MAR · Almoço de 20/10/2026 por Fulano", com link que abre a consulta (`/caixas-fechados/:id`). Valor, unidade, código e datas ficam desabilitados.
- Resultado das ações em `toast.success`/`toast.error`. Erro de formulário em `.alert`.

### PDF do vale (`client/src/pdfVoucher.ts`, importado sob demanda como o `pdfCaixa.ts`)

A4 retrato com `jspdf`, mesma convenção de `texto()`/`valor()` do `pdfCaixa.ts` (espaços Unicode do `Intl`):

```
┌──────────────────────────────────────────────┐
│ ███ faixa grafite → vermelho queimado ███████ │  logo da unidade (branco) à esquerda
│ ███ (ou foto da unidade, se houver)   ███████ │
├──────────────────────────────────────────────┤
│ VALE CONSUMO TERRA E MAR TROPICALIA  R$ 50,00 │
│ 4829105537261                                 │
│                                               │
│ REGRAS DE USO:                                │
│ 1. Utilização para todos os dias.             │  regras da unidade, numeradas
│ 2. Horário de atendimento das 11h às 23h.     │
│ 3. Não será devolvido troco...                │
│ 4. Consumação única.                          │
│ 5. Válido até 27/10/2026.                     │  calculada
│                                               │
│ Nome completo: BRUNA ...                      │
│ E-mail: ...            Emissão: 20/10/2026    │
│ Sala de vendas: ROYAL PRIME                   │  só se houver origem
│                                               │
│ É indispensável a apresentação deste:         │
│ <endereço da unidade> · Fone: <telefone>      │
│ ║│║║│║│║║│║│║║│║  (Code 128)                  │      ______________________
│                                               │      Assinatura do responsável
│ Grupo Tropicalia                              │
└──────────────────────────────────────────────┘
```

- **Código de barras:** um encoder Code 128 próprio em `client/src/codigoBarras.ts` (tabela de 107 padrões, subconjunto C para códigos só com números e B para os demais), desenhado com `doc.rect`. Fica vetorial, nítido na impressão, sem dependência nova, no mesmo espírito do `icones.tsx`. Teste em vitest comparando com codificações de referência. Alternativa, se preferirem biblioteca: `jsbarcode` renderizando num canvas e `addImage`.
- **Logo:** os PNGs de `client/public` são carregados com `fetch` e convertidos em data URL antes do `addImage`. O `logo-terra-mar.png` e o `logo-restaurante-pizzaria.png` são brancos com fundo transparente e funcionam sobre a faixa escura. Os de fundo próprio (Delivery, Barão) entram como cartão.
- Nome do arquivo: `voucher-<codigo>.pdf`.

### Testes (`server/src/api.test.ts`)

- Cadastro com código gerado (13 dígitos, verificador válido) e com código digitado. Código repetido dá 409.
- Validade antes da emissão e emissão futura dão 400.
- Admin não vê nem cadastra vale de unidade não vinculada (403). Funcionário não acessa `/vouchers` (403).
- Cancelar e reativar, cada um com a linha de auditoria correspondente.
- Situação Vencido calculada pelo dia de Brasília.

---

## Fase 2: Resgate no caixa

### Como o vale entra no caixa

Proposta: uma forma de pagamento nova, **`voucher`**. O valor dela **não é digitado**: vem dos vales lidos na etapa Vouchers.

Hoje `diferenca_cartoes = total_maquininhas - (total_entradas - dinheiro)` supõe que tudo que não é dinheiro passa pela maquininha. O voucher não passa. Sem ajuste, cada vale resgatado viraria falta de cartões. As fórmulas de `recalcularDiferencas` (`db.ts`, a única fonte) passam a tirar o voucher como já tiram o dinheiro:

```sql
diferenca_dinheiro = dinheiro_fisico - (saldo_inicial + dinheiro - total_saidas)                  -- não muda
diferenca_cartoes  = total_maquininhas - (total_entradas - dinheiro - voucher)
diferenca          = dinheiro_fisico + total_maquininhas + voucher - (saldo_inicial + total_entradas - total_saidas)
```

Caixas antigos não têm entrada `voucher` (vale 0), então nada muda neles. O faturamento continua sendo `total_entradas`, com o voucher dentro. O cofre não muda, porque vale não é dinheiro em espécie.

### Modelo de dados

```sql
CREATE TABLE IF NOT EXISTS fechamento_vouchers (
  fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE,
  voucher_id INTEGER NOT NULL UNIQUE REFERENCES vouchers(id),  -- UNIQUE: um vale, um resgate, em toda a rede
  valor_utilizado REAL NOT NULL CHECK(valor_utilizado > 0),     -- até o valor do vale (sem troco)
  PRIMARY KEY (fechamento_id, voucher_id)
);
```

- O `UNIQUE(voucher_id)` resolve a concorrência: dois caixas abertos lendo o mesmo vale, e o segundo recebe 409.
- O `ON DELETE CASCADE` faz a exclusão do caixa liberar o vale, como o cofre já reflete exclusões.
- `valor_utilizado` cobre o consumo menor que o vale: o cliente perde a diferença (regra "sem troco"), e a entrada `voucher` do caixa é o que de fato pagou a conta. Fica igual ao valor do vale por padrão.

### Rotas

| Rota | Faz |
|---|---|
| `GET /api/vouchers/validar?codigo&fechamento_id` | Qualquer usuário que edita o caixa. Devolve só o necessário para conferir (código, valor, validade, nome do beneficiário), sem e-mail nem observações. Erros em português, dizendo o motivo: "Código não encontrado", "Dígito verificador inválido, confira o código", "Voucher vencido em 19/10/2026", "Voucher da unidade RESTAURANTE E PIZZARIA", "Voucher cancelado", "Já resgatado no caixa #123 (TERRA E MAR, Almoço de 20/10/2026)" |
| `PUT /api/fechamentos/:id/vouchers` | `{ vouchers: [{ voucher_id, valor_utilizado }] }`. Pelo `carregarEditavel`, só caixa aberto. Revalida tudo numa transação, troca os vínculos, grava a entrada `voucher` com a soma (ou apaga, se a lista vier vazia) e recalcula `total_entradas` e as diferenças |

Regras da validação:

- O vale precisa ser da mesma unidade do caixa e estar ativo.
- `validade >= data_caixa`. A comparação é com o **dia do caixa**, e não com hoje, porque o caixa de ontem fechado hoje aceita os vales que valiam ontem.
- `valor_utilizado <= valor`.

Ajustes nas rotas que já existem:

- `PUT /fechamentos/:id/entradas` hoje faz `DELETE FROM entradas WHERE fechamento_id=?`. Passa a preservar a linha `voucher` e a somá-la no total.
- `PUT /fechamentos/:id/abertura`: ao trocar de unidade, apaga também os vínculos de voucher e a entrada `voucher`, como já faz com as maquininhas. Mudar só a data não desfaz vínculos (a validade foi conferida no resgate).
- `DELETE /fechamentos/:id`: antes de excluir, tira a foto dos vales vinculados e registra o estorno de cada um na auditoria, porque o cascade sozinho não registraria.
- `fotoCaixa` ganha o campo "Vouchers" (`4829105537261 R$ 50,00; ...`) e "Entrada Voucher". Cada vale que entra ou sai do caixa também gera uma linha na auditoria do próprio vale ("Resgatou"/"Estornou"), pelo campo Resgate do `fotoVoucher`.

### Etapa Vouchers no editor (`CaixaEditor.tsx`)

- Etapa nova e opcional, como Saídas, entre Entradas e Maquininhas: `Abertura, Entradas, Vouchers, Maquininhas, Saídas, Contagem final, Revisão`. Ajustar `stepsDone`, `firstPendingStep` (obrigatórias continuam Entradas, Maquininhas e Contagem final) e `etapasConsulta`.
- Campo "Código do voucher" com foco automático. Leitor de código de barras USB funciona como teclado e manda Enter, então ler já valida e acrescenta à lista. No celular, `inputMode="numeric"`.
- A lista mostra código, beneficiário, validade, valor do vale e "Valor utilizado" (`MoneyInput`, até o valor do vale), com lixeira para tirar da lista antes de salvar. O total aparece embaixo. "Salvar e avançar", como as outras etapas.
- Entradas: a forma Voucher aparece só leitura ("R$ 100,00 em 2 vouchers, lidos na etapa Vouchers").
- Consulta do fechamento: aba Vouchers (`EtapaSomenteLeitura`) e a forma Voucher em "Entradas por forma de pagamento".
- `pdfCaixa.ts`: tabela "Vouchers resgatados" (código, beneficiário, valor utilizado).

### Outros pontos do client

- `formasPagamento` (`quebra.ts`), `formas` (`auditoria.ts`) e `formasPagamento` (`server.ts`) ganham `voucher: 'Voucher'`. No `entradasSchema`, a forma `voucher` é recusada, porque só a etapa Vouchers grava.
- Relatórios: o mix de pagamento e o faturamento passam a mostrar Voucher sozinhos (`relatorioDados.ts` itera `formasPagamento`). Conferir os testes de `relatorioDados.test.ts`.
- Tela Vouchers: a coluna Situação mostra "Resgatado · caixa #123", com link para a consulta.

### Testes

- Resgate válido: a entrada `voucher` é gravada, `total_entradas` sobe e `diferenca_cartoes` **não** muda.
- Vale de outra unidade, cancelado, vencido em relação ao `data_caixa` e já resgatado em outro caixa dão 409/400 com a mensagem certa.
- `valor_utilizado` acima do valor do vale dá 400.
- Salvar Entradas depois de Vouchers preserva a entrada `voucher`.
- Trocar a unidade na abertura limpa os vales. Excluir o caixa libera os vales e registra o estorno.
- Caixa finalizado recusa a etapa (409). Reabrir permite.

---

## Fase 3: opcional

- **Cobrança do parceiro:** na tela Vouchers, filtro por origem e "Exportar resgatados" (PDF/CSV com código, data do caixa, unidade, valor do vale e valor utilizado) para faturar o parceiro no período.
- **Emissão em lote:** "Gerar N vouchers" com a mesma unidade, valor, validade e origem, e um PDF com uma página por vale.
- **Câmera do celular:** leitura do código de barras na etapa Vouchers pela `BarcodeDetector` API (Chrome Android), sem biblioteca.
- **Envio por e-mail:** precisa de SMTP ou de um serviço de e-mail, configuração que o app não tem hoje.

---

## Decisões pendentes

Cada pergunta vem com a recomendação usada nesta proposta, que vale como padrão se o cliente não tiver preferência.

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Quem emite os vales no sistema: dono, admin da unidade, ou a equipe da sala de vendas do parceiro com acesso próprio? | Dono e admin das unidades vinculadas. Acesso para o parceiro fica para depois |
| 2 | O vale vale só na unidade impressa ou em qualquer unidade do grupo? | Só na unidade (o exemplo diz "Terra & Mar") |
| 3 | O restaurante cobra o parceiro pelos vales usados? Pelo valor do vale ou pelo consumido? | Guardar os dois (`valor` e `valor_utilizado`) e decidir no relatório da fase 3 |
| 4 | Como o PDV registra hoje o pagamento com vale? Existe forma "voucher" no relatório do sistema? | Se existir, avaliar uma conferência "vales lidos × voucher do PDV" (um terceiro tipo de diferença, mais trabalho). A proposta assume que não existe |
| 5 | Validade padrão de 7 dias contados da emissão, editável por vale? | Sim |
| 6 | Vale vencido no caixa: bloquear, ou deixar o dono/admin aceitar? | Bloquear. Quem quiser aceitar prorroga a validade no cadastro, e isso fica na auditoria |
| 7 | E-mail obrigatório? E o nome do beneficiário (está no exemplo, não na lista)? | **Decidido:** e-mail e nome obrigatórios |
| 8 | As observações saem no PDF? | Não, são internas |
| 9 | Logos do GR Group e dos parceiros no rodapé do PDF? | Não na fase 1. Se necessário, um logo por origem, enviado pelo cliente |
| 10 | Foto do salão no cabeçalho? | Só se o cliente mandar uma por unidade. Sem ela, faixa escura com o logo |
| 11 | Funcionário (cargo Caixa) pode cancelar vale? | Não, só admin e dono |

## Ordem sugerida de execução

1. Fase 1 inteira numa entrega: schema, limites, rotas, auditoria, campos novos da unidade, tela, modal, PDF com código de barras e testes.
2. Validar o PDF impresso com o cliente (tamanho do código de barras e leitura pelo leitor da loja).
3. Responder as decisões 3, 4 e 6 e só então executar a fase 2.
4. Atualizar o `CLAUDE.md` (seções Arquitetura, Fechamento de caixa, Auditoria e Client) a cada fase entregue.
