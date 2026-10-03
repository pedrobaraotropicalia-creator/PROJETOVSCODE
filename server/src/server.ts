import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import { db, recalcularDiferencas } from './db';
import { limites } from './limites';

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
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const texto = (obrigatorio: string, campo: string, max: number) => z.string({ error: obrigatorio }).trim().min(1, obrigatorio).max(max, `${campo} deve ter no máximo ${max} caracteres.`);
const nomeUsuarioSchema = texto('Informe o nome.', 'O nome', limites.nomeUsuario);
const emailSchema = z.string({ error: 'Informe um e-mail válido.' }).trim().toLowerCase().max(limites.email, `O e-mail deve ter no máximo ${limites.email} caracteres.`).regex(/^\S+@\S+\.\S+$/, 'Informe um e-mail válido.');
const senhaSchema = z.string({ error: 'Informe a senha.' }).min(8, 'A senha deve ter pelo menos 8 caracteres.').refine((senha) => Buffer.byteLength(senha) <= limites.senhaBytes, `A senha deve ter no máximo ${limites.senhaBytes} caracteres (letras acentuadas contam como 2).`);
const nomeUnidadeSchema = texto('Nome da unidade é obrigatório.', 'O nome da unidade', limites.nomeUnidade);
const cadastroSchema = z.object({ nome: nomeUsuarioSchema, email: emailSchema, senha: senhaSchema, confirmacao: z.unknown() }).refine((dados) => dados.senha === dados.confirmacao, 'As senhas não conferem.');
const maquininhaSchema = z.object({ nome: texto('Informe o nome da maquininha.', 'O nome da maquininha', limites.nomeMaquininha), numero: texto('Informe o número da maquininha.', 'O número da maquininha', limites.numeroMaquininha), numero_serie: texto('Informe o número de série.', 'O número de série', limites.serieMaquininha) });
const valorSchema = z.number({ error: 'Informe um valor numérico.' }).nonnegative('Valores não podem ser negativos.').max(limites.valor, `Valor acima do limite de ${brl(limites.valor)}.`).transform(centavos);
const contagensSchema = z.array(z.object({
  denominacao: z.number({ error: 'Cédula ou moeda inválida.' }).refine((value) => denominacoes.includes(value), 'Cédula ou moeda inválida.'),
  quantidade: z.number({ error: 'Informe a quantidade.' }).int('A quantidade deve ser um número inteiro.').nonnegative('A quantidade não pode ser negativa.').max(limites.quantidade, `A quantidade deve ser no máximo ${limites.quantidade.toLocaleString('pt-BR')}.`)
}));
const aberturaSchema = z.object({ unidade_id: z.number({ error: 'Informe a unidade.' }).int().positive('Informe a unidade.'), turno: z.enum(['ALMOÇO', 'JANTAR'], 'Turno inválido.'), contagens: contagensSchema });
const entradasSchema = z.object({ entradas: z.partialRecord(z.enum(formasPagamento), valorSchema, 'Forma de pagamento inválida.') });
const maquininhasSchema = z.object({ maquininhas: z.array(z.object({ maquininha_id: z.number().int().positive(), valor: valorSchema })) });
const saidasSchema = z.object({ saidas: z.array(z.object({ valor: z.number({ error: 'Informe o valor da saída.' }).positive('A saída deve ter valor maior que zero.').max(limites.valor, `Valor acima do limite de ${brl(limites.valor)}.`).transform(centavos), motivo: texto('Informe o motivo da saída.', 'O motivo da saída', limites.motivoSaida) })).max(limites.saidasPorCaixa, `No máximo ${limites.saidasPorCaixa} saídas por caixa.`) });
const contagemFinalSchema = z.object({ contagens: contagensSchema });
const unidadeSchema = z.object({ nome: nomeUnidadeSchema.optional(), troco_continua: z.boolean().optional() });
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const relatorioSchema = z.object({ de: dia, ate: dia, unidades: z.string().optional().transform((value) => (value || '').split(',').map(Number).filter(Boolean)) });
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
// grava o total de uma etapa e recalcula as diferenças (db.ts): positiva = sobra, negativa = falta
const salvarTotal = (id: number, etapa: Etapa, total: number) => {
  db.prepare(`UPDATE fechamentos SET ${etapa}=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`).run(centavos(total), id);
  recalcularDiferencas(id);
};
const lerConfiguracoes = () => {
  const valores = Object.fromEntries((db.prepare('SELECT chave, valor FROM configuracoes').all() as { chave: string; valor: string }[]).map((row) => [row.chave, row.valor]));
  return { tolerancia_dinheiro: Number(valores.tolerancia_dinheiro), fechamento_cego: valores.fechamento_cego === '1' };
};
const configuracoesSchema = z.object({ tolerancia_dinheiro: z.number({ error: 'Informe a tolerância.' }).nonnegative('A tolerância não pode ser negativa.').max(limites.tolerancia, `A tolerância deve ser no máximo ${brl(limites.tolerancia)}.`).transform(centavos), fechamento_cego: z.boolean() });
// no fechamento cego, quem opera o caixa não vê o esperado nem a diferença; só quem confere (dono e admin sem cargo Caixa)
const veDiferenca = (user: User) => !lerConfiguracoes().fechamento_cego || user.tipo === 'dono' || (user.tipo === 'admin' && !isCaixaOnly(user));
const ocultarDiferencas = <T extends object>(user: User, fechamento: T) => { if (veDiferenca(user)) return fechamento; const { diferenca, diferenca_dinheiro, diferenca_cartoes, ...resto } = fechamento as T & { diferenca?: number; diferenca_dinheiro?: number; diferenca_cartoes?: number }; return resto; };
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
  const { nome, email: normalized, senha } = cadastroSchema.parse(req.body ?? {});
  try { const hash = await bcrypt.hash(senha, 10); const tipo = normalized === adminEmail ? 'dono' : 'funcionario'; const result = db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run(nome, normalized, hash, tipo); const row = db.prepare('SELECT * FROM usuarios WHERE id=?').get(result.lastInsertRowid); res.status(201).json({ usuario: publicUser(row) }); } catch { res.status(409).json({ erro: 'Este e-mail já está cadastrado.' }); }
});
app.post('/api/auth/login', async (req, res) => { const email = String(req.body?.email || '').trim().toLowerCase(); const row: any = db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(email); if (!row || !(await bcrypt.compare(String(req.body?.senha || ''), row.senha_hash))) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' }); const usuario = publicUser(row); const token = jwt.sign({ sub: usuario.id }, secret, { expiresIn: '8h' }); res.json({ token, usuario }); });
app.get('/api/auth/me', auth, (req: RequestWithUser, res) => res.json({ usuario: req.user }));
app.get('/api/unidades', auth, (req: RequestWithUser, res) => res.json(req.user!.tipo === 'dono' ? db.prepare('SELECT * FROM unidades WHERE ativo=1 ORDER BY nome').all() : db.prepare('SELECT u.* FROM unidades u JOIN usuario_unidades v ON v.unidade_id=u.id WHERE u.ativo=1 AND v.usuario_id=? ORDER BY u.nome').all(req.user!.id)));
app.post('/api/unidades', auth, allow('dono'), (req, res) => { const nome = nomeUnidadeSchema.parse(req.body?.nome); try { const result = db.prepare('INSERT INTO unidades (nome) VALUES (?)').run(nome); res.status(201).json(db.prepare('SELECT * FROM unidades WHERE id=?').get(result.lastInsertRowid)); } catch { res.status(409).json({ erro: 'Esta unidade já existe.' }); } });
app.patch('/api/unidades/:id', auth, allow('dono'), (req, res) => { const { nome, troco_continua } = unidadeSchema.parse(req.body); const updates: string[] = []; const params: unknown[] = []; if (nome !== undefined) { updates.push('nome=?'); params.push(nome); } if (troco_continua !== undefined) { updates.push('troco_continua=?'); params.push(troco_continua ? 1 : 0); } if (!updates.length) return res.status(400).json({ erro: 'Nada para atualizar.' }); try { const result = db.prepare(`UPDATE unidades SET ${updates.join(', ')} WHERE id=? AND ativo=1`).run(...params, req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); res.json(db.prepare('SELECT * FROM unidades WHERE id=?').get(req.params.id)); } catch { res.status(409).json({ erro: 'Já existe uma unidade com este nome.' }); } });
app.delete('/api/unidades/:id', auth, allow('dono'), (req, res) => { const result = db.prepare('UPDATE unidades SET ativo=0 WHERE id=? AND ativo=1').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); res.status(204).end(); });
app.get('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => !acessaUnidade(req.user!, Number(req.params.id)) ? res.status(403).json(semAcessoUnidade) : res.json(db.prepare('SELECT * FROM maquininhas WHERE unidade_id=? AND ativo=1 ORDER BY numero').all(req.params.id)));
app.get('/api/maquininhas', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => res.json((db.prepare('SELECT m.*, u.nome unidade_nome FROM maquininhas m JOIN unidades u ON u.id=m.unidade_id WHERE m.ativo=1 ORDER BY u.nome, m.numero').all() as { unidade_id: number }[]).filter((row) => acessaUnidade(req.user!, row.unidade_id))));
app.post('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => { if (!unidadeAtiva(Number(req.params.id))) return res.status(404).json({ erro: 'Unidade não encontrada.' }); if (!acessaUnidade(req.user!, Number(req.params.id))) return res.status(403).json(semAcessoUnidade); const { nome, numero, numero_serie } = maquininhaSchema.parse(req.body ?? {}); try { const result = db.prepare('INSERT INTO maquininhas (unidade_id,nome,numero,numero_serie) VALUES (?,?,?,?)').run(req.params.id, nome, numero, numero_serie); res.status(201).json(db.prepare('SELECT * FROM maquininhas WHERE id=?').get(result.lastInsertRowid)); } catch { res.status(409).json({ erro: 'Número de série já cadastrado nesta unidade.' }); } });
app.delete('/api/maquininhas/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => { const maquininha = db.prepare('SELECT unidade_id FROM maquininhas WHERE id=? AND ativo=1').get(req.params.id) as { unidade_id: number } | undefined; if (!maquininha) return res.status(404).json({ erro: 'Maquininha não encontrada.' }); if (!acessaUnidade(req.user!, maquininha.unidade_id)) return res.status(403).json(semAcessoUnidade); db.prepare('UPDATE maquininhas SET ativo=0 WHERE id=?').run(req.params.id); res.status(204).end(); });
app.get('/api/fechamentos', auth, (req: RequestWithUser, res) => { const params: any[] = []; let sql = 'SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id'; const where: string[] = []; if (req.user!.tipo !== 'dono') { where.push('f.unidade_id IN (SELECT unidade_id FROM usuario_unidades WHERE usuario_id=?)'); params.push(req.user!.id); } if (req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) { where.push('f.usuario_id=?'); params.push(req.user!.id); } if (where.length) sql += ` WHERE ${where.join(' AND ')}`; sql += ' ORDER BY f.criado_em DESC'; res.json((db.prepare(sql).all(...params) as Fechamento[]).map((row) => ocultarDiferencas(req.user!, { ...row, pode_editar: podeEditar(req.user!, row) }))); });
// uma linha por caixa já finalizado alguma vez (mesmo critério de dia do faturamento); o client agrega os gráficos
// dinheiro_anterior: dinheiro contado no caixa anterior da mesma unidade, calculado antes do filtro de período
app.get('/api/relatorios/caixas', auth, allow('dono'), (req, res) => {
  const { de, ate, unidades } = relatorioSchema.parse(req.query);
  const filtroUnidades = unidades.length ? ` AND unidade_id IN (${unidades.map(() => '?').join(',')})` : '';
  const linhas = db.prepare(`WITH base AS (
    SELECT f.id, f.unidade_id, u.nome unidade_nome, u.troco_continua, f.usuario_id, usr.nome usuario_nome, f.turno, f.status, f.problema_resolvido, date(f.finalizado_em, '-3 hours') dia, f.criado_em,
      f.saldo_inicial, f.dinheiro_fisico, f.total_entradas, f.total_maquininhas, f.total_saidas, f.diferenca_dinheiro, f.diferenca_cartoes,
      LAG(f.dinheiro_fisico) OVER (PARTITION BY f.unidade_id ORDER BY f.criado_em, f.id) dinheiro_anterior
    FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id
    WHERE f.finalizado_em IS NOT NULL AND u.ativo=1)
  SELECT b.*,
    (SELECT json_group_object(forma_pagamento, valor) FROM entradas WHERE fechamento_id=b.id) entradas,
    (SELECT json_group_array(json_object('id', m.id, 'nome', m.nome, 'numero', m.numero, 'valor', d.valor)) FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=b.id) maquininhas
  FROM base b WHERE dia BETWEEN ? AND ?${filtroUnidades} ORDER BY dia, unidade_nome, criado_em`).all(de, ate, ...unidades) as { troco_continua: number; entradas: string; maquininhas: string }[];
  res.json(linhas.map((linha) => ({ ...linha, troco_continua: linha.troco_continua === 1, entradas: JSON.parse(linha.entradas), maquininhas: JSON.parse(linha.maquininhas) })));
});
app.get('/api/fechamentos/:id', auth, (req: RequestWithUser, res) => { const fechamento: any = db.prepare('SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome, conf.nome conferido_por_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id LEFT JOIN usuarios conf ON conf.id=f.conferido_por WHERE f.id=?').get(req.params.id); if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (!acessaUnidade(req.user!, fechamento.unidade_id)) return res.status(403).json(semAcessoUnidade); if ((req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) && fechamento.usuario_id !== req.user!.id) return res.status(403).json({ erro: 'Você só pode consultar os fechamentos que você mesmo realizou.' }); res.json({ fechamento: ocultarDiferencas(req.user!, { ...fechamento, pode_editar: podeEditar(req.user!, fechamento) }), entradas: db.prepare('SELECT * FROM entradas WHERE fechamento_id=?').all(req.params.id), maquininhas: db.prepare('SELECT d.*, m.nome, m.numero, m.numero_serie FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=?').all(req.params.id), saidas: db.prepare('SELECT * FROM saidas WHERE fechamento_id=?').all(req.params.id), contagens: db.prepare('SELECT * FROM contagens_dinheiro WHERE fechamento_id=? ORDER BY etapa, denominacao DESC').all(req.params.id) }); });
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
app.get('/api/configuracoes', auth, (req: RequestWithUser, res) => res.json({ ...lerConfiguracoes(), ve_diferenca: veDiferenca(req.user!) }));
app.put('/api/configuracoes', auth, allow('dono'), (req: RequestWithUser, res) => {
  const { tolerancia_dinheiro, fechamento_cego } = configuracoesSchema.parse(req.body);
  const salvar = db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor');
  db.transaction(() => { salvar.run('tolerancia_dinheiro', String(tolerancia_dinheiro)); salvar.run('fechamento_cego', fechamento_cego ? '1' : '0'); })();
  res.json({ ...lerConfiguracoes(), ve_diferenca: veDiferenca(req.user!) });
});
const comUnidades = <T extends { id: number }>(usuario: T) => ({ ...usuario, unidades: unidadesVinculadas(usuario.id) });
app.get('/api/usuarios', auth, allow('admin', 'dono'), (_, res) => res.json((db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios ORDER BY nome').all() as { id: number }[]).map(comUnidades)));
app.patch('/api/usuarios/:id/tipo', auth, allow('dono'), (req, res) => { const tipo = ['funcionario', 'admin'].includes(req.body?.tipo) ? req.body.tipo : null; if (!tipo) return res.status(400).json({ erro: 'Perfil inválido.' }); db.prepare('UPDATE usuarios SET tipo=? WHERE id=? AND email<>?').run(tipo, req.params.id, adminEmail); res.json({ mensagem: 'Perfil atualizado.' }); });
app.patch('/api/usuarios/:id', auth, allow('dono'), async (req, res) => { const id = Number(req.params.id); const target: any = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id); if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' }); const isOwnerAccount = target.email === adminEmail; const { nome, email, senha, cargo, tipo, unidades } = req.body || {}; const updates: string[] = []; const params: any[] = []; if (nome !== undefined) { updates.push('nome=?'); params.push(nomeUsuarioSchema.parse(nome)); } if (email !== undefined) { updates.push('email=?'); params.push(emailSchema.parse(email)); } if (senha) { updates.push('senha_hash=?'); params.push(await bcrypt.hash(senhaSchema.parse(senha), 10)); } // cargos fora da lista que já existiam continuam válidos para quem já os tem
if (cargo !== undefined) { const novoCargo = String(cargo || '').trim() || null; if (novoCargo && !cargos.includes(novoCargo) && novoCargo !== target.cargo) return res.status(400).json({ erro: 'Cargo inválido.' }); updates.push('cargo=?'); params.push(novoCargo); } if (tipo !== undefined && !isOwnerAccount) { if (!['funcionario', 'admin'].includes(tipo)) return res.status(400).json({ erro: 'Perfil inválido.' }); updates.push('tipo=?'); params.push(tipo); } const novasUnidades = unidades === undefined ? undefined : z.array(z.number().int().refine(unidadeAtiva, 'Unidade não encontrada.'), 'Informe a lista de unidades.').parse(unidades); if (!updates.length && novasUnidades === undefined) return res.status(400).json({ erro: 'Nenhuma alteração informada.' }); if (updates.length) { try { db.prepare(`UPDATE usuarios SET ${updates.join(',')} WHERE id=?`).run(...params, id); } catch { return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' }); } } if (novasUnidades) db.transaction(() => { db.prepare('DELETE FROM usuario_unidades WHERE usuario_id=?').run(id); const insert = db.prepare('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) VALUES (?,?)'); novasUnidades.forEach((unidadeId) => insert.run(id, unidadeId)); })(); const row = db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios WHERE id=?').get(id) as { id: number }; res.json({ usuario: comUnidades(row) }); });
// serve o SPA compilado do client quando o build estiver disponível (deploy em container único)
const clientDist = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (err instanceof ZodError) return res.status(400).json({ erro: err.issues[0].message }); console.error(err); res.status(500).json({ erro: 'Erro interno do servidor.' }); });
app.listen(port, '0.0.0.0', (error) => { if (error) throw error; console.log(`API rodando na porta ${port}`); });
