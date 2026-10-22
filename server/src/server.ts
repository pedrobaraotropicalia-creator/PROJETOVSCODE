import 'dotenv/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import { db, recalcularDiferencas } from './db';
import { limites } from './limites';
import { cargoRestringe, nomesCargos } from './cargos';
import { fotoCaixa, fotoMaquininha, fotoMotivo, fotoMovimentacao, fotoUnidade, fotoUsuario, registrar } from './auditoria';
import { aguardarReplicacao } from './replicacao';

const app = express();
app.use(cors());
app.use(express.json());
app.use(aguardarReplicacao);
const port = Number(process.env.PORT || 8080);
const requiredEnv = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Variável de ambiente ${name} não definida.`); return value; };
const secret = requiredEnv('JWT_SECRET');
const adminEmail = requiredEnv('ADMIN_EMAIL').toLowerCase();
// o dono nasce na partida a partir de ADMIN_PASSWORD, só quando ainda não existe (a senha que ele trocar depois não volta a cada partida);
// o cadastro pela tela de login recusa o e-mail dele, senão quem chegasse primeiro a um banco vazio viraria dono
if (!db.prepare('SELECT id FROM usuarios WHERE email=?').get(adminEmail)) {
  const senhaDono = process.env.ADMIN_PASSWORD;
  if (!senhaDono) console.warn(`O dono (${adminEmail}) ainda não existe: defina ADMIN_PASSWORD para criá-lo na partida.`);
  else {
    if (senhaDono.length < 8) throw new Error('ADMIN_PASSWORD deve ter pelo menos 8 caracteres.');
    const id = Number(db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run('Dono do sistema', adminEmail, bcrypt.hashSync(senhaDono, 10), 'dono').lastInsertRowid);
    registrar(id, 'usuario', id, 'Criado na partida', null, fotoUsuario(id));
    console.log(`Usuário dono criado: ${adminEmail}`);
  }
}
type User = { id: number; nome: string; email: string; tipo: 'funcionario' | 'admin' | 'dono'; cargo: string | null };
type RequestWithUser = express.Request & { user?: User };
const publicUser = (row: any): User => ({ id: row.id, nome: row.nome, email: row.email, tipo: row.email === adminEmail ? 'dono' : row.tipo, cargo: row.cargo || null });
// usuários com cargo Caixa só enxergam os próprios fechamentos, mesmo com perfil admin
const isCaixaOnly = (user?: User) => !!user && user.tipo !== 'dono' && cargoRestringe(user.cargo);
const auth = (req: RequestWithUser, res: express.Response, next: express.NextFunction) => {
  try { const token = (req.headers.authorization || '').replace('Bearer ', ''); if (!token) throw new Error(); const decoded = jwt.verify(token, secret) as unknown as { sub: number }; const row = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(Number(decoded.sub)); if (!row) throw new Error(); req.user = publicUser(row); next(); } catch { res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); }
};
const allow = (...roles: string[]) => (req: RequestWithUser, res: express.Response, next: express.NextFunction) => req.user && roles.includes(req.user.tipo) ? next() : res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
type Fechamento = { id: number; unidade_id: number; usuario_id: number; status: string };
type Etapa = 'saldo_inicial' | 'total_entradas' | 'total_maquininhas' | 'total_saidas' | 'dinheiro_fisico';
const denominacoes = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];
const formasPagamento = ['credito', 'debito', 'pix', 'refeicao', 'alimentacao', 'dinheiro'] as const;
const centavos = (value: number) => Math.round(value * 100) / 100;
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const texto = (obrigatorio: string, campo: string, max: number) => z.string({ error: obrigatorio }).trim().min(1, obrigatorio).max(max, `${campo} deve ter no máximo ${max} caracteres.`);
const nomeUsuarioSchema = texto('Informe o nome.', 'O nome', limites.nomeUsuario);
const emailSchema = z.string({ error: 'Informe um e-mail válido.' }).trim().toLowerCase().max(limites.email, `O e-mail deve ter no máximo ${limites.email} caracteres.`).regex(/^\S+@\S+\.\S+$/, 'Informe um e-mail válido.');
const senhaSchema = z.string({ error: 'Informe a senha.' }).min(8, 'A senha deve ter pelo menos 8 caracteres.').refine((senha) => Buffer.byteLength(senha) <= limites.senhaBytes, `A senha deve ter no máximo ${limites.senhaBytes} caracteres (letras acentuadas contam como 2).`);
const nomeUnidadeSchema = texto('Nome da unidade é obrigatório.', 'O nome da unidade', limites.nomeUnidade);
const cadastroSchema = z.object({ nome: nomeUsuarioSchema, email: emailSchema, senha: senhaSchema, confirmacao: z.unknown() }).refine((dados) => dados.senha === dados.confirmacao, 'As senhas não conferem.');
// código de primeiro acesso: 8 caracteres sem os que se confundem (0/O, 1/I), mostrado como XXXX-XXXX; o banco guarda só o hash
const alfabetoCodigo = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizarCodigo = (codigo: string) => codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCodigo = (codigo: string) => createHash('sha256').update(normalizarCodigo(codigo)).digest('hex');
const novoCodigoAcesso = () => { const codigo = Array.from({ length: 8 }, () => alfabetoCodigo[randomInt(alfabetoCodigo.length)]).join(''); return { codigo: `${codigo.slice(0, 4)}-${codigo.slice(4)}`, hash: hashCodigo(codigo) }; };
const primeiroAcessoSchema = z.object({ email: emailSchema, codigo: z.string({ error: 'Informe o código de acesso.' }).max(limites.codigoAcesso, 'Código de acesso inválido.').refine((codigo) => normalizarCodigo(codigo).length > 0, 'Informe o código de acesso.'), senha: senhaSchema, confirmacao: z.unknown() }).refine((dados) => dados.senha === dados.confirmacao, 'As senhas não conferem.');
const maquininhaSchema = z.object({ nome: texto('Informe o nome da maquininha.', 'O nome da maquininha', limites.nomeMaquininha), numero: texto('Informe o número da maquininha.', 'O número da maquininha', limites.numeroMaquininha), numero_serie: texto('Informe o número de série.', 'O número de série', limites.serieMaquininha) });
const valorSchema = z.number({ error: 'Informe um valor numérico.' }).nonnegative('Valores não podem ser negativos.').max(limites.valor, `Valor acima do limite de ${brl(limites.valor)}.`).transform(centavos);
const contagensSchema = z.array(z.object({
  denominacao: z.number({ error: 'Cédula ou moeda inválida.' }).refine((value) => denominacoes.includes(value), 'Cédula ou moeda inválida.'),
  quantidade: z.number({ error: 'Informe a quantidade.' }).int('A quantidade deve ser um número inteiro.').nonnegative('A quantidade não pode ser negativa.').max(limites.quantidade, `A quantidade deve ser no máximo ${limites.quantidade.toLocaleString('pt-BR')}.`)
}));
const dia = z.string({ error: 'Informe o período do relatório.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').refine((texto) => { const data = new Date(`${texto}T12:00:00Z`); return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto; }, 'Data inválida.');
// dia em Brasília (UTC-3, sem horário de verão), o mesmo critério do relatório
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const aberturaSchema = z.object({ data_caixa: dia.refine((data) => data <= hoje(), 'A data do caixa não pode ser futura.').optional(), unidade_id: z.number({ error: 'Informe a unidade.' }).int().positive('Informe a unidade.'), turno: z.enum(['ALMOÇO', 'JANTAR'], 'Turno inválido.'), contagens: contagensSchema });
const entradasSchema = z.object({ entradas: z.partialRecord(z.enum(formasPagamento), valorSchema, 'Forma de pagamento inválida.') });
const maquininhasSchema = z.object({ maquininhas: z.array(z.object({ maquininha_id: z.number().int().positive(), valor: valorSchema })) });
const saidasSchema = z.object({ saidas: z.array(z.object({ valor: z.number({ error: 'Informe o valor da saída.' }).positive('A saída deve ter valor maior que zero.').max(limites.valor, `Valor acima do limite de ${brl(limites.valor)}.`).transform(centavos), motivo_id: z.number({ error: 'Escolha o motivo da saída.' }).int().positive('Escolha o motivo da saída.'), observacao: z.string().trim().max(limites.motivoSaida, `A observação deve ter no máximo ${limites.motivoSaida} caracteres.`).optional().transform((texto) => texto || null) })).max(limites.saidasPorCaixa, `No máximo ${limites.saidasPorCaixa} saídas por caixa.`) });
const contagemFinalSchema = z.object({ contagens: contagensSchema });
const unidadeSchema = z.object({ nome: nomeUnidadeSchema.optional(), troco_continua: z.boolean({ error: 'Informe se o troco passa para o próximo caixa.' }).optional(), tolerancia_dinheiro: z.number({ error: 'Informe a tolerância.' }).nonnegative('A tolerância não pode ser negativa.').max(limites.tolerancia, `A tolerância deve ser no máximo ${brl(limites.tolerancia)}.`).transform(centavos).optional(), fechamento_cego: z.boolean({ error: 'Informe se o fechamento é cego.' }).optional() });
const diaAteHoje = dia.refine((data) => data <= hoje(), 'A data não pode ser futura.');
const unidadesFiltroSchema = z.string({ error: 'Unidades inválidas.' }).regex(/^[1-9]\d*(,[1-9]\d*)*$/, 'Unidades inválidas.').optional().transform((value) => value ? [...new Set(value.split(',').map(Number))] : []);
const observacaoCofreSchema = z.string().trim().max(limites.observacaoCofre, `A observação deve ter no máximo ${limites.observacaoCofre} caracteres.`).optional().transform((texto) => texto || null);
const somaCedulas = (itens: { denominacao: number; quantidade: number }[]) => centavos(itens.reduce((soma, item) => soma + item.denominacao * item.quantidade, 0));
// cédulas e moedas do lançamento (as de quantidade zero ficam de fora); o valor do lançamento é a soma delas
const cedulasCofreSchema = contagensSchema.transform((itens) => itens.filter((item) => item.quantidade > 0))
  .refine((itens) => itens.length > 0, 'Informe a quantidade das cédulas e moedas.')
  .refine((itens) => new Set(itens.map((item) => item.denominacao)).size === itens.length, 'Cédula ou moeda repetida.')
  .refine((itens) => somaCedulas(itens) <= limites.valor, `Valor acima do limite de ${brl(limites.valor)}.`);
// sinal de cada tipo lançado à mão; ajuste e outros vão para os dois lados, conforme o sentido informado
const sinalCofre = { deposito_banco: -1, pagamento_fornecedor: -1, retirada_dono: -1, aporte: 1, ajuste: 0, outros: 0 } as const;
const movimentacaoCofreSchema = z.object({ unidade_id: z.number({ error: 'Informe a unidade.' }).int().positive('Informe a unidade.'), tipo: z.enum(Object.keys(sinalCofre) as [keyof typeof sinalCofre], 'Tipo de movimentação inválido.'), sentido: z.enum(['entrada', 'saida'], 'Informe se o dinheiro entra ou sai.').optional(), cedulas: cedulasCofreSchema, data: diaAteHoje, observacao: observacaoCofreSchema })
  .refine((mov) => sinalCofre[mov.tipo] !== 0 || mov.sentido, 'Informe se o dinheiro entra ou sai.')
  .refine((mov) => sinalCofre[mov.tipo] !== 0 || mov.observacao, 'Informe a observação.');
const transferenciaCofreSchema = z.object({ origem: z.number({ error: 'Informe a unidade de origem.' }).int().positive('Informe a unidade de origem.'), destino: z.number({ error: 'Informe a unidade de destino.' }).int().positive('Informe a unidade de destino.'), cedulas: cedulasCofreSchema, data: diaAteHoje, observacao: observacaoCofreSchema })
  .refine((transferencia) => transferencia.origem !== transferencia.destino, 'A origem e o destino precisam ser unidades diferentes.');
const tiposCofre = ['envio_caixa', 'retirada_troco', 'transferencia', ...Object.keys(sinalCofre)] as const;
const extratoCofreSchema = z.object({ de: dia.optional(), ate: dia.optional(), unidades: unidadesFiltroSchema, tipo: z.enum(tiposCofre, 'Tipo de movimentação inválido.').optional(), excluidas: z.enum(['1']).optional() });
const relatorioSchema = z.object({ de: dia, ate: dia, unidades: unidadesFiltroSchema }).refine((filtro) => filtro.de <= filtro.ate, 'A data inicial é depois da final.');
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
// quem confere (dono e admin sem cargo Caixa) vê a diferença em todas as unidades
const conferente = (user: User) => user.tipo === 'dono' || (user.tipo === 'admin' && !isCaixaOnly(user));
// no fechamento cego da unidade (unidades.fechamento_cego, que a consulta do caixa traz), quem opera o caixa não vê o esperado nem a diferença
const ocultarDiferencas = <T extends { fechamento_cego: number }>(user: User, fechamento: T) => { if (conferente(user) || !fechamento.fechamento_cego) return fechamento; const { diferenca, diferenca_dinheiro, diferenca_cartoes, ...resto } = fechamento as T & { diferenca?: number; diferenca_dinheiro?: number; diferenca_cartoes?: number }; return resto; };
const salvarContagens = (id: number, etapa: 'abertura' | 'fechamento', contagens: z.infer<typeof contagensSchema>) => {
  db.prepare('DELETE FROM contagens_dinheiro WHERE fechamento_id=? AND etapa=?').run(id, etapa);
  const insert = db.prepare('INSERT INTO contagens_dinheiro (fechamento_id,etapa,denominacao,quantidade,total) VALUES (?,?,?,?,?)');
  const itens = contagens.filter((item) => item.quantidade > 0);
  itens.forEach((item) => insert.run(id, etapa, item.denominacao, item.quantidade, centavos(item.denominacao * item.quantidade)));
  return somaCedulas(itens);
};
const salvarCedulasCofre = (movimentacaoId: number, cedulas: z.infer<typeof cedulasCofreSchema>) => {
  const insert = db.prepare('INSERT INTO cofre_cedulas (movimentacao_id,denominacao,quantidade) VALUES (?,?,?)');
  cedulas.forEach((item) => insert.run(movimentacaoId, item.denominacao, item.quantidade));
};
// dono e admin sem cargo Caixa podem abrir caixa com data diferente de hoje
const escolheDataCaixa = (user: User) => user.tipo === 'dono' || (user.tipo === 'admin' && !isCaixaOnly(user));
const semPermissaoData = { erro: 'Você não pode escolher a data do caixa.' };
const unidadeAtiva = (id: number) => !!db.prepare('SELECT id FROM unidades WHERE id=? AND ativo=1').get(id);

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
  const { nome, email: normalized, senha } = cadastroSchema.parse(req.body ?? {});
  if (normalized === adminEmail) return res.status(403).json({ erro: 'Este e-mail é do dono do sistema, que não se cadastra por aqui.' });
  try { const hash = await bcrypt.hash(senha, 10); const result = db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run(nome, normalized, hash, 'funcionario'); const novoId = Number(result.lastInsertRowid); registrar(novoId, 'usuario', novoId, 'Cadastrou-se', null, fotoUsuario(novoId)); const row = db.prepare('SELECT * FROM usuarios WHERE id=?').get(result.lastInsertRowid); res.status(201).json({ usuario: publicUser(row) }); } catch { res.status(409).json({ erro: 'Este e-mail já está cadastrado.' }); }
});
app.post('/api/auth/login', async (req, res) => { const email = String(req.body?.email || '').trim().toLowerCase(); const row: any = db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(email); if (row?.codigo_acesso) return res.status(403).json({ erro: 'Você ainda não criou sua senha. Use o código de primeiro acesso que recebeu.' }); if (!row ||!(await bcrypt.compare(String(req.body?.senha || ''), row.senha_hash))) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' }); const usuario = publicUser(row); const token = jwt.sign({ sub: usuario.id }, secret, { expiresIn: '8h' }); res.json({ token, usuario }); });
// usuário cadastrado pelo dono cria a senha com o código e já entra; o código deixa de valer
app.post('/api/auth/primeiro-acesso', async (req, res) => {
  const { email, codigo, senha } = primeiroAcessoSchema.parse(req.body ?? {});
  const row: any = db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1 AND codigo_acesso IS NOT NULL').get(email);
  if (!row || !timingSafeEqual(Buffer.from(row.codigo_acesso, 'hex'), Buffer.from(hashCodigo(codigo), 'hex'))) return res.status(401).json({ erro: 'E-mail ou código de acesso inválidos.' });
  const hash = await bcrypt.hash(senha, 10);
  const antes = fotoUsuario(row.id);
  if (!db.prepare('UPDATE usuarios SET senha_hash=?, codigo_acesso=NULL WHERE id=? AND codigo_acesso=?').run(hash, row.id, row.codigo_acesso).changes) return res.status(401).json({ erro: 'E-mail ou código de acesso inválidos.' });
  registrar(row.id, 'usuario', row.id, 'Criou a senha', antes, fotoUsuario(row.id));
  const usuario = publicUser(row);
  res.json({ token: jwt.sign({ sub: usuario.id }, secret, { expiresIn: '8h' }), usuario });
});
app.get('/api/auth/me', auth,(req: RequestWithUser, res) => res.json({ usuario: req.user }));
app.get('/api/unidades', auth, (req: RequestWithUser, res) => res.json(req.user!.tipo === 'dono' ? db.prepare('SELECT * FROM unidades WHERE ativo=1 ORDER BY nome').all() : db.prepare('SELECT u.* FROM unidades u JOIN usuario_unidades v ON v.unidade_id=u.id WHERE u.ativo=1 AND v.usuario_id=? ORDER BY u.nome').all(req.user!.id)));
// nome de unidade é único sem diferenciar maiúsculas, inclusive nas letras acentuadas (que o COLLATE NOCASE do SQLite não cobre);
// a unidade ativa com o mesmo nome tem prioridade na mensagem, e a excluída pede a reativação
const unidadesComMesmoNome = (nome: string, ignorarId?: number) => { const chave = nome.toLocaleLowerCase('pt-BR'); return (db.prepare('SELECT id, nome, ativo FROM unidades').all() as { id: number; nome: string; ativo: number }[]).filter((unidade) => unidade.id !== ignorarId && unidade.nome.toLocaleLowerCase('pt-BR') === chave); };
const conflitoDeNomeUnidade = (nome: string, ignorarId?: number) => { const iguais = unidadesComMesmoNome(nome, ignorarId); const ativa = iguais.find((unidade) => unidade.ativo); if (ativa) return `Já existe a unidade ${ativa.nome}.`; return iguais.length ? `Já existe a unidade excluída ${iguais[0].nome}. Reative-a em Unidades excluídas.` : null; };
// cadastro no mesmo formulário da edição: além do nome, já vêm o troco e as regras de fechamento (sem eles, valem os padrões da tabela)
const novaUnidadeSchema = unidadeSchema.extend({ nome: nomeUnidadeSchema });
app.post('/api/unidades', auth, allow('dono'), (req: RequestWithUser, res) => { const { nome, troco_continua = false, tolerancia_dinheiro = 0, fechamento_cego = true } = novaUnidadeSchema.parse(req.body ?? {}); const conflito = conflitoDeNomeUnidade(nome); if (conflito) return res.status(409).json({ erro: conflito }); try { const result = db.prepare('INSERT INTO unidades (nome, troco_continua, tolerancia_dinheiro, fechamento_cego) VALUES (?,?,?,?)').run(nome, troco_continua ? 1 : 0, tolerancia_dinheiro, fechamento_cego ? 1 : 0); const id = Number(result.lastInsertRowid); registrar(req.user!.id, 'unidade', id, 'Criou', null, fotoUnidade(id)); res.status(201).json(db.prepare('SELECT * FROM unidades WHERE id=?').get(id)); } catch { res.status(409).json({ erro: 'Esta unidade já existe.' }); } });
app.patch('/api/unidades/:id', auth, allow('dono'), (req: RequestWithUser, res) => { const { nome, troco_continua, tolerancia_dinheiro, fechamento_cego } = unidadeSchema.parse(req.body); const conflito = nome === undefined ? null : conflitoDeNomeUnidade(nome, Number(req.params.id)); if (conflito) return res.status(409).json({ erro: conflito }); const updates: string[] = []; const params: unknown[] = []; if (nome !== undefined) { updates.push('nome=?'); params.push(nome); } if (troco_continua !== undefined) { updates.push('troco_continua=?'); params.push(troco_continua ? 1 : 0); } if (tolerancia_dinheiro !== undefined) { updates.push('tolerancia_dinheiro=?'); params.push(tolerancia_dinheiro); } if (fechamento_cego !== undefined) { updates.push('fechamento_cego=?'); params.push(fechamento_cego ? 1 : 0); } if (!updates.length) return res.status(400).json({ erro: 'Nada para atualizar.' }); const antes = fotoUnidade(Number(req.params.id)); try { const result = db.prepare(`UPDATE unidades SET ${updates.join(', ')} WHERE id=? AND ativo=1`).run(...params, req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); registrar(req.user!.id, 'unidade', Number(req.params.id), 'Alterou', antes, fotoUnidade(Number(req.params.id))); res.json(db.prepare('SELECT * FROM unidades WHERE id=?').get(req.params.id)); } catch { res.status(409).json({ erro: 'Já existe uma unidade com este nome.' }); } });
// as legadas UNIDADE N ficam de fora: o boot as desativa de novo (db.ts)
app.get('/api/unidades/excluidas', auth, allow('dono'), (_, res) => res.json(db.prepare("SELECT * FROM unidades WHERE ativo=0 AND nome NOT GLOB 'UNIDADE [0-9]*' ORDER BY nome").all()));
app.post('/api/unidades/:id/reativar', auth, allow('dono'), (req: RequestWithUser, res) => { const alvo = db.prepare('SELECT id, nome FROM unidades WHERE id=? AND ativo=0').get(req.params.id) as { id: number; nome: string } | undefined; const ativa = alvo && unidadesComMesmoNome(alvo.nome, alvo.id).find((unidade) => unidade.ativo); if (ativa) return res.status(409).json({ erro: `Já existe a unidade ativa ${ativa.nome}. Renomeie-a antes de reativar esta.` }); const antes = fotoUnidade(Number(req.params.id)); const result = db.prepare("UPDATE unidades SET ativo=1 WHERE id=? AND ativo=0 AND nome NOT GLOB 'UNIDADE [0-9]*'").run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade excluída não encontrada.' }); registrar(req.user!.id, 'unidade', Number(req.params.id), 'Reativou', antes, fotoUnidade(Number(req.params.id))); res.json(db.prepare('SELECT * FROM unidades WHERE id=?').get(req.params.id)); });
app.delete('/api/unidades/:id', auth, allow('dono'), (req: RequestWithUser, res) => { const antes = fotoUnidade(Number(req.params.id)); const result = db.prepare('UPDATE unidades SET ativo=0 WHERE id=? AND ativo=1').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Unidade não encontrada.' }); registrar(req.user!.id, 'unidade', Number(req.params.id), 'Excluiu', antes, fotoUnidade(Number(req.params.id))); res.status(204).end(); });
app.get('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => !acessaUnidade(req.user!, Number(req.params.id)) ? res.status(403).json(semAcessoUnidade) : res.json(db.prepare('SELECT * FROM maquininhas WHERE unidade_id=? AND ativo=1 ORDER BY numero').all(req.params.id)));
app.get('/api/maquininhas', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => res.json((db.prepare('SELECT m.*, u.nome unidade_nome FROM maquininhas m JOIN unidades u ON u.id=m.unidade_id WHERE m.ativo=1 ORDER BY u.nome, m.numero').all() as { unidade_id: number }[]).filter((row) => acessaUnidade(req.user!, row.unidade_id))));
app.post('/api/unidades/:id/maquininhas', auth, (req: RequestWithUser, res) => { if (!unidadeAtiva(Number(req.params.id))) return res.status(404).json({ erro: 'Unidade não encontrada.' }); if (!acessaUnidade(req.user!, Number(req.params.id))) return res.status(403).json(semAcessoUnidade); const { nome, numero, numero_serie } = maquininhaSchema.parse(req.body ?? {}); try { const result = db.prepare('INSERT INTO maquininhas (unidade_id,nome,numero,numero_serie) VALUES (?,?,?,?)').run(req.params.id, nome, numero, numero_serie); const id = Number(result.lastInsertRowid); registrar(req.user!.id, 'maquininha', id, 'Criou', null, fotoMaquininha(id)); res.status(201).json(db.prepare('SELECT * FROM maquininhas WHERE id=?').get(id)); } catch { res.status(409).json({ erro: 'Número de série já cadastrado nesta unidade.' }); } });
app.delete('/api/maquininhas/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => { const maquininha = db.prepare('SELECT unidade_id FROM maquininhas WHERE id=? AND ativo=1').get(req.params.id) as { unidade_id: number } | undefined; if (!maquininha) return res.status(404).json({ erro: 'Maquininha não encontrada.' }); if (!acessaUnidade(req.user!, maquininha.unidade_id)) return res.status(403).json(semAcessoUnidade); const antes = fotoMaquininha(Number(req.params.id)); db.prepare('UPDATE maquininhas SET ativo=0 WHERE id=?').run(req.params.id); registrar(req.user!.id, 'maquininha', Number(req.params.id), 'Excluiu', antes, fotoMaquininha(Number(req.params.id))); res.status(204).end(); });
// edita só identificação (nome, número, série): os caixas guardam o id, então a correção aparece também nos caixas antigos; a unidade não muda, para o histórico da unidade continuar coerente
app.patch('/api/maquininhas/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => { const maquininha = db.prepare('SELECT unidade_id FROM maquininhas WHERE id=? AND ativo=1').get(req.params.id) as { unidade_id: number } | undefined; if (!maquininha) return res.status(404).json({ erro: 'Maquininha não encontrada.' }); if (!acessaUnidade(req.user!, maquininha.unidade_id)) return res.status(403).json(semAcessoUnidade); const { nome, numero, numero_serie } = maquininhaSchema.parse(req.body ?? {}); const antes = fotoMaquininha(Number(req.params.id)); try { db.prepare('UPDATE maquininhas SET nome=?, numero=?, numero_serie=? WHERE id=?').run(nome, numero, numero_serie, req.params.id); } catch { return res.status(409).json({ erro: 'Número de série já cadastrado nesta unidade.' }); } registrar(req.user!.id, 'maquininha', Number(req.params.id), 'Alterou', antes, fotoMaquininha(Number(req.params.id))); res.json(db.prepare('SELECT * FROM maquininhas WHERE id=?').get(req.params.id)); });
app.get('/api/fechamentos', auth, (req: RequestWithUser, res) => { const params: any[] = []; let sql = 'SELECT f.*, u.nome unidade_nome, u.tolerancia_dinheiro, u.fechamento_cego, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id'; const where: string[] = []; if (req.user!.tipo !== 'dono') { where.push('f.unidade_id IN (SELECT unidade_id FROM usuario_unidades WHERE usuario_id=?)'); params.push(req.user!.id); } if (req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) { where.push('f.usuario_id=?'); params.push(req.user!.id); } if (where.length) sql += ` WHERE ${where.join(' AND ')}`; sql += ' ORDER BY f.data_caixa DESC, f.turno DESC, f.criado_em DESC'; res.json((db.prepare(sql).all(...params) as (Fechamento & { fechamento_cego: number })[]).map((row) => ocultarDiferencas(req.user!, { ...row, pode_editar: podeEditar(req.user!, row) }))); });
// uma linha por caixa já finalizado alguma vez (mesmo critério de dia do faturamento); o client agrega os gráficos
// dinheiro_anterior: dinheiro contado no caixa anterior da mesma unidade, calculado antes do filtro de período
app.get('/api/relatorios/caixas', auth, allow('dono'), (req, res) => {
  const { de, ate, unidades } = relatorioSchema.parse(req.query);
  const filtroUnidades = unidades.length ? ` AND unidade_id IN (${unidades.map(() => '?').join(',')})` : '';
  const linhas = db.prepare(`WITH base AS (
    SELECT f.id, f.unidade_id, u.nome unidade_nome, COALESCE(f.troco_continua, u.troco_continua) troco_continua, u.tolerancia_dinheiro, f.usuario_id, usr.nome usuario_nome, f.turno, f.status, f.problema_resolvido, f.data_caixa dia, f.criado_em,
      f.saldo_inicial, f.dinheiro_fisico, f.total_entradas, f.total_maquininhas, f.total_saidas, f.diferenca_dinheiro, f.diferenca_cartoes,
      (SELECT a.dinheiro_fisico FROM fechamentos a WHERE a.unidade_id=f.unidade_id AND a.finalizado_em IS NOT NULL AND a.status<>'aberto' AND (a.data_caixa, a.turno, a.criado_em, a.id) < (f.data_caixa, f.turno, f.criado_em, f.id) ORDER BY a.data_caixa DESC, a.turno DESC, a.criado_em DESC, a.id DESC LIMIT 1) dinheiro_anterior
    FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id
    WHERE f.finalizado_em IS NOT NULL AND u.ativo=1)
  SELECT b.*,
    (SELECT json_group_object(forma_pagamento, valor) FROM entradas WHERE fechamento_id=b.id) entradas,
    (SELECT json_group_array(json_object('id', m.id, 'nome', m.nome, 'numero', m.numero, 'valor', d.valor)) FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=b.id) maquininhas
  FROM base b WHERE dia BETWEEN ? AND ?${filtroUnidades} ORDER BY dia, unidade_nome, criado_em`).all(de, ate, ...unidades) as { troco_continua: number; entradas: string; maquininhas: string }[];
  res.json(linhas.map((linha) => ({ ...linha, troco_continua: linha.troco_continua === 1, entradas: JSON.parse(linha.entradas), maquininhas: JSON.parse(linha.maquininhas) })));
});
app.get('/api/fechamentos/:id', auth, (req: RequestWithUser, res) => { const fechamento: any = db.prepare('SELECT f.*, u.nome unidade_nome, u.tolerancia_dinheiro, u.fechamento_cego, usr.nome usuario_nome, conf.nome conferido_por_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id LEFT JOIN usuarios conf ON conf.id=f.conferido_por WHERE f.id=?').get(req.params.id); if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (!acessaUnidade(req.user!, fechamento.unidade_id)) return res.status(403).json(semAcessoUnidade); if ((req.user!.tipo === 'funcionario' || isCaixaOnly(req.user)) && fechamento.usuario_id !== req.user!.id) return res.status(403).json({ erro: 'Você só pode consultar os fechamentos que você mesmo realizou.' }); res.json({ fechamento: ocultarDiferencas(req.user!, { ...fechamento, pode_editar: podeEditar(req.user!, fechamento) }), entradas: db.prepare('SELECT * FROM entradas WHERE fechamento_id=?').all(req.params.id), maquininhas: db.prepare('SELECT d.*, m.nome, m.numero, m.numero_serie FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=?').all(req.params.id), saidas: db.prepare('SELECT s.id, s.valor, s.motivo_id, s.observacao, COALESCE(m.nome, s.motivo) motivo FROM saidas s LEFT JOIN motivos_saida m ON m.id=s.motivo_id WHERE s.fechamento_id=? ORDER BY s.id').all(req.params.id), contagens: db.prepare('SELECT * FROM contagens_dinheiro WHERE fechamento_id=? ORDER BY etapa, denominacao DESC').all(req.params.id) }); });
app.post('/api/fechamentos', auth, (req: RequestWithUser, res) => {
  const { data_caixa = hoje(), unidade_id, turno, contagens } = aberturaSchema.parse(req.body);
  if (!unidadeAtiva(unidade_id)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  if (!acessaUnidade(req.user!, unidade_id)) return res.status(403).json(semAcessoUnidade);
  if (data_caixa !== hoje() && !escolheDataCaixa(req.user!)) return res.status(403).json(semPermissaoData);
  const id = db.transaction(() => {
    const result = db.prepare("INSERT INTO fechamentos (unidade_id,usuario_id,turno,data_caixa,saldo_inicial,status) VALUES (?,?,?,?,0,'aberto')").run(unidade_id, req.user!.id, turno, data_caixa);
    const novoId = Number(result.lastInsertRowid);
    salvarTotal(novoId, 'saldo_inicial', salvarContagens(novoId, 'abertura', contagens));
    return novoId;
  })();
  registrar(req.user!.id, 'caixa', id, 'Abriu', null, fotoCaixa(id));
  res.status(201).json({ id, mensagem: 'Caixa aberto.' });
});
app.put('/api/fechamentos/:id/abertura', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  const { data_caixa, unidade_id, turno, contagens } = aberturaSchema.parse(req.body);
  if (!unidadeAtiva(unidade_id)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  if (!acessaUnidade(req.user!, unidade_id)) return res.status(403).json(semAcessoUnidade);
  const atual = (db.prepare('SELECT data_caixa FROM fechamentos WHERE id=?').get(fechamento.id) as { data_caixa: string }).data_caixa;
  if (data_caixa && data_caixa !== atual && !escolheDataCaixa(req.user!)) return res.status(403).json(semPermissaoData);
  db.transaction(() => {
    db.prepare('UPDATE fechamentos SET unidade_id=?, turno=?, data_caixa=? WHERE id=?').run(unidade_id, turno, data_caixa ?? atual, fechamento.id);
    // maquininhas pertencem à unidade; ao trocar de unidade os relatórios anteriores deixam de valer
    if (unidade_id !== fechamento.unidade_id) { db.prepare('DELETE FROM detalhes_maquininha WHERE fechamento_id=?').run(fechamento.id); salvarTotal(fechamento.id, 'total_maquininhas', 0); }
    salvarTotal(fechamento.id, 'saldo_inicial', salvarContagens(fechamento.id, 'abertura', contagens));
  })();
  registrar(req.user!.id, 'caixa', fechamento.id, 'Alterou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'Abertura salva.' });
});
app.put('/api/fechamentos/:id/entradas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  const { entradas } = entradasSchema.parse(req.body);
  db.transaction(() => {
    db.prepare('DELETE FROM entradas WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare('INSERT INTO entradas (fechamento_id,forma_pagamento,valor) VALUES (?,?,?)');
    Object.entries(entradas).forEach(([forma, valor]) => insert.run(fechamento.id, forma, valor));
    salvarTotal(fechamento.id, 'total_entradas', Object.values(entradas).reduce((sum: number, valor) => sum + (valor || 0), 0));
  })();
  registrar(req.user!.id, 'caixa', fechamento.id, 'Alterou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'Entradas salvas.' });
});
app.put('/api/fechamentos/:id/maquininhas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  const { maquininhas } = maquininhasSchema.parse(req.body);
  const validas = new Set((db.prepare('SELECT id FROM maquininhas WHERE unidade_id=? AND ativo=1').all(fechamento.unidade_id) as { id: number }[]).map((item) => item.id));
  if (maquininhas.some((item) => !validas.has(item.maquininha_id))) return res.status(400).json({ erro: 'Maquininha não pertence à unidade deste caixa.' });
  db.transaction(() => {
    db.prepare('DELETE FROM detalhes_maquininha WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare('INSERT INTO detalhes_maquininha (fechamento_id,maquininha_id,valor) VALUES (?,?,?)');
    maquininhas.forEach((item) => insert.run(fechamento.id, item.maquininha_id, item.valor));
    salvarTotal(fechamento.id, 'total_maquininhas', maquininhas.reduce((sum, item) => sum + item.valor, 0));
  })();
  registrar(req.user!.id, 'caixa', fechamento.id, 'Alterou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'Maquininhas salvas.' });
});
app.put('/api/fechamentos/:id/saidas', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  const { saidas } = saidasSchema.parse(req.body);
  // aceita motivo já excluído: um caixa reaberto mantém o motivo que tinha
  const existe = db.prepare('SELECT id FROM motivos_saida WHERE id=?');
  if (saidas.some((item) => !existe.get(item.motivo_id))) return res.status(400).json({ erro: 'Motivo de saída não encontrado.' });
  db.transaction(() => {
    db.prepare('DELETE FROM saidas WHERE fechamento_id=?').run(fechamento.id);
    const insert = db.prepare("INSERT INTO saidas (fechamento_id,valor,motivo,motivo_id,observacao) VALUES (?,?,'',?,?)");
    saidas.forEach((item) => insert.run(fechamento.id, item.valor, item.motivo_id, item.observacao));
    salvarTotal(fechamento.id, 'total_saidas', saidas.reduce((sum, item) => sum + item.valor, 0));
  })();
  registrar(req.user!.id, 'caixa', fechamento.id, 'Alterou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'Saídas salvas.' });
});
app.put('/api/fechamentos/:id/contagem-final', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  const { contagens } = contagemFinalSchema.parse(req.body);
  db.transaction(() => salvarTotal(fechamento.id, 'dinheiro_fisico', salvarContagens(fechamento.id, 'fechamento', contagens)))();
  registrar(req.user!.id, 'caixa', fechamento.id, 'Alterou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'Contagem final salva.' });
});
// mantém a data da primeira finalização para o caixa reaberto não mudar de dia no faturamento
app.post('/api/fechamentos/:id/finalizar', auth, (req: RequestWithUser, res) => {
  const fechamento = carregarEditavel(req, res); if (!fechamento) return;
  const antes = fotoCaixa(fechamento.id);
  db.prepare("UPDATE fechamentos SET status='finalizado', atualizado_em=CURRENT_TIMESTAMP, movimenta_cofre=CASE WHEN finalizado_em IS NULL THEN 1 ELSE movimenta_cofre END, finalizado_em=COALESCE(finalizado_em, CURRENT_TIMESTAMP), troco_continua=COALESCE(troco_continua, (SELECT troco_continua FROM unidades WHERE id=fechamentos.unidade_id)) WHERE id=?").run(fechamento.id);
  registrar(req.user!.id, 'caixa', fechamento.id, 'Finalizou', antes, fotoCaixa(fechamento.id));
  res.json({ mensagem: 'CAIXA FINALIZADO' });
});
app.post('/api/fechamentos/:id/conferir', auth, allow('dono'), (req: RequestWithUser, res) => { const fechamento = db.prepare('SELECT status FROM fechamentos WHERE id=?').get(req.params.id) as { status: string } | undefined; if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (fechamento.status === 'aberto') return res.status(409).json({ erro: 'Finalize o caixa antes de conferir.' }); const resolved = req.body?.problema_resolvido === true ? 1 : req.body?.problema_resolvido === false ? 0 : null; const unmark = req.body?.desmarcar === true; const antes = fotoCaixa(Number(req.params.id)); db.prepare("UPDATE fechamentos SET status=?, problema_resolvido=?, conferido_por=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(unmark ? 'finalizado' : 'conferido', unmark ? null : resolved, unmark ? null : req.user!.id, req.params.id); registrar(req.user!.id, 'caixa', Number(req.params.id), unmark ? 'Desfez a conferência' : 'Conferiu', antes, fotoCaixa(Number(req.params.id))); res.json({ mensagem: unmark ? 'Conferência desmarcada.' : 'Caixa conferido com sucesso.' }); });
app.post('/api/fechamentos/:id/reabrir', auth, (req: RequestWithUser, res) => { const fechamento = db.prepare('SELECT usuario_id,status FROM fechamentos WHERE id=?').get(req.params.id) as Fechamento | undefined; if (!fechamento) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (!podeEditar(req.user!, fechamento)) return res.status(403).json({ erro: 'Você só pode editar seus próprios caixas.' }); if (req.user?.tipo === 'funcionario' && fechamento.status === 'conferido') return res.status(403).json({ erro: 'Este caixa já foi conferido pelo dono e não pode mais ser editado.' }); const antes = fotoCaixa(Number(req.params.id)); db.prepare("UPDATE fechamentos SET status='aberto', problema_resolvido=NULL, conferido_por=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id); registrar(req.user!.id, 'caixa', Number(req.params.id), 'Reabriu', antes, fotoCaixa(Number(req.params.id))); res.json({ mensagem: 'Caixa reaberto para edição.' }); });
app.delete('/api/fechamentos/:id', auth, allow('dono'), (req: RequestWithUser, res) => { const antes = fotoCaixa(Number(req.params.id)); const result = db.prepare('DELETE FROM fechamentos WHERE id=?').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Fechamento não encontrado.' }); registrar(req.user!.id, 'caixa', Number(req.params.id), 'Excluiu', antes, null); res.json({ mensagem: 'Caixa excluído com sucesso.' }); });
// Cofre (só o dono). Total = soma do extrato; o fundo na gaveta é o saldo inicial dos caixas abertos que vão movimentar o cofre ao finalizar.
// As cédulas seguem a mesma divisão: as do extrato (cofre_extrato_cedulas) somam o total e as da abertura desses caixas, o fundo na gaveta
const naGaveta = "f.status='aberto' AND (f.movimenta_cofre=1 OR f.finalizado_em IS NULL)";
type CedulaUnidade = { unidade_id: number; denominacao: number; quantidade: number };
app.get('/api/cofre', auth, allow('dono'), (_, res) => {
  const saldos = db.prepare(`SELECT u.id unidade_id, u.nome,
      ROUND(COALESCE((SELECT SUM(e.valor) FROM cofre_extrato e WHERE e.unidade_id=u.id AND e.ativo=1), 0), 2) total,
      ROUND(COALESCE((SELECT SUM(f.saldo_inicial) FROM fechamentos f WHERE f.unidade_id=u.id AND ${naGaveta}), 0), 2) fundo_gaveta
    FROM unidades u WHERE u.ativo=1 ORDER BY u.nome`).all() as { unidade_id: number }[];
  const doTotal = db.prepare('SELECT unidade_id, denominacao, SUM(quantidade) quantidade FROM cofre_extrato_cedulas WHERE ativo=1 GROUP BY unidade_id, denominacao HAVING SUM(quantidade)<>0 ORDER BY denominacao DESC').all() as CedulaUnidade[];
  const daGaveta = db.prepare(`SELECT f.unidade_id, c.denominacao, SUM(c.quantidade) quantidade FROM contagens_dinheiro c JOIN fechamentos f ON f.id=c.fechamento_id WHERE c.etapa='abertura' AND c.quantidade<>0 AND ${naGaveta} GROUP BY f.unidade_id, c.denominacao ORDER BY c.denominacao DESC`).all() as CedulaUnidade[];
  const daUnidade = (linhas: CedulaUnidade[], unidadeId: number) => linhas.filter((linha) => linha.unidade_id === unidadeId).map(({ denominacao, quantidade }) => ({ denominacao, quantidade }));
  res.json(saldos.map((saldo) => ({ ...saldo, cedulas: daUnidade(doTotal, saldo.unidade_id), cedulas_gaveta: daUnidade(daGaveta, saldo.unidade_id) })));
});
app.get('/api/cofre/movimentacoes', auth, allow('dono'), (req, res) => {
  const { de, ate, unidades, tipo, excluidas } = extratoCofreSchema.parse(req.query);
  const where: string[] = []; const params: unknown[] = [];
  if (de) { where.push('e.data >= ?'); params.push(de); }
  if (ate) { where.push('e.data <= ?'); params.push(ate); }
  if (unidades.length) { where.push(`e.unidade_id IN (${unidades.map(() => '?').join(',')})`); params.push(...unidades); }
  if (tipo) { where.push('e.tipo = ?'); params.push(tipo); }
  const filtro = where.length ? ` AND ${where.join(' AND ')}` : '';
  const movimentacoes = db.prepare(`SELECT e.*, u.nome unidade_nome, usr.nome usuario_nome, exc.nome excluido_por_nome, f.turno,
      (SELECT u2.nome FROM cofre_movimentacoes m2 JOIN unidades u2 ON u2.id=m2.unidade_id WHERE m2.transferencia_id=e.transferencia_id AND m2.id<>e.movimentacao_id) contraparte_nome
    FROM cofre_extrato e JOIN unidades u ON u.id=e.unidade_id JOIN usuarios usr ON usr.id=e.usuario_id LEFT JOIN usuarios exc ON exc.id=e.excluido_por LEFT JOIN fechamentos f ON f.id=e.fechamento_id
    WHERE ${excluidas ? '1=1' : 'e.ativo=1'}${filtro} ORDER BY e.data DESC, e.criado_em DESC, e.chave DESC`).all(...params) as { chave: string }[];
  // cédulas de cada linha, sem sinal (o sentido é o do valor); lançamentos anteriores às cédulas e caixas sem contagem vêm sem
  const cedulas = new Map<string, { denominacao: number; quantidade: number }[]>();
  for (const { chave, ...cedula } of db.prepare(`SELECT e.chave, e.denominacao, ABS(e.quantidade) quantidade FROM cofre_extrato_cedulas e WHERE ${excluidas ? '1=1' : 'e.ativo=1'}${filtro} ORDER BY e.denominacao DESC`).all(...params) as { chave: string; denominacao: number; quantidade: number }[]) cedulas.set(chave, [...(cedulas.get(chave) ?? []), cedula]);
  const totais = db.prepare(`SELECT e.tipo, ROUND(SUM(CASE WHEN e.valor > 0 THEN e.valor ELSE 0 END), 2) entradas, ROUND(SUM(CASE WHEN e.valor < 0 THEN -e.valor ELSE 0 END), 2) saidas
    FROM cofre_extrato e WHERE e.ativo=1${filtro} GROUP BY e.tipo`).all(...params);
  res.json({ movimentacoes: movimentacoes.map((mov) => ({ ...mov, cedulas: cedulas.get(mov.chave) ?? [] })), totais });
});
app.post('/api/cofre/movimentacoes', auth, allow('dono'), (req: RequestWithUser, res) => {
  const { unidade_id, tipo, sentido, cedulas, data, observacao } = movimentacaoCofreSchema.parse(req.body);
  if (!unidadeAtiva(unidade_id)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  const sinal = sinalCofre[tipo] || (sentido === 'entrada' ? 1 : -1);
  const id = db.transaction(() => {
    const novoId = Number(db.prepare('INSERT INTO cofre_movimentacoes (unidade_id,tipo,valor,data,observacao,usuario_id) VALUES (?,?,?,?,?,?)').run(unidade_id, tipo, sinal * somaCedulas(cedulas), data, observacao, req.user!.id).lastInsertRowid);
    salvarCedulasCofre(novoId, cedulas);
    return novoId;
  })();
  registrar(req.user!.id, 'cofre', id, 'Criou', null, fotoMovimentacao(id));
  res.status(201).json({ id, mensagem: 'Movimentação lançada.' });
});
app.post('/api/cofre/transferencias', auth, allow('dono'), (req: RequestWithUser, res) => {
  const { origem, destino, cedulas, data, observacao } = transferenciaCofreSchema.parse(req.body);
  if (!unidadeAtiva(origem) || !unidadeAtiva(destino)) return res.status(400).json({ erro: 'Unidade não encontrada.' });
  const valor = somaCedulas(cedulas);
  const id = db.transaction(() => {
    const insert = db.prepare("INSERT INTO cofre_movimentacoes (unidade_id,tipo,valor,data,observacao,usuario_id,transferencia_id) VALUES (?,'transferencia',?,?,?,?,?)");
    const origemId = Number(insert.run(origem, -valor, data, observacao, req.user!.id, null).lastInsertRowid);
    db.prepare('UPDATE cofre_movimentacoes SET transferencia_id=? WHERE id=?').run(origemId, origemId);
    const destinoId = Number(insert.run(destino, valor, data, observacao, req.user!.id, origemId).lastInsertRowid);
    salvarCedulasCofre(origemId, cedulas); salvarCedulasCofre(destinoId, cedulas);
    return origemId;
  })();
  registrar(req.user!.id, 'cofre', id, 'Criou', null, fotoMovimentacao(id));
  res.status(201).json({ id, mensagem: 'Transferência lançada.' });
});
// exclusão lógica; numa transferência sai das duas unidades. Os caixas não aparecem aqui: mudam reabrindo ou excluindo o caixa
app.delete('/api/cofre/movimentacoes/:id', auth, allow('dono'), (req: RequestWithUser, res) => {
  const mov = db.prepare('SELECT id, transferencia_id FROM cofre_movimentacoes WHERE id=? AND ativo=1').get(req.params.id) as { id: number; transferencia_id: number | null } | undefined;
  if (!mov) return res.status(404).json({ erro: 'Movimentação não encontrada.' });
  const alvo = mov.transferencia_id ?? mov.id; const antes = fotoMovimentacao(alvo);
  db.prepare(`UPDATE cofre_movimentacoes SET ativo=0, excluido_por=?, excluido_em=CURRENT_TIMESTAMP WHERE ${mov.transferencia_id ? 'transferencia_id' : 'id'}=?`).run(req.user!.id, alvo);
  registrar(req.user!.id, 'cofre', alvo, 'Excluiu', antes, fotoMovimentacao(alvo));
  res.json({ mensagem: 'Movimentação excluída.' });
});
// motivos de saída: qualquer usuário lista e cadastra (na etapa Saídas); só admin e dono renomeiam e excluem
const nomeMotivoSchema = texto('Informe o nome do motivo.', 'O nome do motivo', limites.nomeMotivo);
app.get('/api/motivos-saida', auth, (_, res) => res.json(db.prepare('SELECT id, nome FROM motivos_saida WHERE ativo=1 ORDER BY nome').all()));
// nome já cadastrado devolve o existente (reativando se tinha sido excluído), para quem está no caixa só seguir com ele
app.post('/api/motivos-saida', auth, (req: RequestWithUser, res) => {
  const nome = nomeMotivoSchema.parse(req.body?.nome);
  const existente = db.prepare('SELECT id FROM motivos_saida WHERE nome=?').get(nome) as { id: number } | undefined;
  const antes = existente ? fotoMotivo(existente.id) : null;
  if (existente) db.prepare('UPDATE motivos_saida SET ativo=1 WHERE id=?').run(existente.id);
  const id = existente?.id ?? Number(db.prepare('INSERT INTO motivos_saida (nome) VALUES (?)').run(nome).lastInsertRowid);
  registrar(req.user!.id, 'motivo', id, existente ? 'Reativou' : 'Criou', antes, fotoMotivo(id));
  res.status(existente ? 200 : 201).json(db.prepare('SELECT id, nome FROM motivos_saida WHERE id=?').get(id));
});
app.patch('/api/motivos-saida/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => {
  const nome = nomeMotivoSchema.parse(req.body?.nome);
  const antes = fotoMotivo(Number(req.params.id));
  try { const result = db.prepare('UPDATE motivos_saida SET nome=? WHERE id=? AND ativo=1').run(nome, req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Motivo não encontrado.' }); } catch { return res.status(409).json({ erro: 'Já existe um motivo com este nome.' }); }
  registrar(req.user!.id, 'motivo', Number(req.params.id), 'Alterou', antes, fotoMotivo(Number(req.params.id)));
  res.json(db.prepare('SELECT id, nome FROM motivos_saida WHERE id=?').get(req.params.id));
});
app.delete('/api/motivos-saida/:id', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => { const antes = fotoMotivo(Number(req.params.id)); const result = db.prepare('UPDATE motivos_saida SET ativo=0 WHERE id=? AND ativo=1').run(req.params.id); if (!result.changes) return res.status(404).json({ erro: 'Motivo não encontrado.' }); registrar(req.user!.id, 'motivo', Number(req.params.id), 'Excluiu', antes, fotoMotivo(Number(req.params.id))); res.status(204).end(); });
// o que o client mostra para o usuário: diferenças (quem confere vê sempre; os demais, se alguma unidade vinculada não usa fechamento cego)
// e o campo de data na abertura do caixa
app.get('/api/acesso', auth, (req: RequestWithUser, res) => res.json({ ve_diferenca: conferente(req.user!) || !!db.prepare('SELECT 1 FROM unidades u JOIN usuario_unidades v ON v.unidade_id=u.id WHERE v.usuario_id=? AND u.ativo=1 AND u.fechamento_cego=0').get(req.user!.id), escolhe_data_caixa: escolheDataCaixa(req.user!) }));
const comUnidades = <T extends { id: number }>(usuario: T) => ({ ...usuario, unidades: unidadesVinculadas(usuario.id) });
// primeiro_acesso = 1 enquanto o usuário cadastrado pelo dono não criou a senha
const colunasUsuario = 'id,nome,email,tipo,cargo,ativo,criado_em,codigo_acesso IS NOT NULL primeiro_acesso';
const lerUsuario = (id: number) => comUnidades(db.prepare(`SELECT ${colunasUsuario} FROM usuarios WHERE id=?`).get(id) as { id: number });
const unidadesUsuarioSchema = z.array(z.number().int().refine(unidadeAtiva, 'Unidade não encontrada.'), 'Informe a lista de unidades.');
const novoUsuarioSchema = z.object({ nome: nomeUsuarioSchema, email: emailSchema, cargo: z.string().trim().refine((cargo) => !cargo || nomesCargos.includes(cargo), 'Cargo inválido.').optional().transform((cargo) => cargo || null), tipo: z.enum(['funcionario', 'admin'], 'Perfil inválido.'), unidades: unidadesUsuarioSchema });
const salvarVinculos = (id: number, unidades: number[]) => { db.prepare('DELETE FROM usuario_unidades WHERE usuario_id=?').run(id); const insert = db.prepare('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) VALUES (?,?)'); unidades.forEach((unidadeId) => insert.run(id, unidadeId)); };
app.get('/api/usuarios', auth, allow('admin', 'dono'), (_, res) => res.json((db.prepare(`SELECT ${colunasUsuario} FROM usuarios ORDER BY nome`).all() as { id: number }[]).map(comUnidades)));
// o dono cadastra sem senha: o usuário cria a senha no primeiro acesso com o código, que só aparece aqui e ao gerar outro
app.post('/api/usuarios', auth, allow('dono'), (req: RequestWithUser, res) => {
  const { nome, email, cargo, tipo, unidades } = novoUsuarioSchema.parse(req.body ?? {});
  const existente = db.prepare('SELECT ativo FROM usuarios WHERE email=?').get(email) as { ativo: number } | undefined;
  if (existente?.ativo === 0) return res.status(409).json({ erro: 'Já existe um usuário inativo com este e-mail. Reative-o na lista de usuários, na situação Inativos.' });
  if (email === adminEmail || existente) return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
  const { codigo, hash } = novoCodigoAcesso();
  const id = db.transaction(() => {
    const novoId = Number(db.prepare("INSERT INTO usuarios (nome,email,senha_hash,tipo,cargo,codigo_acesso) VALUES (?,?,'',?,?,?)").run(nome, email, tipo, cargo, hash).lastInsertRowid);
    salvarVinculos(novoId, unidades);
    return novoId;
  })();
  registrar(req.user!.id, 'usuario', id, 'Criou', null, fotoUsuario(id));
  res.status(201).json({ usuario: lerUsuario(id), codigo });
});
// inativação (exclusão lógica): o acesso cai na hora, porque o middleware auth exige ativo=1; caixas, vínculos e cargo ficam para a reativação
app.delete('/api/usuarios/:id', auth, allow('dono'), (req: RequestWithUser, res) => { const alvo = db.prepare('SELECT id, email FROM usuarios WHERE id=? AND ativo=1').get(req.params.id) as { id: number; email: string } | undefined; if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' }); if (alvo.email === adminEmail || alvo.id === req.user!.id) return res.status(409).json({ erro: 'O dono do sistema não pode ser inativado.' }); const antes = fotoUsuario(alvo.id); db.prepare('UPDATE usuarios SET ativo=0 WHERE id=?').run(alvo.id); registrar(req.user!.id, 'usuario', alvo.id, 'Inativou', antes, fotoUsuario(alvo.id)); res.json({ mensagem: 'Usuário inativado.' }); });
app.post('/api/usuarios/:id/reativar', auth, allow('dono'), (req: RequestWithUser, res) => { const antes = fotoUsuario(Number(req.params.id)); if (!db.prepare('UPDATE usuarios SET ativo=1 WHERE id=? AND ativo=0').run(req.params.id).changes) return res.status(404).json({ erro: 'Usuário inativo não encontrado.' }); registrar(req.user!.id, 'usuario', Number(req.params.id), 'Reativou', antes, fotoUsuario(Number(req.params.id))); res.json({ usuario: lerUsuario(Number(req.params.id)) }); });
// troca o código de quem ainda não criou a senha; o anterior deixa de valer
app.post('/api/usuarios/:id/codigo-acesso', auth, allow('dono'), (req: RequestWithUser, res) => { const alvo = db.prepare('SELECT codigo_acesso FROM usuarios WHERE id=? AND ativo=1').get(req.params.id) as { codigo_acesso: string | null } | undefined; if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' }); if (!alvo.codigo_acesso) return res.status(409).json({ erro: 'Este usuário já criou a senha.' }); const { codigo, hash } = novoCodigoAcesso(); db.prepare('UPDATE usuarios SET codigo_acesso=? WHERE id=?').run(hash, req.params.id); const foto = fotoUsuario(Number(req.params.id)); registrar(req.user!.id, 'usuario', Number(req.params.id), 'Gerou código de acesso', foto, foto, [{ campo: 'Código de primeiro acesso', de: null, para: 'novo código gerado (o anterior deixou de valer)' }]); res.json({ codigo }); });
app.patch('/api/usuarios/:id/tipo', auth, allow('dono'), (req: RequestWithUser, res) => { const tipo = ['funcionario', 'admin'].includes(req.body?.tipo) ? req.body.tipo : null; if (!tipo) return res.status(400).json({ erro: 'Perfil inválido.' }); const antes = fotoUsuario(Number(req.params.id)); db.prepare('UPDATE usuarios SET tipo=? WHERE id=? AND email<>?').run(tipo, req.params.id, adminEmail); registrar(req.user!.id, 'usuario', Number(req.params.id), 'Alterou', antes, fotoUsuario(Number(req.params.id))); res.json({ mensagem: 'Perfil atualizado.' }); });
app.patch('/api/usuarios/:id', auth, allow('dono'), async (req: RequestWithUser, res) => { const id = Number(req.params.id); const target: any = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id); if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' }); const antes = fotoUsuario(id); const isOwnerAccount = target.email === adminEmail; const { nome, email, senha, cargo, tipo, unidades } = req.body || {}; const updates: string[] = []; const params: any[] = []; if (nome !== undefined) { updates.push('nome=?'); params.push(nomeUsuarioSchema.parse(nome)); } if (email !== undefined) { updates.push('email=?'); params.push(emailSchema.parse(email)); } if (senha) { updates.push('senha_hash=?', 'codigo_acesso=NULL'); params.push(await bcrypt.hash(senhaSchema.parse(senha), 10)); } // cargos fora da lista que já existiam continuam válidos para quem já os tem
if (cargo !== undefined) { const novoCargo = String(cargo || '').trim() || null; if (novoCargo && !nomesCargos.includes(novoCargo) && novoCargo !== target.cargo) return res.status(400).json({ erro: 'Cargo inválido.' }); updates.push('cargo=?'); params.push(novoCargo); } if (tipo !== undefined && !isOwnerAccount) { if (!['funcionario', 'admin'].includes(tipo)) return res.status(400).json({ erro: 'Perfil inválido.' }); updates.push('tipo=?'); params.push(tipo); } const novasUnidades = unidades === undefined ? undefined : unidadesUsuarioSchema.parse(unidades); if (!updates.length && novasUnidades === undefined) return res.status(400).json({ erro: 'Nenhuma alteração informada.' }); if (updates.length) { try { db.prepare(`UPDATE usuarios SET ${updates.join(',')} WHERE id=?`).run(...params, id); } catch { return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' }); } } if (novasUnidades) db.transaction(() => salvarVinculos(id, novasUnidades))(); registrar(req.user!.id, 'usuario', id, 'Alterou', antes, fotoUsuario(id), senha ? [{ campo: 'Senha', de: null, para: 'redefinida pelo dono' }] : []); res.json({ usuario: lerUsuario(id) }); });
// auditoria: as alterações do período pelo dia de Brasília, mais recentes primeiro; o de/para vem pronto de auditoria.ts.
// O dono vê tudo; o admin, o que já enxerga no sistema: sem o cofre (só do dono), caixas, maquininhas e unidades só das unidades
// vinculadas, usuários e motivos todos; com cargo Caixa, só os caixas que ele mesmo alterou
const auditoriaSchema = z.object({ de: dia, ate: dia }).refine((filtro) => filtro.de <= filtro.ate, 'A data inicial é depois da final.');
app.get('/api/auditoria', auth, allow('admin', 'dono'), (req: RequestWithUser, res) => {
  const { de, ate } = auditoriaSchema.parse(req.query);
  const where = ["date(a.criado_em, '-3 hours') BETWEEN ? AND ?"]; const params: unknown[] = [de, ate];
  if (req.user!.tipo !== 'dono') {
    const vinculadas = unidadesVinculadas(req.user!.id);
    where.push(`(a.entidade IN ('usuario', 'motivo') OR (a.entidade IN ('caixa', 'maquininha', 'unidade') AND a.unidade_id IN (${vinculadas.map(() => '?').join(',') || 'NULL'})))`); params.push(...vinculadas);
    if (isCaixaOnly(req.user)) { where.push("(a.entidade <> 'caixa' OR a.usuario_id = ?)"); params.push(req.user!.id); }
  }
  res.json((db.prepare(`SELECT a.id, a.criado_em, a.usuario_id, u.nome usuario_nome, a.entidade, a.entidade_id, a.acao, a.descricao, a.alteracoes FROM auditoria a JOIN usuarios u ON u.id=a.usuario_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC`).all(...params) as { alteracoes: string }[]).map((linha) => ({ ...linha, alteracoes: JSON.parse(linha.alteracoes) })));
});
// serve o SPA compilado do client quando o build estiver disponível (deploy em container único)
const clientDist = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (err instanceof ZodError) return res.status(400).json({ erro: err.issues[0].message }); console.error(err); res.status(500).json({ erro: 'Erro interno do servidor.' }); });
export const servidor = app.listen(port, '0.0.0.0', (error) => { if (error) throw error; console.log(`API rodando na porta ${port}`); });
