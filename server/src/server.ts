import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import { db } from './db';

const app = express();
app.use(cors());
app.use(express.json());
const port = Number(process.env.PORT || 8080);
const requiredEnv = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Variável de ambiente ${name} não definida.`); return value; };
const secret = requiredEnv('JWT_SECRET');
const adminEmail = requiredEnv('ADMIN_EMAIL').toLowerCase();
type User = { id: number; nome: string; email: string; tipo: 'funcionario' | 'admin' | 'dono'; cargo: string | null };
type RequestWithUser = express.Request & { user?: User };
const publicUser = (row: any): User => ({ id: row.id, nome: row.nome, email: row.email, tipo: row.email === adminEmail ? 'dono' : row.tipo, cargo: row.cargo || null });
// usuários com cargo Caixa só enxergam os próprios fechamentos, mesmo com perfil admin
const isCaixaOnly = (user?: User) => !!user && user.tipo !== 'dono' && String(user.cargo || '').trim().toLowerCase() === 'caixa';
const auth = (req: RequestWithUser, res: express.Response, next: express.NextFunction) => {
  try { const token = (req.headers.authorization || '').replace('Bearer ', ''); if (!token) throw new Error(); const decoded = jwt.verify(token, secret) as unknown as { sub: number }; const row = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(Number(decoded.sub)); if (!row) throw new Error(); req.user = publicUser(row); next(); } catch { res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); }
};
const allow = (...roles: string[]) => (req: RequestWithUser, res: express.Response, next: express.NextFunction) => req.user && roles.includes(req.user.tipo) ? next() : res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
type Fechamento = { id: number; unidade_id: number; usuario_id: number; status: string };
type Etapa = 'saldo_inicial' | 'total_entradas' | 'total_maquininhas' | 'total_saidas' | 'dinheiro_fisico';
const denominacoes = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];
const formasPagamento = ['credito', 'debito', 'pix', 'refeicao', 'alimentacao', 'dinheiro'] as const;
const cargos = ['Colaborador', 'Caixa', 'Assistente Financeiro', 'Analista Financeiro', 'Supervisor Financeiro', 'Gerente Financeiro', 'Diretor Financeiro'];
const centavos = (value: number) => Math.round(value * 100) / 100;
const valorSchema = z.number({ error: 'Informe um valor numérico.' }).nonnegative('Valores não podem ser negativos.').transform(centavos);
const contagensSchema = z.array(z.object({
  denominacao: z.number({ error: 'Cédula ou moeda inválida.' }).refine((value) => denominacoes.includes(value), 'Cédula ou moeda inválida.'),
  quantidade: z.number({ error: 'Informe a quantidade.' }).int('A quantidade deve ser um número inteiro.').nonnegative('A quantidade não pode ser negativa.')
}));
const aberturaSchema = z.object({ unidade_id: z.number({ error: 'Informe a unidade.' }).int().positive('Informe a unidade.'), turno: z.enum(['ALMOÇO', 'JANTAR'], 'Turno inválido.'), contagens: contagensSchema });
const entradasSchema = z.object({ entradas: z.partialRecord(z.enum(formasPagamento), valorSchema, 'Forma de pagamento inválida.') });
const maquininhasSchema = z.object({ maquininhas: z.array(z.object({ maquininha_id: z.number().int().positive(), valor: valorSchema })) });
const saidasSchema = z.object({ saidas: z.array(z.object({ valor: z.number({ error: 'Informe o valor da saída.' }).positive('A saída deve ter valor maior que zero.').transform(centavos), motivo: z.string({ error: 'Informe o motivo da saída.' }).trim().min(1, 'Informe o motivo da saída.') })) });
const contagemFinalSchema = z.object({ contagens: contagensSchema });
// o dono acessa todas as unidades; funcionários e admins só as vinculadas a eles
const unidadesVinculadas = (userId: number) => (db.prepare('SELECT unidade_id FROM usuario_unidades WHERE usuario_id=?').all(userId) as { unidade_id: number }[]).map((row) => row.unidade_id);
const acessaUnidade = (user: User, unidadeId: number) => user.tipo === 'dono' || unidadesVinculadas(user.id).includes(Number(unidadeId));
const semAcessoUnidade = { erro: 'Você não está vinculado a esta unidade.' };
// na unidade dele: dono, admin sem cargo Caixa ou quem abriu o caixa
const podeEditar = (user: User, fechamento: { usuario_id: number; unidade_id: number }) => acessaUnidade(user, fechamento.unidade_id) && (user.tipo === 'dono' || (user.tipo === 'admin' && !isCaixaOnly(user)) || fechamento.usuario_id === user.id);
const carregarEditavel = (req: RequestWithUser, res: express.Response) => {
  const fechamento = db.prepare('SELECT id, unidade_id, usuario_id, status FROM fechamentos WHERE id=?').get(req.params.id) as Fechamento | undefined;
  if (!fechamento) { res.status(404).json({ erro: 'Fechamento não encontrado.' }); return null; }
  if (!podeEditar(req.user!, fechamento)) { res.status(403).json({ erro: 'Você só pode editar seus próprios caixas.' }); return null; }
  if (fechamento.status !== 'aberto') { res.status(409).json({ erro: 'Este caixa já foi finalizado. Reabra-o para editar.' }); return null; }
  return fechamento;
};
// grava o total de uma etapa e recalcula a diferença: positiva = sobra, negativa = falta
const salvarTotal = (id: number, etapa: Etapa, total: number) => {
  db.prepare(`UPDATE fechamentos SET ${etapa}=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`).run(centavos(total), id);
  db.prepare('UPDATE fechamentos SET diferenca=ROUND(dinheiro_fisico + total_maquininhas - (saldo_inicial + total_entradas - total_saidas), 2) WHERE id=?').run(id);
};
const salvarContagens = (id: number, etapa: 'abertura' | 'fechamento', contagens: z.infer<typeof contagensSchema>) => {
  db.prepare('DELETE FROM contagens_dinheiro WHERE fechamento_id=? AND etapa=?').run(id, etapa);
  const insert = db.prepare('INSERT INTO contagens_dinheiro (fechamento_id,etapa,denominacao,quantidade,total) VALUES (?,?,?,?,?)');
  const itens = contagens.filter((item) => item.quantidade > 0);
  itens.forEach((item) => insert.run(id, etapa, item.denominacao, item.quantidade, centavos(item.denominacao * item.quantidade)));
  return itens.reduce((sum, item) => sum + item.denominacao * item.quantidade, 0);
};
const unidadeAtiva = (id: number) => !!db.prepare('SELECT id FROM unidades WHERE id=? AND ativo=1').get(id);

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, confirmacao } = req.body || {}; const normalized = String(email || '').trim().toLowerCase();
  if (!nome || !/^\S+@\S+\.\S+$/.test(normalized) || String(senha).length < 8 || senha !== confirmacao) return res.status(400).json({ erro: 'Informe nome, e-mail válido e senhas iguais com pelo menos 8 caracteres.' });
  try { const hash = await bcrypt.hash(senha, 10); const tipo = normalized === adminEmail ? 'dono' : 'funcionario'; const result = db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run(nome.trim(), normalized, hash, tipo); const row = db.prepare('SELECT * FROM usuarios WHERE id=?').get(result.lastInsertRowid); res.status(201).json({ usuario: publicUser(row) }); } catch { res.status(409).json({ erro: 'Este e-mail já está cadastrado.' }); }
});
app.post('/api/auth/login', async (req, res) => { const email = String(req.body?.email || '').trim().toLowerCase(); const row: any = db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(email); if (!row || !(await bcrypt.compare(String(req.body?.senha || ''), row.senha_hash))) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' }); const usuario = publicUser(row); const token = jwt.sign({ sub: usuario.id }, secret, { expiresIn: '8h' }); res.json({ token, usuario }); });
app.get('/api/auth/me', auth, (req: RequestWithUser, res) => res.json({ usuario: req.user }));
app.get('/api/unidades', auth, (req: RequestWithUser, res) => res.json(req.user!.tipo === 'dono' ? db.prepare('SELECT * FROM unidades WHERE ativo=1 ORDER BY nome').all() : db.prepare('SELECT u.* FROM unidades u JOIN usuario_unidades v ON v.unidade_id=u.id WHERE u.ativo=1 AND v.usuario_id=? ORDER BY u.nome').all(req.user!.id)));
app.post('/api/unidades', auth, allow('dono'), (req, res) => { const nome = String(req.body?.nome || '').trim(); if (!nome) return res.status(400).json({ erro: 'Nome da unidade é obrigatório.' }); try { const result = db.prepare('INSERT INTO unidades (nome) VALUES (?)').run(nome); res.status(201).json(db.prepare('SELECT * FROM unidades WHERE id=?').get(result.lastInsertRowid)); } catch { res.status(409).json({ erro: 'Esta unidade já existe.' }); } });
app.patch('/api/unidades/:id', auth, allow('dono'), (req, res) => { const nome = String(req.body?.nome || '').trim(); if (!nome) return res.status(400).json({ erro: 'Nome da unidade é obrigatório.' }); try { const result = db.prepare('UPDATE unidades SET nome=? WHERE id=? AND ativo=1').run(nome, req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); res.json(db.prepare('SELECT * FROM unidades WHERE id=?').get(req.params.id)); } catch { res.status(409).json({ erro: 'Já existe uma unidade com este nome.' }); } });
app.delete('/api/unidades/:id', auth, allow('dono'), (req, res) => { const result = db.prepare('UPDATE unidades SET ativo=0 WHERE id=? AND ativo=1').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); res.status(204).end(); });
app.get('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => !acessaUnidade(req.user!, Number(req.params.id)) ? res.status(403).json(semAcessoUnidade) : res.json(db.prepare('SELECT * FROM maquininhas WHERE unidade_id=? AND ativo=1 ORDER BY numero').all(req.params.id)));
app.get('/api/maquininhas', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => res.json((db.prepare('SELECT m.*, u.nome unidade_nome FROM maquininhas m JOIN unidades u ON u.id=m.unidade_id WHERE m.ativo=1 ORDER BY u.nome, m.numero').all() as { unidade_id: number }[]).filter((row) => acessaUnidade(req.user!, row.unidade_id))));
app.post('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => { if (!unidadeAtiva(Number(req.params.id))) return res.status(404).json({ erro: 'Unidade não encontrada.' }); if (!acessaUnidade(req.user!, Number(req.params.id))) return res.status(403).json(semAcessoUnidade); const { nome, numero, numero_serie } = req.body || {}; if (!nome || !numero || !numero_serie) return res.status(400).json({ erro: 'Preencha nome, número e número de série.' }); try { const result = db.prepare('INSERT INTO maquininhas (unidade_id,nome,numero,numero_serie) VALUES (?,?,?,?)').run(req.params.id, nome, numero, numero_serie); res.status(201).json(db.prepare('SELECT * FROM maquininhas WHERE id=?').get(result.lastInsertRowid)); } catch { res.status(409).json({ erro: 'Número de série já cadastrado nesta unidade.' }); } });
app.delete('/api/maquininhas/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => { const maquininha = db.prepare('SELECT unidade_id FROM maquininhas WHERE id=? AND ativo=1').get(req.params.id) as { unidade_id: number } | undefined; if (!maquininha) return res.status(404).json({ erro: 'Maquininha não encontrada.' }); if (!acessaUnidade(req.user!, maquininha.unidade_id)) return res.status(403).json(semAcessoUnidade); db.prepare('UPDATE maquininhas SET ativo=0 WHERE id=?').run(req.params.id); res.status(204).end(); });
app.get('/api/fechamentos', auth, (req: RequestWithUser, res) => { const params: any[] = []; let sql = 'SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id'; const where: string[] = []; if (req.user!.tipo !== 'dono') { where.push('f.unidade_id IN (SELECT unidade_id FROM usuario_unidades WHERE usuario_id=?)'); params.push(req.user!.id); } if (req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) { where.push('f.usuario_id=?'); params.push(req.user!.id); } if (where.length) sql += ` WHERE ${where.join(' AND ')}`; sql += ' ORDER BY f.criado_em DESC'; res.json((db.prepare(sql).all(...params) as Fechamento[]).map((row) => ({ ...row, pode_editar: podeEditar(req.user!, row) }))); });
app.get('/api/dashboard/faturamento', auth, allow('dono'), (req, res) => { const from = String(req.query.de || '').trim(); const to = String(req.query.ate || '').trim(); const selected = String(req.query.unidades || '').split(',').map(Number).filter(Boolean); const params: any[] = []; let where = "f.status IN ('aberto','finalizado','conferido') AND f.finalizado_em IS NOT NULL AND u.ativo=1"; if (from) { where += ' AND f.finalizado_em >= ?'; params.push(from.replace('T', ' ')); } if (to) { where += ' AND f.finalizado_em <= ?'; params.push(to.replace('T', ' ').slice(0, 16) + ':59'); } if (selected.length) { where += ` AND f.unidade_id IN (${selected.map(() => '?').join(',')})`; params.push(...selected); } const series = db.prepare(`SELECT date(f.finalizado_em, '-3 hours') dia, u.id unidade_id, u.nome unidade_nome, COALESCE(SUM(f.total_entradas),0) total FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id WHERE ${where} GROUP BY dia,u.id ORDER BY dia,u.nome`).all(...params); const total = series.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0); res.json({ total, series }); });
app.get('/api/fechamentos/:id', auth, (req: RequestWithUser, res) => { const fechamento: any = db.prepare('SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id WHERE f.id=?').get(req.params.id); if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (!acessaUnidade(req.user!, fechamento.unidade_id)) return res.status(403).json(semAcessoUnidade); if ((req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) && fechamento.usuario_id !== req.user!.id) return res.status(403).json({ erro: 'Você só pode consultar os fechamentos que você mesmo realizou.' }); res.json({ fechamento: { ...fechamento, pode_editar: podeEditar(req.user!, fechamento) }, entradas: db.prepare('SELECT * FROM entradas WHERE fechamento_id=?').all(req.params.id), maquininhas: db.prepare('SELECT d.*, m.nome, m.numero, m.numero_serie FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=?').all(req.params.id), saidas: db.prepare('SELECT * FROM saidas WHERE fechamento_id=?').all(req.params.id), contagens: db.prepare('SELECT * FROM contagens_dinheiro WHERE fechamento_id=? ORDER BY etapa, denominacao DESC').all(req.params.id) }); });
app.post('/api/fechamentos', auth, (req: RequestWithUser, res) => {
  const { unidade_id, turno, contagens } = aberturaSchema.parse(req.body);
  if (!unidadeAtiva(unidade_id)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  if (!acessaUnidade(req.user!, unidade_id)) return res.status(403).json(semAcessoUnidade);
  const id = db.transaction(() => {
    const result = db.prepare("INSERT INTO fechamentos (unidade_id,usuario_id,turno,saldo_inicial,status) VALUES (?,?,?,0,'aberto')").run(unidade_id, req.user!.id, turno);
    const novoId = Number(result.lastInsertRowid);
    salvarTotal(novoId, 'saldo_inicial', salvarContagens(novoId, 'abertura', contagens));
    return novoId;
  })();
  res.status(201).json({ id, mensagem: 'Caixa aberto.' });
});
app.put('/api/fechamentos/:id/abertura', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const { unidade_id, turno, contagens } = aberturaSchema.parse(req.body);
  if (!unidadeAtiva(unidade_id)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  if (!acessaUnidade(req.user!, unidade_id)) return res.status(403).json(semAcessoUnidade);
  db.transaction(() => {
    db.prepare('UPDATE fechamentos SET unidade_id=?, turno=? WHERE id=?').run(unidade_id, turno, fechamento.id);
    // maquininhas pertencem à unidade; ao trocar de unidade os relatórios anteriores deixam de valer
    if (unidade_id !== fechamento.unidade_id) { db.prepare('DELETE FROM detalhes_maquininha WHERE fechamento_id=?').run(fechamento.id); salvarTotal(fechamento.id, 'total_maquininhas', 0); }
    salvarTotal(fechamento.id, 'saldo_inicial', salvarContagens(fechamento.id, 'abertura', contagens));
  })();
  res.json({ mensagem: 'Abertura salva.' });
});
app.put('/api/fechamentos/:id/entradas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const { entradas } = entradasSchema.parse(req.body);
  db.transaction(() => {
    db.prepare('DELETE FROM entradas WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare('INSERT INTO entradas (fechamento_id,forma_pagamento,valor) VALUES (?,?,?)');
    Object.entries(entradas).forEach(([forma, valor]) => insert.run(fechamento.id, forma, valor));
    salvarTotal(fechamento.id, 'total_entradas', Object.values(entradas).reduce((sum: number, valor) => sum + (valor || 0), 0));
  })();
  res.json({ mensagem: 'Entradas salvas.' });
});
app.put('/api/fechamentos/:id/maquininhas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const { maquininhas } = maquininhasSchema.parse(req.body);
  const validas = new Set((db.prepare('SELECT id FROM maquininhas WHERE unidade_id=? AND ativo=1').all(fechamento.unidade_id) as { id: number }[]).map((item) => item.id));
  if (maquininhas.some((item) => !validas.has(item.maquininha_id))) return res.status(400).json({ erro: 'Maquininha não pertence à unidade deste caixa.' });
  db.transaction(() => {
    db.prepare('DELETE FROM detalhes_maquininha WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare('INSERT INTO detalhes_maquininha (fechamento_id,maquininha_id,valor) VALUES (?,?,?)');
    maquininhas.forEach((item) => insert.run(fechamento.id, item.maquininha_id, item.valor));
    salvarTotal(fechamento.id, 'total_maquininhas', maquininhas.reduce((sum, item) => sum + item.valor, 0));
  })();
  res.json({ mensagem: 'Maquininhas salvas.' });
});
app.put('/api/fechamentos/:id/saidas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const { saidas } = saidasSchema.parse(req.body);
  db.transaction(() => {
    db.prepare('DELETE FROM saidas WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare('INSERT INTO saidas (fechamento_id,valor,motivo) VALUES (?,?,?)');
    saidas.forEach((item) => insert.run(fechamento.id, item.valor, item.motivo));
    salvarTotal(fechamento.id, 'total_saidas', saidas.reduce((sum, item) => sum + item.valor, 0));
  })();
  res.json({ mensagem: 'Saídas salvas.' });
});
app.put('/api/fechamentos/:id/contagem-final', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const { contagens } = contagemFinalSchema.parse(req.body);
  db.transaction(() => salvarTotal(fechamento.id, 'dinheiro_fisico', salvarContagens(fechamento.id, 'fechamento', contagens)))();
  res.json({ mensagem: 'Contagem final salva.' });
});
// mantém a data da primeira finalização para o caixa reaberto não mudar de dia no faturamento
app.post('/api/fechamentos/:id/finalizar', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  db.prepare("UPDATE fechamentos SET status='finalizado', atualizado_em=CURRENT_TIMESTAMP, finalizado_em=COALESCE(finalizado_em, CURRENT_TIMESTAMP) WHERE id=?").run(fechamento.id);
  res.json({ mensagem: 'CAIXA FINALIZADO' });
});
app.post('/api/fechamentos/:id/conferir', auth, allow('dono'), (req, res) => { const fechamento = db.prepare('SELECT status FROM fechamentos WHERE id=?').get(req.params.id) as { status: string } | undefined; if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (fechamento.status === 'aberto') return res.status(409).json({ erro: 'Finalize o caixa antes de conferir.' }); const resolved = req.body?.problema_resolvido === true ? 1 : req.body?.problema_resolvido === false ? 0 : null; const unmark = req.body?.desmarcar === true; db.prepare("UPDATE fechamentos SET status=?, problema_resolvido=?, conferido_por=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(unmark ? 'finalizado' : 'conferido', unmark ? null : resolved, unmark ? null : (req as RequestWithUser).user!.id, req.params.id); res.json({ mensagem: unmark ? 'Conferência desmarcada.' : 'Caixa conferido com sucesso.' }); });
app.post('/api/fechamentos/:id/reabrir', auth, (req: RequestWithUser, res) => { const fechamento = db.prepare('SELECT usuario_id,status FROM fechamentos WHERE id=?').get(req.params.id) as Fechamento | undefined; if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (!podeEditar(req.user!, fechamento)) return res.status(403).json({ erro: 'Você só pode editar seus próprios caixas.' }); if (req.user?.tipo === 'funcionario' && fechamento.status === 'conferido') return res.status(403).json({ erro: 'Este caixa já foi conferido pelo dono e não pode mais ser editado.' }); db.prepare("UPDATE fechamentos SET status='aberto', problema_resolvido=NULL, conferido_por=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id); res.json({ mensagem: 'Caixa reaberto para edição.' }); });
app.delete('/api/fechamentos/:id', auth, allow('dono'), (req, res) => { const result = db.prepare('DELETE FROM fechamentos WHERE id=?').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); res.json({ mensagem: 'Caixa excluído com sucesso.' }); });
const comUnidades = <T extends { id: number }>(usuario: T) => ({ ...usuario, unidades: unidadesVinculadas(usuario.id) });
app.get('/api/usuarios', auth, allow('admin', 'dono'), (_, res) => res.json((db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios ORDER BY nome').all() as { id: number }[]).map(comUnidades)));
app.patch('/api/usuarios/:id/tipo', auth, allow('dono'), (req, res) => { const tipo = ['funcionario', 'admin'].includes(req.body?.tipo) ? req.body.tipo : null; if (!tipo) return res.status(400).json({ erro: 'Perfil inválido.' }); db.prepare('UPDATE usuarios SET tipo=? WHERE id=? AND email<>?').run(tipo, req.params.id, adminEmail); res.json({ mensagem: 'Perfil atualizado.' }); });
app.patch('/api/usuarios/:id', auth, allow('dono'), async (req, res) => { const id = Number(req.params.id); const target: any = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id); if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' }); const isOwnerAccount = target.email === adminEmail; const { nome, email, senha, cargo, tipo, unidades } = req.body || {}; const updates: string[] = []; const params: any[] = []; if (nome !== undefined) { if (!String(nome).trim()) return res.status(400).json({ erro: 'Informe o nome.' }); updates.push('nome=?'); params.push(String(nome).trim()); } if (email !== undefined) { const normalized = String(email).trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(normalized)) return res.status(400).json({ erro: 'Informe um e-mail válido.' }); updates.push('email=?'); params.push(normalized); } if (senha) { if (String(senha).length < 8) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' }); updates.push('senha_hash=?'); params.push(await bcrypt.hash(senha, 10)); } // cargos fora da lista que já existiam continuam válidos para quem já os tem
if (cargo !== undefined) { const novoCargo = String(cargo || '').trim() || null; if (novoCargo && !cargos.includes(novoCargo) && novoCargo !== target.cargo) return res.status(400).json({ erro: 'Cargo inválido.' }); updates.push('cargo=?'); params.push(novoCargo); } if (tipo !== undefined && !isOwnerAccount) { if (!['funcionario', 'admin'].includes(tipo)) return res.status(400).json({ erro: 'Perfil inválido.' }); updates.push('tipo=?'); params.push(tipo); } const novasUnidades = unidades === undefined ? undefined : z.array(z.number().int().refine(unidadeAtiva, 'Unidade não encontrada.'), 'Informe a lista de unidades.').parse(unidades); if (!updates.length && novasUnidades === undefined) return res.status(400).json({ erro: 'Nenhuma alteração informada.' }); if (updates.length) { try { db.prepare(`UPDATE usuarios SET ${updates.join(',')} WHERE id=?`).run(...params, id); } catch { return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' }); } } if (novasUnidades) db.transaction(() => { db.prepare('DELETE FROM usuario_unidades WHERE usuario_id=?').run(id); const insert = db.prepare('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) VALUES (?,?)'); novasUnidades.forEach((unidadeId) => insert.run(id, unidadeId)); })(); const row = db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios WHERE id=?').get(id) as { id: number }; res.json({ usuario: comUnidades(row) }); });
// serve o SPA compilado do client quando o build estiver disponível (deploy em container único)
const clientDist = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (err instanceof ZodError) return res.status(400).json({ erro: err.issues[0].message }); console.error(err); res.status(500).json({ erro: 'Erro interno do servidor.' }); });
app.listen(port, '0.0.0.0', (error) => { if (error) throw error; console.log(`API rodando na porta ${port}`); });
