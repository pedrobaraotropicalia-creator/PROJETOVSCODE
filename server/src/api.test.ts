import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const email = 'dono@cofre.test';
const senha = randomBytes(12).toString('hex');
process.env.DATABASE_FILE = ':memory:';
process.env.JWT_SECRET = randomBytes(16).toString('hex');
process.env.ADMIN_EMAIL = email;
process.env.PORT = '0';

let base = '';
let token = '';
let fechar: () => void;
let banco: typeof import('./db').db;
let unidades: { id: number; nome: string }[] = [];
const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function api(metodo: string, caminho: string, corpo?: unknown, comoToken = token) {
  const resposta = await fetch(`${base}/api${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${comoToken}` }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}
const notas = (valor: number) => [{ denominacao: 1, quantidade: valor }];
async function caixa(unidadeId: number, saldoInicial: number, contado: number, opcoes: { finalizar?: boolean; data?: string } = {}) {
  const { corpo } = await api('POST', '/fechamentos', { unidade_id: unidadeId, turno: 'ALMOÇO', contagens: notas(saldoInicial), ...(opcoes.data ? { data_caixa: opcoes.data } : {}) });
  await api('PUT', `/fechamentos/${corpo.id}/contagem-final`, { contagens: notas(contado) });
  if (opcoes.finalizar !== false) await api('POST', `/fechamentos/${corpo.id}/finalizar`);
  return corpo.id as number;
}
async function saldo(unidadeId: number) {
  const { corpo } = await api('GET', '/cofre');
  return corpo.find((item: { unidade_id: number }) => item.unidade_id === unidadeId) as { total: number; fundo_gaveta: number };
}
async function extrato(filtro = '') {
  return (await api('GET', `/cofre/movimentacoes${filtro}`)).corpo as { movimentacoes: { tipo: string; valor: number; unidade_id: number; movimentacao_id: number | null; ativo: number }[]; totais: { tipo: string; entradas: number; saidas: number }[] };
}

beforeAll(async () => {
  const { servidor } = await import('./server');
  banco = (await import('./db')).db;
  if (!servidor.listening) await new Promise((pronto) => servidor.once('listening', pronto));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  fechar = () => servidor.close();
  await api('POST', '/auth/register', { nome: 'Dono', email, senha, confirmacao: senha });
  token = (await api('POST', '/auth/login', { email, senha })).corpo.token;
  unidades = (await api('GET', '/unidades')).corpo;
});
afterAll(() => fechar());

