"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("./db");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const port = Number(process.env.PORT || 8080);
const secret = process.env.JWT_SECRET || 'development-secret';
const adminEmail = (process.env.ADMIN_EMAIL || 'dono@empresa.com').toLowerCase();
const publicUser = (row) => ({ id: row.id, nome: row.nome, email: row.email, tipo: row.email === adminEmail ? 'dono' : row.tipo, cargo: row.cargo || null });
// usuários com cargo Caixa só enxergam os próprios fechamentos, mesmo com perfil admin
const isCaixaOnly = (user) => !!user && user.tipo !== 'dono' && String(user.cargo || '').trim().toLowerCase() === 'caixa';
const auth = (req, res, next) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token)
            throw new Error();
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        const row = db_1.db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(Number(decoded.sub));
        if (!row)
            throw new Error();
        req.user = publicUser(row);
        next();
    }
    catch {
        res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    }
};
const allow = (...roles) => (req, res, next) => req.user && roles.includes(req.user.tipo) ? next() : res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
const money = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
    const { nome, email, senha, confirmacao } = req.body || {};
    const normalized = String(email || '').trim().toLowerCase();
    if (!nome || !/^\S+@\S+\.\S+$/.test(normalized) || String(senha).length < 8 || senha !== confirmacao)
        return res.status(400).json({ erro: 'Informe nome, e-mail válido e senhas iguais com pelo menos 8 caracteres.' });
    try {
        const hash = await bcryptjs_1.default.hash(senha, 10);
        const tipo = normalized === adminEmail ? 'dono' : 'funcionario';
        const result = db_1.db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run(nome.trim(), normalized, hash, tipo);
        const row = db_1.db.prepare('SELECT * FROM usuarios WHERE id=?').get(result.lastInsertRowid);
        res.status(201).json({ usuario: publicUser(row) });
    }
    catch {
        res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
});
app.post('/api/auth/login', async (req, res) => { const email = String(req.body?.email || '').trim().toLowerCase(); const row = db_1.db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(email); if (!row || !(await bcryptjs_1.default.compare(String(req.body?.senha || ''), row.senha_hash)))
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' }); const usuario = publicUser(row); const token = jsonwebtoken_1.default.sign({ sub: usuario.id }, secret, { expiresIn: '8h' }); res.json({ token, usuario }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ usuario: req.user }));
app.get('/api/unidades', auth, (_, res) => res.json(db_1.db.prepare('SELECT * FROM unidades WHERE ativo=1 ORDER BY nome').all()));
app.post('/api/unidades', auth, allow('dono'), (req, res) => { const nome = String(req.body?.nome || '').trim(); if (!nome)
    return res.status(400).json({ erro: 'Nome da unidade é obrigatório.' }); try {
    const result = db_1.db.prepare('INSERT INTO unidades (nome) VALUES (?)').run(nome);
    res.status(201).json(db_1.db.prepare('SELECT * FROM unidades WHERE id=?').get(result.lastInsertRowid));
}
catch {
    res.status(409).json({ erro: 'Esta unidade já existe.' });
} });
app.patch('/api/unidades/:id', auth, allow('dono'), (req, res) => { const nome = String(req.body?.nome || '').trim(); if (!nome)
    return res.status(400).json({ erro: 'Nome da unidade é obrigatório.' }); try {
    const result = db_1.db.prepare('UPDATE unidades SET nome=? WHERE id=? AND ativo=1').run(nome, req.params.id);
    if (!result.changes)
        return res.status(404).json({ erro: 'Unidade não encontrada.' });
    res.json(db_1.db.prepare('SELECT * FROM unidades WHERE id=?').get(req.params.id));
}
catch {
    res.status(409).json({ erro: 'Já existe uma unidade com este nome.' });
} });
app.delete('/api/unidades/:id', auth, allow('dono'), (req, res) => { const result = db_1.db.prepare('UPDATE unidades SET ativo=0 WHERE id=? AND ativo=1').run(req.params.id); if (!result.changes)
    return res.status(404).json({ erro: 'Unidade não encontrada.' }); res.status(204).end(); });
app.get('/api/unidades/:id/maquininhas', auth, (req, res) => res.json(db_1.db.prepare('SELECT * FROM maquininhas WHERE unidade_id=? AND ativo=1 ORDER BY numero').all(req.params.id)));
app.get('/api/maquininhas', auth, allow('admin', 'dono'), (_, res) => res.json(db_1.db.prepare('SELECT m.*, u.nome unidade_nome FROM maquininhas m JOIN unidades u ON u.id=m.unidade_id WHERE m.ativo=1 ORDER BY u.nome, m.numero').all()));
app.post('/api/unidades/:id/maquininhas', auth, (req, res) => { const { nome, numero, numero_serie } = req.body || {}; if (!nome || !numero || !numero_serie)
    return res.status(400).json({ erro: 'Preencha nome, número e número de série.' }); try {
    const result = db_1.db.prepare('INSERT INTO maquininhas (unidade_id,nome,numero,numero_serie) VALUES (?,?,?,?)').run(req.params.id, nome, numero, numero_serie);
    res.status(201).json(db_1.db.prepare('SELECT * FROM maquininhas WHERE id=?').get(result.lastInsertRowid));
}
catch {
    res.status(409).json({ erro: 'Número de série já cadastrado nesta unidade.' });
} });
app.delete('/api/maquininhas/:id', auth, allow('admin', 'dono'), (req, res) => { db_1.db.prepare('UPDATE maquininhas SET ativo=0 WHERE id=?').run(req.params.id); res.status(204).end(); });
app.get('/api/fechamentos', auth, (req, res) => { const params = []; let sql = 'SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id'; if (req.user?.tipo === 'funcionario' || isCaixaOnly(req.user)) {
    sql += ' WHERE f.usuario_id=?';
    params.push(req.user.id);
} sql += ' ORDER BY f.criado_em DESC'; res.json(db_1.db.prepare(sql).all(...params)); });
app.get('/api/dashboard/consolidado', auth, allow('dono'), (req, res) => { const from = String(req.query.de || '').trim(); const to = String(req.query.ate || '').trim(); const params = []; let where = "f.status IN ('finalizado','conferido') AND u.ativo=1"; if (from) {
    where += ' AND f.finalizado_em >= ?';
    params.push(from.replace('T', ' '));
} if (to) {
    where += ' AND f.finalizado_em <= ?';
    params.push(to.replace('T', ' ').slice(0, 16) + ':59');
} const units = db_1.db.prepare(`SELECT u.id, u.nome, COUNT(f.id) caixas, COALESCE(SUM(f.total_entradas),0) total_sistema, COALESCE(SUM(f.diferenca),0) diferenca, COALESCE(SUM(f.total_maquininhas),0) total_maquininhas, COALESCE(SUM(f.dinheiro_fisico),0) dinheiro_final FROM unidades u LEFT JOIN fechamentos f ON f.unidade_id=u.id AND ${where} GROUP BY u.id ORDER BY u.nome`).all(...params); const forms = db_1.db.prepare(`SELECT e.forma_pagamento, COALESCE(SUM(e.valor),0) total FROM entradas e JOIN fechamentos f ON f.id=e.fechamento_id JOIN unidades u ON u.id=f.unidade_id WHERE ${where} GROUP BY e.forma_pagamento ORDER BY e.forma_pagamento`).all(...params); const total = units.reduce((sum, item) => sum + Number(item.total_sistema || 0), 0); res.json({ de: from || null, ate: to || null, total_sistema: total, unidades: units, formas_pagamento: forms }); });
app.get('/api/dashboard/faturamento', auth, allow('dono'), (req, res) => { const from = String(req.query.de || '').trim(); const to = String(req.query.ate || '').trim(); const selected = String(req.query.unidades || '').split(',').map(Number).filter(Boolean); const params = []; let where = "f.status IN ('aberto','finalizado','conferido') AND u.ativo=1"; if (from) {
    where += ' AND f.finalizado_em >= ?';
    params.push(from.replace('T', ' '));
} if (to) {
    where += ' AND f.finalizado_em <= ?';
    params.push(to.replace('T', ' ').slice(0, 16) + ':59');
} if (selected.length) {
    where += ` AND f.unidade_id IN (${selected.map(() => '?').join(',')})`;
    params.push(...selected);
} const series = db_1.db.prepare(`SELECT date(f.finalizado_em, '-3 hours') dia, u.id unidade_id, u.nome unidade_nome, COALESCE(SUM(f.total_entradas),0) total FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id WHERE ${where} GROUP BY dia,u.id ORDER BY dia,u.nome`).all(...params); const total = series.reduce((sum, item) => sum + Number(item.total || 0), 0); res.json({ total, series }); });
app.get('/api/fechamentos/:id', auth, (req, res) => { const fechamento = db_1.db.prepare('SELECT f.*, u.nome unidade_nome, usr.nome usuario_nome FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id JOIN usuarios usr ON usr.id=f.usuario_id WHERE f.id=?').get(req.params.id); if (!fechamento)
    return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (isCaixaOnly(req.user) && fechamento.usuario_id !== req.user.id)
    return res.status(403).json({ erro: 'Você só pode consultar os fechamentos que você mesmo realizou.' }); res.json({ fechamento, entradas: db_1.db.prepare('SELECT * FROM entradas WHERE fechamento_id=?').all(req.params.id), maquininhas: db_1.db.prepare('SELECT d.*, m.nome, m.numero, m.numero_serie FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=?').all(req.params.id), saidas: db_1.db.prepare('SELECT * FROM saidas WHERE fechamento_id=?').all(req.params.id), contagens: db_1.db.prepare('SELECT * FROM contagens_dinheiro WHERE fechamento_id=? ORDER BY etapa, denominacao DESC').all(req.params.id) }); });
app.post('/api/fechamentos', auth, (req, res) => { const { unidade_id, saldo_inicial, dinheiro_fisico, contagens = [], entradas = {}, maquininhas = [], saidas = [] } = req.body || {}; if (!unidade_id || Number(saldo_inicial) < 0)
    return res.status(400).json({ erro: 'Informe a unidade e o saldo inicial.' }); const totalEntradas = Object.values(entradas).reduce((sum, value) => sum + money(value), 0); const totalMaquininhas = maquininhas.reduce((sum, item) => sum + money(item.valor), 0); const totalSaidas = saidas.reduce((sum, item) => sum + money(item.valor), 0); const diferenca = money(dinheiro_fisico) + totalMaquininhas - (money(saldo_inicial) + totalEntradas - totalSaidas); const tx = db_1.db.transaction(() => { const result = db_1.db.prepare('INSERT INTO fechamentos (unidade_id,usuario_id,saldo_inicial,dinheiro_fisico,total_entradas,total_maquininhas,total_saidas,diferenca,status,finalizado_em) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(unidade_id, req.user.id, money(saldo_inicial), money(dinheiro_fisico), totalEntradas, totalMaquininhas, totalSaidas, diferenca, 'finalizado'); const id = result.lastInsertRowid; const count = db_1.db.prepare('INSERT INTO contagens_dinheiro (fechamento_id,etapa,denominacao,quantidade,total) VALUES (?,?,?,?,?)'); contagens.filter((item) => item.quantidade > 0).forEach((item) => count.run(id, item.etapa, Number(item.denominacao), Number(item.quantidade), money(Number(item.denominacao) * Number(item.quantidade)))); const entry = db_1.db.prepare('INSERT INTO entradas (fechamento_id,forma_pagamento,valor) VALUES (?,?,?)'); Object.entries(entradas).forEach(([forma, valor]) => entry.run(id, forma, money(valor))); const machine = db_1.db.prepare('INSERT INTO detalhes_maquininha (fechamento_id,maquininha_id,valor) VALUES (?,?,?)'); maquininhas.forEach((item) => machine.run(id, item.maquininha_id, money(item.valor))); const exit = db_1.db.prepare('INSERT INTO saidas (fechamento_id,valor,motivo) VALUES (?,?,?)'); saidas.filter((item) => money(item.valor) > 0 && item.motivo).forEach((item) => exit.run(id, money(item.valor), item.motivo)); return id; }); res.status(201).json({ id: tx(), mensagem: 'CAIXA FINALIZADO' }); });
app.post('/api/fechamentos/:id/conferir', auth, allow('admin', 'dono'), (req, res) => { const resolved = req.body?.problema_resolvido === true ? 1 : req.body?.problema_resolvido === false ? 0 : null; const unmark = req.body?.desmarcar === true; db_1.db.prepare("UPDATE fechamentos SET status=?, problema_resolvido=?, conferido_por=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(unmark ? 'finalizado' : 'conferido', unmark ? null : resolved, unmark ? null : req.user.id, req.params.id); res.json({ mensagem: unmark ? 'Conferência desmarcada.' : 'Caixa conferido com sucesso.' }); });
app.post('/api/fechamentos/:id/reabrir', auth, (req, res) => { const fechamento = db_1.db.prepare('SELECT usuario_id,status FROM fechamentos WHERE id=?').get(req.params.id); if (!fechamento)
    return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (req.user?.tipo === 'funcionario' && fechamento.usuario_id !== req.user.id)
    return res.status(403).json({ erro: 'Você só pode editar seus próprios caixas.' }); if (req.user?.tipo === 'funcionario' && fechamento.status === 'conferido')
    return res.status(403).json({ erro: 'Este caixa já foi conferido pelo dono e não pode mais ser editado.' }); db_1.db.prepare("UPDATE fechamentos SET status='aberto', problema_resolvido=NULL, conferido_por=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id); res.json({ mensagem: 'Caixa reaberto para edição.' }); });
app.put('/api/fechamentos/:id', auth, (req, res) => { const id = Number(req.params.id); const current = db_1.db.prepare('SELECT usuario_id FROM fechamentos WHERE id=?').get(id); if (!current)
    return res.status(404).json({ erro: 'Fechamento não encontrado.' }); if (req.user?.tipo === 'funcionario' && current.usuario_id !== req.user.id)
    return res.status(403).json({ erro: 'Você só pode editar seus próprios caixas.' }); const { unidade_id, saldo_inicial, dinheiro_fisico, contagens = [], entradas = {}, maquininhas = [], saidas = [] } = req.body || {}; const totalEntradas = Object.values(entradas).reduce((sum, value) => sum + money(value), 0); const totalMaquininhas = maquininhas.reduce((sum, item) => sum + money(item.valor), 0); const totalSaidas = saidas.reduce((sum, item) => sum + money(item.valor), 0); const diferenca = money(dinheiro_fisico) + totalMaquininhas - (money(saldo_inicial) + totalEntradas - totalSaidas); const tx = db_1.db.transaction(() => { db_1.db.prepare('UPDATE fechamentos SET unidade_id=?, saldo_inicial=?, dinheiro_fisico=?, total_entradas=?, total_maquininhas=?, total_saidas=?, diferenca=?, status=\'finalizado\', atualizado_em=CURRENT_TIMESTAMP, finalizado_em=CURRENT_TIMESTAMP WHERE id=?').run(unidade_id, money(saldo_inicial), money(dinheiro_fisico), totalEntradas, totalMaquininhas, totalSaidas, diferenca, id); db_1.db.prepare('DELETE FROM contagens_dinheiro WHERE fechamento_id=?').run(id); const count = db_1.db.prepare('INSERT INTO contagens_dinheiro (fechamento_id,etapa,denominacao,quantidade,total) VALUES (?,?,?,?,?)'); contagens.filter((item) => item.quantidade > 0).forEach((item) => count.run(id, item.etapa, Number(item.denominacao), Number(item.quantidade), money(Number(item.denominacao) * Number(item.quantidade)))); db_1.db.prepare('DELETE FROM entradas WHERE fechamento_id=?').run(id); const entry = db_1.db.prepare('INSERT INTO entradas (fechamento_id,forma_pagamento,valor) VALUES (?,?,?)'); Object.entries(entradas).forEach(([forma, valor]) => entry.run(id, forma, money(valor))); db_1.db.prepare('DELETE FROM detalhes_maquininha WHERE fechamento_id=?').run(id); const machine = db_1.db.prepare('INSERT INTO detalhes_maquininha (fechamento_id,maquininha_id,valor) VALUES (?,?,?)'); maquininhas.forEach((item) => machine.run(id, item.maquininha_id, money(item.valor))); db_1.db.prepare('DELETE FROM saidas WHERE fechamento_id=?').run(id); const exit = db_1.db.prepare('INSERT INTO saidas (fechamento_id,valor,motivo) VALUES (?,?,?)'); saidas.filter((item) => money(item.valor) > 0 && item.motivo).forEach((item) => exit.run(id, money(item.valor), item.motivo)); }); tx(); res.json({ mensagem: 'Caixa atualizado com sucesso.' }); });
app.delete('/api/fechamentos/:id', auth, allow('dono'), (req, res) => { const result = db_1.db.prepare('DELETE FROM fechamentos WHERE id=?').run(req.params.id); if (!result.changes)
    return res.status(404).json({ erro: 'Fechamento não encontrado.' }); res.json({ mensagem: 'Caixa excluído com sucesso.' }); });
app.patch('/api/fechamentos/:id/turno', auth, (req, res) => { const turno = ['ALMOÇO', 'JANTAR'].includes(req.body?.turno) ? req.body.turno : null; if (!turno)
    return res.status(400).json({ erro: 'Turno inválido.' }); const result = db_1.db.prepare('UPDATE fechamentos SET turno=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?').run(turno, req.params.id); if (!result.changes)
    return res.status(404).json({ erro: 'Fechamento não encontrado.' }); res.json({ mensagem: 'Turno salvo.' }); });
app.get('/api/usuarios', auth, allow('admin', 'dono'), (_, res) => res.json(db_1.db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios ORDER BY nome').all()));
app.patch('/api/usuarios/:id/tipo', auth, allow('dono'), (req, res) => { const tipo = ['funcionario', 'admin'].includes(req.body?.tipo) ? req.body.tipo : null; if (!tipo)
    return res.status(400).json({ erro: 'Perfil inválido.' }); db_1.db.prepare('UPDATE usuarios SET tipo=? WHERE id=? AND email<>?').run(tipo, req.params.id, adminEmail); res.json({ mensagem: 'Perfil atualizado.' }); });
app.patch('/api/usuarios/:id', auth, allow('dono'), async (req, res) => { const id = Number(req.params.id); const target = db_1.db.prepare('SELECT * FROM usuarios WHERE id=?').get(id); if (!target)
    return res.status(404).json({ erro: 'Usuário não encontrado.' }); const isOwnerAccount = target.email === adminEmail; const { nome, email, senha, cargo, tipo } = req.body || {}; const updates = []; const params = []; if (nome !== undefined) {
    if (!String(nome).trim())
        return res.status(400).json({ erro: 'Informe o nome.' });
    updates.push('nome=?');
    params.push(String(nome).trim());
} if (email !== undefined) {
    const normalized = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized))
        return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    updates.push('email=?');
    params.push(normalized);
} if (senha) {
    if (String(senha).length < 8)
        return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
    updates.push('senha_hash=?');
    params.push(await bcryptjs_1.default.hash(senha, 10));
} if (cargo !== undefined) {
    updates.push('cargo=?');
    params.push(String(cargo || '').trim() || null);
} if (tipo !== undefined && !isOwnerAccount) {
    if (!['funcionario', 'admin'].includes(tipo))
        return res.status(400).json({ erro: 'Perfil inválido.' });
    updates.push('tipo=?');
    params.push(tipo);
} if (!updates.length)
    return res.status(400).json({ erro: 'Nenhuma alteração informada.' }); try {
    db_1.db.prepare(`UPDATE usuarios SET ${updates.join(',')} WHERE id=?`).run(...params, id);
}
catch {
    return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' });
} const row = db_1.db.prepare('SELECT id,nome,email,tipo,cargo,ativo,criado_em FROM usuarios WHERE id=?').get(id); res.json({ usuario: row }); });
// serve o SPA compilado do client quando o build estiver disponível (deploy em container único)
const clientDist = node_path_1.default.resolve(__dirname, '../../dist/client');
app.use(express_1.default.static(clientDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(node_path_1.default.join(clientDist, 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ erro: 'Erro interno do servidor.' }); });
app.listen(port, '0.0.0.0', () => console.log(`API rodando na porta ${port}`));
