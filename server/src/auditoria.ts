// Auditoria: as rotas tiram uma "foto" do registro antes e depois da alteração e registrar() grava só os campos que mudaram
// (o de/para), com quem fez e quando. A foto usa nomes de campo e valores já formatados para leitura; senha e código de acesso
// nunca entram (a rota avisa que mudaram por `extras`, sem o valor).
import { db } from './db';

export type Entidade = 'caixa' | 'unidade' | 'usuario' | 'maquininha' | 'motivo' | 'cofre';
// unidadeId: a unidade do registro (caixa, maquininha, a própria unidade, lançamento do cofre), para o admin ver só as vinculadas a ele
export type Foto = { descricao: string; campos: Record<string, string>; unidadeId?: number };
export type Alteracao = { campo: string; de: string | null; para: string | null };

const brl = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaBr = (dia: string) => dia.split('-').reverse().join('/');
const turnoBr = (turno: string) => turno === 'JANTAR' ? 'Jantar' : 'Almoço';
const formas: Record<string, string> = { credito: 'Crédito', debito: 'Débito', pix: 'Pix', refeicao: 'Refeição', alimentacao: 'Alimentação', dinheiro: 'Dinheiro' };
const perfis: Record<string, string> = { funcionario: 'Colaborador', admin: 'Admin', dono: 'Dono' };
const tiposCofre: Record<string, string> = { transferencia: 'Transferência entre unidades', deposito_banco: 'Depósito no banco', pagamento_fornecedor: 'Pagamento a fornecedor', retirada_dono: 'Retirada do dono', aporte: 'Aporte', ajuste: 'Ajuste de conferência', outros: 'Outros' };

export function fotoUnidade(id: number): Foto | null {
  const u = db.prepare('SELECT * FROM unidades WHERE id=?').get(id) as { nome: string; troco_continua: number; tolerancia_dinheiro: number; fechamento_cego: number; ativo: number } | undefined;
  if (!u) return null;
  return { descricao: `Unidade ${u.nome}`, unidadeId: id, campos: { Nome: u.nome, 'Troco passa para o próximo caixa': u.troco_continua ? 'Sim' : 'Não', 'Tolerância de quebra': brl(u.tolerancia_dinheiro), 'Fechamento cego': u.fechamento_cego ? 'Ligado' : 'Desligado', Situação: u.ativo ? 'Ativa' : 'Excluída' } };
}

export function fotoUsuario(id: number): Foto | null {
  const u = db.prepare('SELECT nome, email, tipo, cargo, ativo, codigo_acesso IS NOT NULL pendente FROM usuarios WHERE id=?').get(id) as { nome: string; email: string; tipo: string; cargo: string | null; ativo: number; pendente: number } | undefined;
  if (!u) return null;
  const unidades = (db.prepare('SELECT u.nome FROM usuario_unidades v JOIN unidades u ON u.id=v.unidade_id WHERE v.usuario_id=? ORDER BY u.nome').all(id) as { nome: string }[]).map((linha) => linha.nome);
  return { descricao: `Usuário ${u.nome} (${u.email})`, campos: { Nome: u.nome, 'E-mail': u.email, Perfil: perfis[u.tipo] ?? u.tipo, Cargo: u.cargo || '—', Unidades: unidades.join(', ') || '—', Acesso: u.pendente ? 'Aguardando primeiro acesso' : 'Com senha', Situação: u.ativo ? 'Ativo' : 'Inativo' } };
}

export function fotoMaquininha(id: number): Foto | null {
  const m = db.prepare('SELECT m.nome, m.numero, m.numero_serie, m.ativo, m.unidade_id, u.nome unidade FROM maquininhas m JOIN unidades u ON u.id=m.unidade_id WHERE m.id=?').get(id) as { nome: string; numero: string; numero_serie: string; ativo: number; unidade_id: number; unidade: string } | undefined;
  if (!m) return null;
  return { descricao: `Maquininha ${m.nome} (${m.numero}) · ${m.unidade}`, unidadeId: m.unidade_id, campos: { Unidade: m.unidade, Nome: m.nome, Número: m.numero, 'Número de série': m.numero_serie, Situação: m.ativo ? 'Ativa' : 'Excluída' } };
}

export function fotoMotivo(id: number): Foto | null {
  const m = db.prepare('SELECT nome, ativo FROM motivos_saida WHERE id=?').get(id) as { nome: string; ativo: number } | undefined;
  if (!m) return null;
  return { descricao: `Motivo de saída ${m.nome}`, campos: { Nome: m.nome, Situação: m.ativo ? 'Ativo' : 'Excluído' } };
}