describe('cofre', () => {
  it('recebe o dinheiro contado e perde o saldo inicial quando o caixa é finalizado', async () => {
    const unidade = unidades[0].id;
    await caixa(unidade, 200, 500);
    expect(await saldo(unidade)).toMatchObject({ total: 300, fundo_gaveta: 0 });
    const { movimentacoes } = await extrato(`?unidades=${unidade}`);
    expect(movimentacoes.map((mov) => [mov.tipo, mov.valor]).sort()).toEqual([['envio_caixa', 500], ['retirada_troco', -200]]);
  });

  it('não movimenta com o caixa aberto e mostra o saldo inicial como fundo na gaveta', async () => {
    const unidade = unidades[1].id;
    await caixa(unidade, 150, 400, { finalizar: false });
    expect(await saldo(unidade)).toMatchObject({ total: 0, fundo_gaveta: 150 });
  });

  it('desfaz a movimentação ao reabrir e a apaga ao excluir o caixa', async () => {
    const unidade = unidades[2].id;
    const id = await caixa(unidade, 100, 300);
    expect((await saldo(unidade)).total).toBe(200);
    await api('POST', `/fechamentos/${id}/reabrir`);
    expect(await saldo(unidade)).toMatchObject({ total: 0, fundo_gaveta: 100 });
    await api('POST', `/fechamentos/${id}/finalizar`);
    expect((await saldo(unidade)).total).toBe(200);
    await api('DELETE', `/fechamentos/${id}`);
    expect(await saldo(unidade)).toMatchObject({ total: 0, fundo_gaveta: 0 });
  });

  it('ignora caixas finalizados antes do cofre existir, mesmo reabertos e finalizados de novo', async () => {
    const unidade = unidades[3].id;
    const id = await caixa(unidade, 50, 80);
    banco.prepare('UPDATE fechamentos SET movimenta_cofre=NULL WHERE id=?').run(id);
    expect((await saldo(unidade)).total).toBe(0);
    await api('POST', `/fechamentos/${id}/reabrir`);
    expect((await saldo(unidade)).fundo_gaveta).toBe(0);
    await api('POST', `/fechamentos/${id}/finalizar`);
    expect((await saldo(unidade)).total).toBe(0);
  });

  it('usa o dia do caixa como data das movimentações do caixa', async () => {
    const unidade = unidades[0].id;
    await caixa(unidade, 10, 20, { data: '2026-01-15' });
    const { movimentacoes } = await extrato(`?de=2026-01-15&ate=2026-01-15&unidades=${unidade}`);
    expect(movimentacoes.map((mov) => mov.tipo).sort()).toEqual(['envio_caixa', 'retirada_troco']);
  });

  it('lança saídas e entradas manuais com o sinal do tipo e permite saldo negativo', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'COFRE MANUAL' })).corpo.id;
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'deposito_banco', valor: 1000, data: hoje })).status).toBe(201);
    expect((await saldo(unidade)).total).toBe(-1000);
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', valor: 300, data: hoje });
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'ajuste', sentido: 'entrada', valor: 700, data: hoje, observacao: 'saldo inicial' });
    expect((await saldo(unidade)).total).toBe(0);
  });

  it('exige sentido e observação no ajuste e recusa data futura', async () => {
    const unidade = unidades[0].id;
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'ajuste', valor: 10, data: hoje, observacao: 'x' })).status).toBe(400);
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'outros', sentido: 'saida', valor: 10, data: hoje })).status).toBe(400);
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', valor: 10, data: '2999-01-01' })).status).toBe(400);
  });

  it('transfere entre unidades e a exclusão remove as duas pontas', async () => {
    const [origem, destino] = [unidades[1].id, unidades[2].id];
    const antes = [(await saldo(origem)).total, (await saldo(destino)).total];
    const { corpo } = await api('POST', '/cofre/transferencias', { origem, destino, valor: 250, data: hoje });
    expect([(await saldo(origem)).total, (await saldo(destino)).total]).toEqual([antes[0] - 250, antes[1] + 250]);
    expect((await api('DELETE', `/cofre/movimentacoes/${corpo.id}`)).status).toBe(200);
    expect([(await saldo(origem)).total, (await saldo(destino)).total]).toEqual(antes);
    expect((await api('POST', '/cofre/transferencias', { origem, destino: origem, valor: 1, data: hoje })).status).toBe(400);
  });

  it('tira a movimentação excluída do saldo e dos totais e só a mostra quando pedido', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'COFRE EXCLUSAO' })).corpo.id;
    const { corpo } = await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'retirada_dono', valor: 80, data: hoje });
    await api('DELETE', `/cofre/movimentacoes/${corpo.id}`);
    expect((await saldo(unidade)).total).toBe(0);
    expect((await extrato(`?unidades=${unidade}`)).movimentacoes).toEqual([]);
    expect((await extrato(`?unidades=${unidade}`)).totais).toEqual([]);
    expect((await extrato(`?unidades=${unidade}&excluidas=1`)).movimentacoes).toMatchObject([{ tipo: 'retirada_dono', valor: -80, ativo: 0 }]);
  });

  it('separa entradas e saídas nos totais por tipo', async () => {
    const [origem, destino] = [unidades[0].id, unidades[3].id];
    await api('POST', '/cofre/transferencias', { origem, destino, valor: 40, data: '2026-02-02' });
    const { totais } = await extrato('?de=2026-02-02&ate=2026-02-02');
    expect(totais).toEqual([{ tipo: 'transferencia', entradas: 40, saidas: 40 }]);
  });
});

describe('dia do caixa', () => {
  it('só dono e admin escolhem uma data diferente de hoje', async () => {
    const funcionario = { nome: 'Operador', email: 'operador@cofre.test', senha, confirmacao: senha };
    const { corpo } = await api('POST', '/auth/register', funcionario);
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { unidades: [unidades[0].id] });
    const tokenFuncionario = (await api('POST', '/auth/login', { email: funcionario.email, senha })).corpo.token;
    const abertura = { unidade_id: unidades[0].id, turno: 'JANTAR', contagens: notas(10) };
    expect((await api('POST', '/fechamentos', { ...abertura, data_caixa: '2026-01-10' }, tokenFuncionario)).status).toBe(403);
    const criado = await api('POST', '/fechamentos', abertura, tokenFuncionario);
    expect((await api('GET', `/fechamentos/${criado.corpo.id}`)).corpo.fechamento.data_caixa).toBe(hoje);
    expect((await api('POST', '/fechamentos', { ...abertura, data_caixa: '2026-01-10' })).status).toBe(201);
    expect((await api('POST', '/fechamentos', { ...abertura, data_caixa: '2999-01-10' })).status).toBe(400);
  });
});

describe('unidades excluídas', () => {
  it('voltam com o cofre intacto ao reativar e não podem ser recriadas pelo nome', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'REATIVAVEL' })).corpo.id;
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', valor: 90, data: hoje });
    await api('DELETE', `/unidades/${unidade}`);
    expect((await api('GET', '/unidades/excluidas')).corpo.map((item: { id: number }) => item.id)).toContain(unidade);
    expect((await api('POST', '/unidades', { nome: 'REATIVAVEL' })).status).toBe(409);
    expect((await api('POST', `/unidades/${unidade}/reativar`)).status).toBe(200);
    expect((await api('GET', '/unidades')).corpo.map((item: { id: number }) => item.id)).toContain(unidade);
    expect((await saldo(unidade)).total).toBe(90);
  });
});

