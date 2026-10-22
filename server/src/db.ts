import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { regrasVoucherPadrao } from './voucher';

const file = process.env.DATABASE_FILE || (process.env.K_SERVICE ? '/tmp/data/caixa.db' : './data/caixa.db');
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
// caminho absoluto, o mesmo do deploy/litestream.yml, com que o app pede ao Litestream o envio de cada escrita (replicacao.ts)
export const arquivoBanco = path.resolve(file);
export const db = new Database(file);
db.pragma('foreign_keys = ON');
// WAL é exigido pelo Litestream, que no Cloud Run copia o banco para o Cloud Storage (deploy/iniciar.sh). Quando ele segura a trava
// num checkpoint, a escrita do app espera até 5 s (timeout padrão do better-sqlite3) em vez de falhar
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'funcionario', ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS unidades (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS maquininhas (id INTEGER PRIMARY KEY AUTOINCREMENT, unidade_id INTEGER NOT NULL REFERENCES unidades(id), nome TEXT NOT NULL, numero TEXT NOT NULL, numero_serie TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(unidade_id, numero_serie));
CREATE TABLE IF NOT EXISTS fechamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, unidade_id INTEGER NOT NULL REFERENCES unidades(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id), saldo_inicial REAL NOT NULL, dinheiro_fisico REAL NOT NULL DEFAULT 0, total_entradas REAL NOT NULL DEFAULT 0, total_maquininhas REAL NOT NULL DEFAULT 0, total_saidas REAL NOT NULL DEFAULT 0, diferenca REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'aberto', problema_resolvido INTEGER, conferido_por INTEGER REFERENCES usuarios(id), criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finalizado_em TEXT);
CREATE TABLE IF NOT EXISTS entradas (id INTEGER PRIMARY KEY AUTOINCREMENT, fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE, forma_pagamento TEXT NOT NULL, valor REAL NOT NULL DEFAULT 0, UNIQUE(fechamento_id, forma_pagamento));
CREATE TABLE IF NOT EXISTS detalhes_maquininha (id INTEGER PRIMARY KEY AUTOINCREMENT, fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE, maquininha_id INTEGER NOT NULL REFERENCES maquininhas(id), valor REAL NOT NULL DEFAULT 0, UNIQUE(fechamento_id, maquininha_id));
CREATE TABLE IF NOT EXISTS saidas (id INTEGER PRIMARY KEY AUTOINCREMENT, fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE, valor REAL NOT NULL, motivo TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contagens_dinheiro (id INTEGER PRIMARY KEY AUTOINCREMENT, fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE, etapa TEXT NOT NULL CHECK(etapa IN ('abertura', 'fechamento')), denominacao REAL NOT NULL, quantidade INTEGER NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, UNIQUE(fechamento_id, etapa, denominacao));
`);
try { db.exec("ALTER TABLE fechamentos ADD COLUMN turno TEXT NOT NULL DEFAULT 'ALMOÇO'"); } catch { /* coluna já existe */ }
try { db.exec('ALTER TABLE usuarios ADD COLUMN cargo TEXT'); } catch { /* coluna já existe */ }
// hash do código de primeiro acesso: preenchido enquanto o usuário cadastrado pelo dono não criou a senha (senha_hash fica '')
try { db.exec('ALTER TABLE usuarios ADD COLUMN codigo_acesso TEXT'); } catch { /* coluna já existe */ }
// ligado quando o dinheiro contado no fechamento fica na gaveta como troco do caixa seguinte da unidade
try { db.exec('ALTER TABLE unidades ADD COLUMN troco_continua INTEGER NOT NULL DEFAULT 0'); } catch { /* coluna já existe */ }
// valor de troco_continua da unidade quando o caixa foi finalizado; null nos caixas anteriores a esta coluna (o relatório usa o da unidade)
try { db.exec('ALTER TABLE fechamentos ADD COLUMN troco_continua INTEGER'); } catch { /* coluna já existe */ }
// dia do caixa (AAAA-MM-DD, Brasília) usado em relatórios, filtros e cofre: escolhido na abertura; os caixas anteriores à coluna ficam com o dia em que foram abertos
try { db.exec('ALTER TABLE fechamentos ADD COLUMN data_caixa TEXT'); } catch { /* coluna já existe */ }
db.exec("UPDATE fechamentos SET data_caixa=date(criado_em, '-3 hours') WHERE data_caixa IS NULL");

// Cofre: um por unidade, saldo em R$ do dinheiro em espécie. Só os lançamentos do dono são gravados aqui (valor positivo entra, negativo sai);
// a transferência grava as duas pontas com transferencia_id = id da ponta de origem
db.exec(`CREATE TABLE IF NOT EXISTS cofre_movimentacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, unidade_id INTEGER NOT NULL REFERENCES unidades(id), tipo TEXT NOT NULL CHECK(tipo IN ('transferencia','deposito_banco','pagamento_fornecedor','retirada_dono','aporte','ajuste','outros')), valor REAL NOT NULL CHECK(valor <> 0), data TEXT NOT NULL, observacao TEXT, transferencia_id INTEGER REFERENCES cofre_movimentacoes(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id), criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ativo INTEGER NOT NULL DEFAULT 1, excluido_por INTEGER REFERENCES usuarios(id), excluido_em TEXT)`);
// 1 quando o caixa movimenta o cofre: gravado na primeira finalização, então os caixas finalizados antes do cofre existir ficam null para sempre
try { db.exec('ALTER TABLE fechamentos ADD COLUMN movimenta_cofre INTEGER'); } catch { /* coluna já existe */ }
// os caixas não gravam movimentação: o extrato as deriva dos fechamentos (o caixa finalizado manda ao cofre o dinheiro contado e tira dele o saldo inicial),
// então reabrir, editar ou excluir o caixa já reflete no cofre
db.exec(`DROP VIEW IF EXISTS cofre_extrato;
CREATE VIEW cofre_extrato AS
  SELECT 'm' || id chave, id movimentacao_id, NULL fechamento_id, unidade_id, tipo, valor, data, observacao, transferencia_id, usuario_id, criado_em, ativo, excluido_por, excluido_em FROM cofre_movimentacoes
  UNION ALL
  SELECT 'e' || id, NULL, id, unidade_id, 'envio_caixa', dinheiro_fisico, data_caixa, NULL, NULL, usuario_id, finalizado_em, 1, NULL, NULL FROM fechamentos WHERE movimenta_cofre=1 AND status<>'aberto' AND dinheiro_fisico<>0
  UNION ALL
  SELECT 'r' || id, NULL, id, unidade_id, 'retirada_troco', -saldo_inicial, data_caixa, NULL, NULL, usuario_id, finalizado_em, 1, NULL, NULL FROM fechamentos WHERE movimenta_cofre=1 AND status<>'aberto' AND saldo_inicial<>0`);
// cédulas e moedas de cada lançamento do dono (quantidade sem sinal: o sentido é o do valor, que é a soma delas); a transferência grava as mesmas
// nas duas pontas. Os lançamentos anteriores a esta tabela ficam sem cédulas
db.exec('CREATE TABLE IF NOT EXISTS cofre_cedulas (movimentacao_id INTEGER NOT NULL REFERENCES cofre_movimentacoes(id), denominacao REAL NOT NULL, quantidade INTEGER NOT NULL CHECK(quantidade > 0), PRIMARY KEY (movimentacao_id, denominacao))');
// as cédulas de cada linha do cofre_extrato (mesma chave), com sinal: as dos lançamentos e as contagens dos caixas que movimentam o cofre
// (a do fechamento entra com o envio, a da abertura sai com a retirada para troco)
db.exec(`DROP VIEW IF EXISTS cofre_extrato_cedulas;
CREATE VIEW cofre_extrato_cedulas AS
  SELECT 'm' || m.id chave, m.unidade_id, m.tipo, m.data, m.ativo, c.denominacao, CASE WHEN m.valor < 0 THEN -c.quantidade ELSE c.quantidade END quantidade FROM cofre_cedulas c JOIN cofre_movimentacoes m ON m.id=c.movimentacao_id
  UNION ALL
  SELECT CASE c.etapa WHEN 'fechamento' THEN 'e' ELSE 'r' END || f.id, f.unidade_id, CASE c.etapa WHEN 'fechamento' THEN 'envio_caixa' ELSE 'retirada_troco' END, f.data_caixa, 1, c.denominacao, CASE c.etapa WHEN 'fechamento' THEN c.quantidade ELSE -c.quantidade END
  FROM contagens_dinheiro c JOIN fechamentos f ON f.id=c.fechamento_id WHERE f.movimenta_cofre=1 AND f.status<>'aberto' AND c.quantidade<>0`);
// na criação da tabela, cada usuário é vinculado às unidades onde já registrou caixa; depois disso só o dono altera os vínculos
const vinculosNovos = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usuario_unidades'").get();
db.transaction(() => {
  db.exec('CREATE TABLE IF NOT EXISTS usuario_unidades (usuario_id INTEGER NOT NULL REFERENCES usuarios(id), unidade_id INTEGER NOT NULL REFERENCES unidades(id), PRIMARY KEY (usuario_id, unidade_id))');
  if (vinculosNovos) db.exec('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) SELECT DISTINCT usuario_id, unidade_id FROM fechamentos');
})();
// motivos de saída da gaveta, uma lista para a rede; a saída guarda o id, então renomear corrige também os caixas antigos.
// As saídas anteriores à lista ficam com motivo_id null e o texto livre em saidas.motivo; nas novas saidas.motivo fica ''
const motivosNovos = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='motivos_saida'").get();
db.transaction(() => {
  db.exec('CREATE TABLE IF NOT EXISTS motivos_saida (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE COLLATE NOCASE, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  if (motivosNovos) ['Pagamento a fornecedor', 'Compra de mercadoria', 'Adiantamento a funcionário', 'Entrega (motoboy)', 'Outros'].forEach((nome) => db.prepare('INSERT INTO motivos_saida (nome) VALUES (?)').run(nome));
})();
try { db.exec('ALTER TABLE saidas ADD COLUMN motivo_id INTEGER REFERENCES motivos_saida(id)'); } catch { /* coluna já existe */ }
try { db.exec('ALTER TABLE saidas ADD COLUMN observacao TEXT'); } catch { /* coluna já existe */ }

// a diferença total se divide em quebra de dinheiro (gaveta) e divergência de cartões/Pix (maquininhas × entradas que não são dinheiro)
const entradaDinheiro = "COALESCE((SELECT valor FROM entradas e WHERE e.fechamento_id=fechamentos.id AND e.forma_pagamento='dinheiro'), 0)";
const recalcularDiferencasSql = `UPDATE fechamentos SET
  diferenca_dinheiro = ROUND(dinheiro_fisico - (saldo_inicial + ${entradaDinheiro} - total_saidas), 2),
  diferenca_cartoes = ROUND(total_maquininhas - (total_entradas - ${entradaDinheiro}), 2),
  diferenca = ROUND(dinheiro_fisico + total_maquininhas - (saldo_inicial + total_entradas - total_saidas), 2)`;
const colunasFechamento = (db.prepare('PRAGMA table_info(fechamentos)').all() as { name: string }[]).map((coluna) => coluna.name);
if (!colunasFechamento.includes('diferenca_dinheiro')) db.transaction(() => {
  db.exec('ALTER TABLE fechamentos ADD COLUMN diferenca_dinheiro REAL NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE fechamentos ADD COLUMN diferenca_cartoes REAL NOT NULL DEFAULT 0');
  db.exec(recalcularDiferencasSql);
})();
// auditoria: cada alteração feita pelas rotas (auditoria.ts), com quem, quando, o registro e o de/para dos campos que mudaram (JSON)
db.exec(`CREATE TABLE IF NOT EXISTS auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), entidade TEXT NOT NULL, entidade_id INTEGER, acao TEXT NOT NULL, descricao TEXT NOT NULL, alteracoes TEXT NOT NULL DEFAULT '[]');
CREATE INDEX IF NOT EXISTS auditoria_criado_em ON auditoria(criado_em);`);
// unidade do registro, para o admin ver só as vinculadas; as linhas anteriores à coluna ficam null e só o dono as vê
try { db.exec('ALTER TABLE auditoria ADD COLUMN unidade_id INTEGER'); } catch { /* coluna já existe */ }
const recalcularDiferencasStmt = db.prepare(`${recalcularDiferencasSql} WHERE id=?`);
export const recalcularDiferencas = (id: number) => recalcularDiferencasStmt.run(id);

const unidadesOficiais = ['TERRA E MAR', 'RESTAURANTE E PIZZARIA', 'DELIVERY', 'DOCELATTO'];
const garantirUnidades = db.transaction(() => {
  const add = db.prepare('INSERT OR IGNORE INTO unidades (nome, ativo) VALUES (?, 1)');
  unidadesOficiais.forEach((nome) => add.run(nome));
  db.prepare("UPDATE unidades SET ativo = 0 WHERE nome GLOB 'UNIDADE [0-9]*'").run();
});
garantirUnidades();

// tolerância de quebra de dinheiro e fechamento cego são de cada unidade. Na criação das colunas, todas herdam o que valia
// para a rede na antiga tela Configurações (tabela configuracoes, que deixa de existir)
const colunasUnidade = (db.prepare('PRAGMA table_info(unidades)').all() as { name: string }[]).map((coluna) => coluna.name);
if (!colunasUnidade.includes('fechamento_cego')) db.transaction(() => {
  db.exec('ALTER TABLE unidades ADD COLUMN tolerancia_dinheiro REAL NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE unidades ADD COLUMN fechamento_cego INTEGER NOT NULL DEFAULT 1');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='configuracoes'").get()) return;
  const antigas = Object.fromEntries((db.prepare('SELECT chave, valor FROM configuracoes').all() as { chave: string; valor: string }[]).map((linha) => [linha.chave, linha.valor]));
  db.prepare('UPDATE unidades SET tolerancia_dinheiro=?, fechamento_cego=?').run(Number(antigas.tolerancia_dinheiro) || 0, antigas.fechamento_cego === '0' ? 0 : 1);
  db.exec('DROP TABLE configuracoes');
})();

// endereço, telefone e regras de uso (uma por linha) saem no PDF do voucher da unidade; as regras começam com as padrão (voucher.ts)
try { db.exec('ALTER TABLE unidades ADD COLUMN endereco TEXT'); } catch { /* coluna já existe */ }
try { db.exec('ALTER TABLE unidades ADD COLUMN telefone TEXT'); } catch { /* coluna já existe */ }
try { db.exec(`ALTER TABLE unidades ADD COLUMN regras_voucher TEXT NOT NULL DEFAULT '${regrasVoucherPadrao}'`); } catch { /* coluna já existe */ }
// vouchers (vales consumo) de cada unidade. A situação não é gravada: cancelado (ativo=0), vencido (validade antes de hoje) ou disponível,
// calculada na consulta. Datas em AAAA-MM-DD de Brasília; a validade é o último dia em que o voucher vale
db.exec(`CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, unidade_id INTEGER NOT NULL REFERENCES unidades(id), valor REAL NOT NULL CHECK(valor > 0), email TEXT NOT NULL, nome TEXT NOT NULL, origem TEXT, data_emissao TEXT NOT NULL, validade TEXT NOT NULL, observacoes TEXT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ativo INTEGER NOT NULL DEFAULT 1, cancelado_por INTEGER REFERENCES usuarios(id), cancelado_em TEXT, motivo_cancelamento TEXT);
CREATE INDEX IF NOT EXISTS vouchers_emissao ON vouchers(data_emissao);`);