// o caixa com os totais de cada etapa e o detalhe que muda nelas (entradas por forma, valor de cada maquininha, a lista de saídas);
// as contagens de cédulas entram só pelos totais (saldo inicial e dinheiro contado)
export function fotoCaixa(id: number): Foto | null {
  const f = db.prepare('SELECT f.*, u.nome unidade FROM fechamentos f JOIN unidades u ON u.id=f.unidade_id WHERE f.id=?').get(id) as { unidade_id: number; unidade: string; turno: string; data_caixa: string; status: string; problema_resolvido: number | null; saldo_inicial: number; total_entradas: number; total_maquininhas: number; total_saidas: number; dinheiro_fisico: number } | undefined;
  if (!f) return null;
  const campos: Record<string, string> = { Unidade: f.unidade, Turno: turnoBr(f.turno), 'Dia do caixa': diaBr(f.data_caixa), Status: f.status === 'aberto' ? 'Em aberto' : f.status === 'conferido' ? 'Conferido' : 'Finalizado' };
  if (f.status === 'conferido') campos.Conferência = f.problema_resolvido === 1 ? 'Certo' : f.problema_resolvido === 0 ? 'Errado' : 'Conferido';
  campos['Saldo inicial'] = brl(f.saldo_inicial);
  for (const entrada of db.prepare('SELECT forma_pagamento, valor FROM entradas WHERE fechamento_id=?').all(id) as { forma_pagamento: string; valor: number }[]) campos[`Entrada ${formas[entrada.forma_pagamento] ?? entrada.forma_pagamento}`] = brl(entrada.valor);
  campos['Entradas (total)'] = brl(f.total_entradas);
  for (const maq of db.prepare('SELECT m.nome, m.numero, d.valor FROM detalhes_maquininha d JOIN maquininhas m ON m.id=d.maquininha_id WHERE d.fechamento_id=? ORDER BY m.numero').all(id) as { nome: string; numero: string; valor: number }[]) campos[`Maquininha ${maq.nome} (${maq.numero})`] = brl(maq.valor);
  campos['Maquininhas (total)'] = brl(f.total_maquininhas);
  const saidas = (db.prepare('SELECT s.valor, COALESCE(m.nome, s.motivo) motivo, s.observacao FROM saidas s LEFT JOIN motivos_saida m ON m.id=s.motivo_id WHERE s.fechamento_id=? ORDER BY s.id').all(id) as { valor: number; motivo: string; observacao: string | null }[]).map((s) => `${brl(s.valor)} ${s.motivo}${s.observacao ? ` (${s.observacao})` : ''}`);
  campos.Saídas = saidas.join('; ') || '—';
  campos['Saídas (total)'] = brl(f.total_saidas);
  campos['Dinheiro contado'] = brl(f.dinheiro_fisico);
  return { descricao: `Caixa #${id} · ${f.unidade} · ${turnoBr(f.turno)} de ${diaBr(f.data_caixa)}`, unidadeId: f.unidade_id, campos };
}

// lançamento manual do cofre, com as cédulas; a transferência é uma alteração só (id da ponta de origem), com origem e destino
export function fotoMovimentacao(id: number): Foto | null {
  const m = db.prepare('SELECT m.*, u.nome unidade FROM cofre_movimentacoes m JOIN unidades u ON u.id=m.unidade_id WHERE m.id=?').get(id) as { tipo: string; valor: number; data: string; observacao: string | null; ativo: number; transferencia_id: number | null; unidade_id: number; unidade: string } | undefined;
  if (!m) return null;
  const cedulas = (db.prepare('SELECT denominacao, quantidade FROM cofre_cedulas WHERE movimentacao_id=? ORDER BY denominacao DESC').all(id) as { denominacao: number; quantidade: number }[]).map((c) => `${c.quantidade.toLocaleString('pt-BR')} × ${brl(c.denominacao)}`);
  const comum = { Cédulas: cedulas.join('; ') || '—', Data: diaBr(m.data), Observação: m.observacao || '—', Situação: m.ativo ? 'Ativa' : 'Excluída' };
  if (m.transferencia_id) {
    const destino = db.prepare('SELECT u.nome FROM cofre_movimentacoes m JOIN unidades u ON u.id=m.unidade_id WHERE m.transferencia_id=? AND m.id<>?').get(m.transferencia_id, m.transferencia_id) as { nome: string } | undefined;
    return { descricao: `Transferência de ${m.unidade} para ${destino?.nome ?? '—'}`, unidadeId: m.unidade_id, campos: { Tipo: tiposCofre.transferencia, Origem: m.unidade, Destino: destino?.nome ?? '—', Valor: brl(Math.abs(m.valor)), ...comum } };
  }
  const tipo = tiposCofre[m.tipo] ?? m.tipo;
  return { descricao: `${tipo} · ${m.unidade} · ${diaBr(m.data)}`, unidadeId: m.unidade_id, campos: { Tipo: tipo, Unidade: m.unidade, Valor: `${m.valor >= 0 ? 'Entrada' : 'Saída'} de ${brl(Math.abs(m.valor))}`, ...comum } };
}

const inserir = db.prepare('INSERT INTO auditoria (usuario_id, entidade, entidade_id, unidade_id, acao, descricao, alteracoes) VALUES (?,?,?,?,?,?,?)');
/** Grava o de/para dos campos que mudaram entre as fotos (antes null = criação; depois null = exclusão de fato).
 * Sem nenhum campo mudado (salvar sem alterar), não grava nada. */
export function registrar(usuarioId: number, entidade: Entidade, id: number, acao: string, antes: Foto | null, depois: Foto | null, extras: Alteracao[] = []) {
  const campos = [...new Set([...Object.keys(antes?.campos ?? {}), ...Object.keys(depois?.campos ?? {})])];
  const alteracoes = [...campos.map((campo) => ({ campo, de: antes?.campos[campo] ?? null, para: depois?.campos[campo] ?? null })).filter((item) => item.de !== item.para), ...extras];
  const foto = depois ?? antes;
  if (!alteracoes.length || !foto) return;
  inserir.run(usuarioId, entidade, id, foto.unidadeId ?? null, acao, foto.descricao, JSON.stringify(alteracoes));
}
