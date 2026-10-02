import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_FILE || (process.env.K_SERVICE ? '/tmp/data/caixa.db' : './data/caixa.db');
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
export const db = new Database(file);
db.pragma('foreign_keys = ON');
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
// na criação da tabela, cada usuário é vinculado às unidades onde já registrou caixa; depois disso só o dono altera os vínculos
const vinculosNovos = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usuario_unidades'").get();
db.transaction(() => {
  db.exec('CREATE TABLE IF NOT EXISTS usuario_unidades (usuario_id INTEGER NOT NULL REFERENCES usuarios(id), unidade_id INTEGER NOT NULL REFERENCES unidades(id), PRIMARY KEY (usuario_id, unidade_id))');
  if (vinculosNovos) db.exec('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) SELECT DISTINCT usuario_id, unidade_id FROM fechamentos');
})();
db.exec('CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
db.prepare("INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('tolerancia_dinheiro', '0'), ('fechamento_cego', '1')").run();

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
const recalcularDiferencasStmt = db.prepare(`${recalcularDiferencasSql} WHERE id=?`);
export const recalcularDiferencas = (id: number) => recalcularDiferencasStmt.run(id);

const unidadesOficiais = ['TERRA E MAR', 'RESTAURANTE E PIZZARIA', 'DELIVERY', 'DOCELATTO'];
const garantirUnidades = db.transaction(() => {
  const add = db.prepare('INSERT OR IGNORE INTO unidades (nome, ativo) VALUES (?, 1)');
  unidadesOficiais.forEach((nome) => add.run(nome));
  db.prepare("UPDATE unidades SET ativo = 0 WHERE nome GLOB 'UNIDADE [0-9]*'").run();
});
garantirUnidades();