describe('motivos de saída', () => {
  async function funcionario(emailFuncionario: string) {
    const { corpo } = await api('POST', '/auth/register', { nome: 'Caixa', email: emailFuncionario, senha, confirmacao: senha });
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { unidades: unidades.map((item) => item.id) });
    return (await api('POST', '/auth/login', { email: emailFuncionario, senha })).corpo.token as string;
  }
  const saidasDoCaixa = async (id: number) => (await api('GET', `/fechamentos/${id}`)).corpo.saidas as { motivo: string; motivo_id: number | null; observacao: string | null; valor: number }[];

  it('vêm com uma lista inicial', async () => {
    expect((await api('GET', '/motivos-saida')).corpo.length).toBeGreaterThan(0);
  });

  it('a saída exige um motivo da lista e guarda a observação', async () => {
    const id = (await api('POST', '/fechamentos', { unidade_id: unidades[0].id, turno: 'ALMOÇO', contagens: notas(100) })).corpo.id;
    const motivo = (await api('POST', '/motivos-saida', { nome: 'Gás' })).corpo;
    expect((await api('PUT', `/fechamentos/${id}/saidas`, { saidas: [{ valor: 30, motivo: 'texto livre' }] })).status).toBe(400);
    expect((await api('PUT', `/fechamentos/${id}/saidas`, { saidas: [{ valor: 30, motivo_id: 999999 }] })).status).toBe(400);
    expect((await api('PUT', `/fechamentos/${id}/saidas`, { saidas: [{ valor: 30, motivo_id: motivo.id, observacao: 'botijão 13kg' }] })).status).toBe(200);
    expect(await saidasDoCaixa(id)).toMatchObject([{ motivo: 'Gás', motivo_id: motivo.id, observacao: 'botijão 13kg', valor: 30 }]);
  });

  it('renomear corrige o motivo nos caixas antigos', async () => {
    const motivo = (await api('POST', '/motivos-saida', { nome: 'Gas encanado' })).corpo;
    const id = (await api('POST', '/fechamentos', { unidade_id: unidades[1].id, turno: 'JANTAR', contagens: notas(50) })).corpo.id;
    await api('PUT', `/fechamentos/${id}/saidas`, { saidas: [{ valor: 12, motivo_id: motivo.id }] });
    expect((await api('PATCH', `/motivos-saida/${motivo.id}`, { nome: 'Gás encanado' })).status).toBe(200);
    expect((await saidasDoCaixa(id))[0].motivo).toBe('Gás encanado');
    expect((await api('PATCH', `/motivos-saida/${motivo.id}`, { nome: 'gás' })).status).toBe(409);
  });

  it('quem preenche o caixa cadastra motivo, mas só admin e dono renomeiam e excluem', async () => {
    const tokenFuncionario = await funcionario('motivos@cofre.test');
    const { status, corpo } = await api('POST', '/motivos-saida', { nome: 'Gelo' }, tokenFuncionario);
    expect(status).toBe(201);
    expect((await api('PATCH', `/motivos-saida/${corpo.id}`, { nome: 'Gelo em barra' }, tokenFuncionario)).status).toBe(403);
    expect((await api('DELETE', `/motivos-saida/${corpo.id}`, undefined, tokenFuncionario)).status).toBe(403);
  });

  it('cadastrar um nome existente devolve o mesmo motivo, reativando o excluído', async () => {
    const motivo = (await api('POST', '/motivos-saida', { nome: 'Lavanderia' })).corpo;
    expect((await api('POST', '/motivos-saida', { nome: 'lavanderia' })).corpo.id).toBe(motivo.id);
    await api('DELETE', `/motivos-saida/${motivo.id}`);
    expect((await api('GET', '/motivos-saida')).corpo.map((item: { id: number }) => item.id)).not.toContain(motivo.id);
    expect((await api('POST', '/motivos-saida', { nome: 'Lavanderia' })).corpo.id).toBe(motivo.id);
    expect((await api('GET', '/motivos-saida')).corpo.map((item: { id: number }) => item.id)).toContain(motivo.id);
  });

  it('saídas anteriores à lista continuam mostrando o texto digitado', async () => {
    const id = (await api('POST', '/fechamentos', { unidade_id: unidades[2].id, turno: 'ALMOÇO', contagens: notas(10) })).corpo.id;
    banco.prepare('INSERT INTO saidas (fechamento_id, valor, motivo) VALUES (?, 5, ?)').run(id, 'pão para a equipe');
    expect(await saidasDoCaixa(id)).toMatchObject([{ motivo: 'pão para a equipe', motivo_id: null }]);
  });
});
