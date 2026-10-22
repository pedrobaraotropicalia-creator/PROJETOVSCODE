import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const email = 'dono@cofre.test';
const senha = randomBytes(12).toString('hex');
process.env.DATABASE_FILE = ':memory:';
process.env.JWT_SECRET = randomBytes(16).toString('hex');
process.env.ADMIN_EMAIL = email;
process.env.ADMIN_PASSWORD = senha;
process.env.PORT = '0';
// faz o papel do socket de controle do Litestream: guarda cada pedido de envio e responde depois do atraso, com o status do teste
const litestream = { pedidos: [] as { path: string; wait: boolean }[], atraso: 0, status: 200 };
const nomeSocket = `litestream-teste-${randomBytes(6).toString('hex')}`;
process.env.LITESTREAM_SOCKET = process.platform === 'win32' ? `\\\\.\\pipe\\${nomeSocket}` : path.join(tmpdir(), `${nomeSocket}.sock`);
const falsoLitestream = createServer((req, res) => {
  let corpo = '';
  req.on('data', (parte) => { corpo += parte; }).on('end', () => { litestream.pedidos.push(JSON.parse(corpo)); setTimeout(() => res.writeHead(litestream.status, { 'Content-Type': 'application/json' }).end('{"status":"synced"}'), litestream.atraso); });
});

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
type Cedula = { denominacao: number; quantidade: number };
async function saldo(unidadeId: number) {
  const { corpo } = await api('GET', '/cofre');
  return corpo.find((item: { unidade_id: number }) => item.unidade_id === unidadeId) as { total: number; fundo_gaveta: number; cedulas: Cedula[]; cedulas_gaveta: Cedula[] };
}
async function extrato(filtro = '') {
  return (await api('GET', `/cofre/movimentacoes${filtro}`)).corpo as { movimentacoes: { tipo: string; valor: number; unidade_id: number; movimentacao_id: number | null; ativo: number; cedulas: Cedula[] }[]; totais: { tipo: string; entradas: number; saidas: number }[] };
}

beforeAll(async () => {
  await new Promise<void>((pronto) => falsoLitestream.listen(process.env.LITESTREAM_SOCKET, pronto));
  const { servidor } = await import('./server');
  banco = (await import('./db')).db;
  if (!servidor.listening) await new Promise((pronto) => servidor.once('listening', pronto));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  fechar = () => { servidor.close(); falsoLitestream.close(); };
  token = (await api('POST', '/auth/login', { email, senha })).corpo.token;
  unidades = (await api('GET', '/unidades')).corpo;
});
afterAll(() => fechar());

describe('dono', () => {
  it('é criado na partida com ADMIN_PASSWORD e não se cadastra pela tela de login', async () => {
    expect(token).toBeTruthy();
    expect((await api('GET', '/auth/me')).corpo.usuario).toMatchObject({ email, tipo: 'dono' });
    expect((await api('POST', '/auth/register', { nome: 'Intruso', email: email.toUpperCase(), senha: 'outra-senha-1', confirmacao: 'outra-senha-1' }, '')).status).toBe(403);
    expect((await api('POST', '/auth/login', { email, senha: 'outra-senha-1' }, '')).status).toBe(401);
    const doDono = (await api('GET', `/auditoria?de=${hoje}&ate=${hoje}`)).corpo.filter((item: { entidade: string; usuario_nome: string }) => item.entidade === 'usuario' && item.usuario_nome === 'Dono do sistema');
    expect(doDono.map((item: { acao: string }) => item.acao)).toEqual(['Criado na partida']);
  });
});

describe('replicação pelo Litestream', () => {
  afterEach(() => { litestream.atraso = 0; litestream.status = 200; vi.restoreAllMocks(); });

  it('a escrita só responde depois de o Litestream confirmar o envio, e a leitura não espera', async () => {
    const { arquivoBanco } = await import('./db');
    litestream.atraso = 300; litestream.pedidos = [];
    const inicio = performance.now();
    expect((await api('POST', '/motivos-saida', { nome: 'Replicado' })).status).toBe(201);
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(290);
    expect(litestream.pedidos).toEqual([{ path: arquivoBanco, wait: true, timeout: 5 }]);
    await api('GET', '/motivos-saida');
    expect(litestream.pedidos).toHaveLength(1);
  });

  it('sem a confirmação, a escrita responde mesmo assim e fica gravada', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    litestream.status = 500;
    const { status, corpo } = await api('POST', '/motivos-saida', { nome: 'Sem confirmação' });
    expect(status).toBe(201);
    expect((await api('GET', '/motivos-saida')).corpo.map((item: { id: number }) => item.id)).toContain(corpo.id);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('Litestream não confirmou o envio'));
  });
});

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
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'deposito_banco', cedulas: notas(1000), data: hoje })).status).toBe(201);
    expect((await saldo(unidade)).total).toBe(-1000);
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', cedulas: notas(300), data: hoje });
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'ajuste', sentido: 'entrada', cedulas: notas(700), data: hoje, observacao: 'saldo inicial' });
    expect((await saldo(unidade)).total).toBe(0);
  });

  it('exige sentido e observação no ajuste e recusa data futura', async () => {
    const unidade = unidades[0].id;
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'ajuste', cedulas: notas(10), data: hoje, observacao: 'x' })).status).toBe(400);
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'outros', sentido: 'saida', cedulas: notas(10), data: hoje })).status).toBe(400);
    expect((await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', cedulas: notas(10), data: '2999-01-01' })).status).toBe(400);
  });

  it('transfere entre unidades e a exclusão remove as duas pontas', async () => {
    const [origem, destino] = [unidades[1].id, unidades[2].id];
    const antes = [(await saldo(origem)).total, (await saldo(destino)).total];
    const { corpo } = await api('POST', '/cofre/transferencias', { origem, destino, cedulas: notas(250), data: hoje });
    expect([(await saldo(origem)).total, (await saldo(destino)).total]).toEqual([antes[0] - 250, antes[1] + 250]);
    expect((await api('DELETE', `/cofre/movimentacoes/${corpo.id}`)).status).toBe(200);
    expect([(await saldo(origem)).total, (await saldo(destino)).total]).toEqual(antes);
    expect((await api('POST', '/cofre/transferencias', { origem, destino: origem, cedulas: notas(1), data: hoje })).status).toBe(400);
  });

  it('tira a movimentação excluída do saldo e dos totais e só a mostra quando pedido', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'COFRE EXCLUSAO' })).corpo.id;
    const { corpo } = await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'retirada_dono', cedulas: notas(80), data: hoje });
    await api('DELETE', `/cofre/movimentacoes/${corpo.id}`);
    expect((await saldo(unidade)).total).toBe(0);
    expect((await extrato(`?unidades=${unidade}`)).movimentacoes).toEqual([]);
    expect((await extrato(`?unidades=${unidade}`)).totais).toEqual([]);
    expect((await extrato(`?unidades=${unidade}&excluidas=1`)).movimentacoes).toMatchObject([{ tipo: 'retirada_dono', valor: -80, ativo: 0 }]);
  });

  it('separa entradas e saídas nos totais por tipo', async () => {
    const [origem, destino] = [unidades[0].id, unidades[3].id];
    await api('POST', '/cofre/transferencias', { origem, destino, cedulas: notas(40), data: '2026-02-02' });
    const { totais } = await extrato('?de=2026-02-02&ate=2026-02-02');
    expect(totais).toEqual([{ tipo: 'transferencia', entradas: 40, saidas: 40 }]);
  });

  it('lança pelas cédulas: o valor é a soma delas, e o extrato e o saldo trazem o detalhe', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'COFRE CEDULAS' })).corpo.id;
    const lancar = (tipo: string, cedulas: unknown) => api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo, cedulas, data: hoje });
    expect((await lancar('aporte', [{ denominacao: 100, quantidade: 2 }, { denominacao: 50, quantidade: 0 }, { denominacao: 0.25, quantidade: 4 }])).status).toBe(201);
    await lancar('deposito_banco', [{ denominacao: 100, quantidade: 1 }]);
    expect(await saldo(unidade)).toMatchObject({ total: 101, cedulas: [{ denominacao: 100, quantidade: 1 }, { denominacao: 0.25, quantidade: 4 }], cedulas_gaveta: [] });
    const { movimentacoes } = await extrato(`?unidades=${unidade}`);
    expect(movimentacoes.find((mov) => mov.tipo === 'aporte')).toMatchObject({ valor: 201, cedulas: [{ denominacao: 100, quantidade: 2 }, { denominacao: 0.25, quantidade: 4 }] });
    expect(movimentacoes.find((mov) => mov.tipo === 'deposito_banco')).toMatchObject({ valor: -100, cedulas: [{ denominacao: 100, quantidade: 1 }] });
  });

  it('recusa lançamento sem cédulas, com cédula repetida ou inexistente', async () => {
    const lancar = (corpo: object) => api('POST', '/cofre/movimentacoes', { unidade_id: unidades[0].id, tipo: 'aporte', data: hoje, ...corpo });
    expect((await lancar({ cedulas: [{ denominacao: 10, quantidade: 0 }] })).corpo.erro).toBe('Informe a quantidade das cédulas e moedas.');
    expect((await lancar({ cedulas: [{ denominacao: 10, quantidade: 1 }, { denominacao: 10, quantidade: 2 }] })).corpo.erro).toBe('Cédula ou moeda repetida.');
    expect((await lancar({ cedulas: [{ denominacao: 3, quantidade: 1 }] })).status).toBe(400);
    expect((await lancar({ valor: 10 })).status).toBe(400);
  });

  it('detalha as cédulas dos caixas no extrato e separa as da gaveta no saldo', async () => {
    const unidade = (await api('POST', '/unidades', { nome: 'COFRE GAVETA' })).corpo.id;
    const { corpo } = await api('POST', '/fechamentos', { unidade_id: unidade, turno: 'ALMOÇO', contagens: [{ denominacao: 10, quantidade: 5 }] });
    await api('PUT', `/fechamentos/${corpo.id}/contagem-final`, { contagens: [{ denominacao: 50, quantidade: 3 }, { denominacao: 10, quantidade: 2 }] });
    await api('POST', `/fechamentos/${corpo.id}/finalizar`);
    await api('POST', '/fechamentos', { unidade_id: unidade, turno: 'JANTAR', contagens: [{ denominacao: 5, quantidade: 4 }] });
    expect(await saldo(unidade)).toMatchObject({ total: 120, fundo_gaveta: 20, cedulas: [{ denominacao: 50, quantidade: 3 }, { denominacao: 10, quantidade: -3 }], cedulas_gaveta: [{ denominacao: 5, quantidade: 4 }] });
    const { movimentacoes } = await extrato(`?unidades=${unidade}`);
    expect(movimentacoes.find((mov) => mov.tipo === 'envio_caixa')?.cedulas).toEqual([{ denominacao: 50, quantidade: 3 }, { denominacao: 10, quantidade: 2 }]);
    expect(movimentacoes.find((mov) => mov.tipo === 'retirada_troco')?.cedulas).toEqual([{ denominacao: 10, quantidade: 5 }]);
  });

  it('transfere as cédulas informadas nas duas pontas e a exclusão as tira das duas', async () => {
    const [origem, destino] = [(await api('POST', '/unidades', { nome: 'COFRE ORIGEM' })).corpo.id, (await api('POST', '/unidades', { nome: 'COFRE DESTINO' })).corpo.id];
    const cedulas = [{ denominacao: 20, quantidade: 3 }];
    const { corpo } = await api('POST', '/cofre/transferencias', { origem, destino, cedulas, data: hoje });
    expect([(await saldo(origem)).cedulas, (await saldo(destino)).cedulas]).toEqual([[{ denominacao: 20, quantidade: -3 }], cedulas]);
    expect((await extrato(`?unidades=${origem},${destino}`)).movimentacoes.map((mov) => mov.cedulas)).toEqual([cedulas, cedulas]);
    await api('DELETE', `/cofre/movimentacoes/${corpo.id}`);
    expect([(await saldo(origem)).cedulas, (await saldo(destino)).cedulas]).toEqual([[], []]);
    expect((await extrato(`?unidades=${origem}&excluidas=1`)).movimentacoes).toMatchObject([{ ativo: 0, cedulas }]);
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
    await api('POST', '/cofre/movimentacoes', { unidade_id: unidade, tipo: 'aporte', cedulas: notas(90), data: hoje });
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

describe('usuários cadastrados pelo dono', () => {
  const novo = (emailNovo: string) => ({ nome: 'Novo Colaborador', email: emailNovo, cargo: 'Caixa', tipo: 'funcionario', unidades: [unidades[0].id] });
  const novaSenha = randomBytes(10).toString('hex');

  it('entram sem senha e criam a senha no primeiro acesso com o código', async () => {
    const { status, corpo } = await api('POST', '/usuarios', novo('primeiro@cofre.test'));
    expect(status).toBe(201);
    expect(corpo.codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(corpo.usuario).toMatchObject({ email: 'primeiro@cofre.test', cargo: 'Caixa', tipo: 'funcionario', primeiro_acesso: 1, unidades: [unidades[0].id] });
    expect((await api('POST', '/auth/login', { email: 'primeiro@cofre.test', senha: '' })).status).toBe(403);
    const acesso = { email: 'primeiro@cofre.test', senha: novaSenha, confirmacao: novaSenha };
    expect((await api('POST', '/auth/primeiro-acesso', { ...acesso, codigo: 'AAAA-AAAA' })).status).toBe(401);
    const criado = await api('POST', '/auth/primeiro-acesso', { ...acesso, codigo: corpo.codigo.toLowerCase().replace('-', ' ') });
    expect(criado.status).toBe(200);
    expect((await api('GET', '/auth/me', undefined, criado.corpo.token)).corpo.usuario.email).toBe('primeiro@cofre.test');
    expect((await api('POST', '/auth/primeiro-acesso', { ...acesso, codigo: corpo.codigo })).status).toBe(401);
    expect((await api('POST', '/auth/login', { email: 'primeiro@cofre.test', senha: novaSenha })).status).toBe(200);
    expect((await api('GET', '/usuarios')).corpo.find((item: { id: number }) => item.id === corpo.usuario.id).primeiro_acesso).toBe(0);
  });

  it('um código novo invalida o anterior e só vale para quem ainda não criou a senha', async () => {
    const { corpo } = await api('POST', '/usuarios', novo('trocado@cofre.test'));
    const trocado = await api('POST', `/usuarios/${corpo.usuario.id}/codigo-acesso`);
    expect(trocado.corpo.codigo).not.toBe(corpo.codigo);
    const acesso = { email: 'trocado@cofre.test', senha: novaSenha, confirmacao: novaSenha };
    expect((await api('POST', '/auth/primeiro-acesso', { ...acesso, codigo: corpo.codigo })).status).toBe(401);
    expect((await api('POST', '/auth/primeiro-acesso', { ...acesso, codigo: trocado.corpo.codigo })).status).toBe(200);
    expect((await api('POST', `/usuarios/${corpo.usuario.id}/codigo-acesso`)).status).toBe(409);
  });

  it('só o dono cadastra, sem repetir e-mail e com cargo da lista', async () => {
    expect((await api('POST', '/usuarios', novo('primeiro@cofre.test'))).status).toBe(409);
    expect((await api('POST', '/usuarios', novo(email))).status).toBe(409);
    expect((await api('POST', '/usuarios', { ...novo('cargo@cofre.test'), cargo: 'Gerente Geral' })).status).toBe(400);
    const tokenFuncionario = (await api('POST', '/auth/login', { email: 'primeiro@cofre.test', senha: novaSenha })).corpo.token;
    expect((await api('POST', '/usuarios', novo('outro@cofre.test'), tokenFuncionario)).status).toBe(403);
  });
});

describe('inativação de usuários', () => {
  async function usuarioComSenha(emailUsuario: string) {
    const { corpo } = await api('POST', '/auth/register', { nome: 'Inativável', email: emailUsuario, senha, confirmacao: senha });
    return { id: corpo.usuario.id as number, token: (await api('POST', '/auth/login', { email: emailUsuario, senha })).corpo.token as string };
  }

  it('corta o acesso na hora e a reativação devolve o mesmo usuário', async () => {
    const usuario = await usuarioComSenha('inativo@cofre.test');
    await api('PATCH', `/usuarios/${usuario.id}`, { cargo: 'Caixa', unidades: [unidades[1].id] });
    expect((await api('DELETE', `/usuarios/${usuario.id}`)).status).toBe(200);
    expect((await api('GET', '/auth/me', undefined, usuario.token)).status).toBe(401);
    expect((await api('POST', '/auth/login', { email: 'inativo@cofre.test', senha })).status).toBe(401);
    expect((await api('GET', '/usuarios')).corpo.find((item: { id: number }) => item.id === usuario.id)).toMatchObject({ ativo: 0, cargo: 'Caixa', unidades: [unidades[1].id] });
    expect((await api('POST', '/usuarios', { nome: 'Outro', email: 'inativo@cofre.test', tipo: 'funcionario', unidades: [] })).corpo.erro).toMatch(/inativo/);
    expect((await api('POST', `/usuarios/${usuario.id}/reativar`)).corpo.usuario).toMatchObject({ ativo: 1, cargo: 'Caixa' });
    expect((await api('GET', '/auth/me', undefined, usuario.token)).status).toBe(200);
  });

  it('só o dono inativa e ele mesmo não pode ser inativado', async () => {
    const usuario = await usuarioComSenha('protegido@cofre.test');
    const dono = (await api('GET', '/auth/me')).corpo.usuario;
    expect((await api('DELETE', `/usuarios/${dono.id}`)).status).toBe(409);
    expect((await api('DELETE', `/usuarios/${dono.id}`, undefined, usuario.token)).status).toBe(403);
    expect((await api('POST', `/usuarios/${usuario.id}/reativar`)).status).toBe(404);
  });
});

describe('regras de fechamento por unidade', () => {
  it('cada unidade tem sua tolerância e seu fechamento cego, e o caixa traz a tolerância da unidade', async () => {
    const [aberta, cega] = [(await api('POST', '/unidades', { nome: 'SEM CEGO' })).corpo.id, (await api('POST', '/unidades', { nome: 'COM CEGO' })).corpo.id];
    expect((await api('POST', '/unidades', { nome: 'JA CONFIGURADA', troco_continua: true, tolerancia_dinheiro: 2.5, fechamento_cego: false })).corpo).toMatchObject({ troco_continua: 1, tolerancia_dinheiro: 2.5, fechamento_cego: 0 });
    expect((await api('POST', '/unidades', { nome: 'TOLERANCIA NEGATIVA', tolerancia_dinheiro: -1 })).status).toBe(400);
    expect((await api('POST', '/unidades', {})).corpo.erro).toBe('Nome da unidade é obrigatório.');
    expect((await api('GET', '/unidades')).corpo.find((item: { id: number }) => item.id === cega)).toMatchObject({ tolerancia_dinheiro: 0, fechamento_cego: 1 });
    expect((await api('PATCH', `/unidades/${aberta}`, { tolerancia_dinheiro: 5, fechamento_cego: false })).corpo).toMatchObject({ tolerancia_dinheiro: 5, fechamento_cego: 0 });
    expect((await api('PATCH', `/unidades/${aberta}`, { tolerancia_dinheiro: -1 })).status).toBe(400);
    expect((await api('PATCH', `/unidades/${aberta}`, { tolerancia_dinheiro: 1_000_000 })).status).toBe(400);

    const { corpo } = await api('POST', '/auth/register', { nome: 'Operador', email: 'regras@cofre.test', senha, confirmacao: senha });
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { unidades: [cega] });
    const tokenOperador = (await api('POST', '/auth/login', { email: 'regras@cofre.test', senha })).corpo.token;
    expect((await api('GET', '/acesso', undefined, tokenOperador)).corpo).toEqual({ ve_diferenca: false, escolhe_data_caixa: false });
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { unidades: [aberta, cega] });
    expect((await api('GET', '/acesso', undefined, tokenOperador)).corpo.ve_diferenca).toBe(true);

    const abrir = async (unidade: number) => (await api('POST', '/fechamentos', { unidade_id: unidade, turno: 'ALMOÇO', contagens: notas(10) }, tokenOperador)).corpo.id as number;
    const [caixaAberta, caixaCega] = [await abrir(aberta), await abrir(cega)];
    const lista = (await api('GET', '/fechamentos', undefined, tokenOperador)).corpo as { id: number; diferenca_dinheiro?: number; tolerancia_dinheiro: number }[];
    expect(lista.find((item) => item.id === caixaAberta)).toMatchObject({ diferenca_dinheiro: -10, tolerancia_dinheiro: 5 });
    expect(lista.find((item) => item.id === caixaCega)).not.toHaveProperty('diferenca_dinheiro');
    expect((await api('GET', `/fechamentos/${caixaCega}`, undefined, tokenOperador)).corpo.fechamento).not.toHaveProperty('diferenca_dinheiro');
    expect((await api('GET', `/fechamentos/${caixaCega}`)).corpo.fechamento).toMatchObject({ diferenca_dinheiro: -10, tolerancia_dinheiro: 0 });
  });
});

describe('nomes de unidade', () => {
  it('não se repetem nem com maiúsculas diferentes, inclusive em letras acentuadas', async () => {
    const cafe = (await api('POST', '/unidades', { nome: 'CAFÉ CENTRO' })).corpo.id;
    expect((await api('POST', '/unidades', { nome: 'café centro' })).corpo).toEqual({ erro: 'Já existe a unidade CAFÉ CENTRO.' });
    const outra = (await api('POST', '/unidades', { nome: 'CAFÉ NORTE' })).corpo.id;
    expect((await api('PATCH', `/unidades/${outra}`, { nome: 'Café Centro' })).status).toBe(409);
    expect((await api('PATCH', `/unidades/${cafe}`, { nome: 'Café Centro' })).corpo.nome).toBe('Café Centro');
  });

  it('o nome de uma excluída pede a reativação, e a reativação recusa nome de uma ativa', async () => {
    const antiga = (await api('POST', '/unidades', { nome: 'LOJA VELHA' })).corpo.id;
    await api('DELETE', `/unidades/${antiga}`);
    expect((await api('POST', '/unidades', { nome: 'Loja Velha' })).corpo.erro).toMatch(/excluída LOJA VELHA/);
    const nova = (await api('POST', '/unidades', { nome: 'LOJA NOVA' })).corpo.id;
    expect((await api('PATCH', `/unidades/${nova}`, { nome: 'loja velha' })).status).toBe(409);
    banco.prepare('UPDATE unidades SET nome=? WHERE id=?').run('Loja Velha', nova);
    expect((await api('POST', `/unidades/${antiga}/reativar`)).corpo.erro).toMatch(/ativa Loja Velha/);
  });
});

describe('auditoria', () => {
  type Registro = { usuario_nome: string; entidade: string; entidade_id: number; acao: string; descricao: string; alteracoes: { campo: string; de: string | null; para: string | null }[] };
  const ultimas = async () => (await api('GET', `/auditoria?de=${hoje}&ate=${hoje}`)).corpo as Registro[];
  const brl = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  it('registra quem fez, o registro e o de/para do que mudou; salvar sem mudar nada não registra', async () => {
    const id = (await api('POST', '/unidades', { nome: 'AUDITADA' })).corpo.id;
    expect((await ultimas())[0]).toMatchObject({ entidade: 'unidade', entidade_id: id, acao: 'Criou', usuario_nome: 'Dono do sistema', descricao: 'Unidade AUDITADA' });
    await api('PATCH', `/unidades/${id}`, { nome: 'AUDITADA NOVA', tolerancia_dinheiro: 2.5 });
    expect((await ultimas())[0]).toMatchObject({ acao: 'Alterou', descricao: 'Unidade AUDITADA NOVA', alteracoes: [{ campo: 'Nome', de: 'AUDITADA', para: 'AUDITADA NOVA' }, { campo: 'Tolerância de quebra', de: brl(0), para: brl(2.5) }] });
    const total = (await ultimas()).length;
    await api('PATCH', `/unidades/${id}`, { tolerancia_dinheiro: 2.5 });
    expect((await ultimas()).length).toBe(total);
  });

  it('acompanha o caixa da abertura à conferência', async () => {
    const id = await caixa(unidades[0].id, 50, 60);
    await api('POST', `/fechamentos/${id}/conferir`, { problema_resolvido: true });
    const doCaixa = (await ultimas()).filter((item) => item.entidade === 'caixa' && item.entidade_id === id).reverse();
    expect(doCaixa.map((item) => item.acao)).toEqual(['Abriu', 'Alterou', 'Finalizou', 'Conferiu']);
    expect(doCaixa[1].alteracoes).toContainEqual({ campo: 'Dinheiro contado', de: brl(0), para: brl(60) });
    expect(doCaixa[3].alteracoes).toEqual([{ campo: 'Status', de: 'Finalizado', para: 'Conferido' }, { campo: 'Conferência', de: null, para: 'Certo' }]);
  });

  it('o lançamento do cofre registra as cédulas', async () => {
    const { corpo } = await api('POST', '/cofre/movimentacoes', { unidade_id: unidades[0].id, tipo: 'aporte', cedulas: [{ denominacao: 50, quantidade: 2 }, { denominacao: 0.5, quantidade: 3 }], data: hoje });
    const registro = (await ultimas()).find((item) => item.entidade === 'cofre' && item.entidade_id === corpo.id);
    expect(registro?.alteracoes).toContainEqual({ campo: 'Cédulas', de: null, para: `2 × ${brl(50)}; 3 × ${brl(0.5)}` });
  });

  it('código novo e senha redefinida aparecem sem o valor', async () => {
    const { corpo } = await api('POST', '/usuarios', { nome: 'Auditado', email: 'auditado@cofre.test', tipo: 'funcionario', unidades: [] });
    await api('POST', `/usuarios/${corpo.usuario.id}/codigo-acesso`);
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { senha });
    const doUsuario = (await ultimas()).filter((item) => item.entidade === 'usuario' && item.entidade_id === corpo.usuario.id).reverse();
    expect(doUsuario.map((item) => item.acao)).toEqual(['Criou', 'Gerou código de acesso', 'Alterou']);
    expect(doUsuario[2].alteracoes).toEqual([{ campo: 'Acesso', de: 'Aguardando primeiro acesso', para: 'Com senha' }, { campo: 'Senha', de: null, para: 'redefinida pelo dono' }]);
    expect(JSON.stringify(doUsuario)).not.toContain(senha);
    expect(JSON.stringify(doUsuario)).not.toContain(corpo.codigo);
  });

  it('colaborador não consulta, e o cadastro próprio fica no nome de quem se cadastrou', async () => {
    const { corpo } = await api('POST', '/auth/register', { nome: 'Curioso', email: 'curioso@cofre.test', senha, confirmacao: senha });
    const token = (await api('POST', '/auth/login', { email: 'curioso@cofre.test', senha })).corpo.token;
    expect((await api('GET', `/auditoria?de=${hoje}&ate=${hoje}`, undefined, token)).status).toBe(403);
    expect((await ultimas()).find((item) => item.entidade === 'usuario' && item.entidade_id === corpo.usuario.id)).toMatchObject({ acao: 'Cadastrou-se', usuario_nome: 'Curioso' });
  });

  it('o admin vê o que já enxerga: só as unidades vinculadas, sem o cofre', async () => {
    const [minha, outra] = [unidades[0].id, unidades[1].id];
    const { corpo } = await api('POST', '/auth/register', { nome: 'Supervisora', email: 'supervisora@cofre.test', senha, confirmacao: senha });
    await api('PATCH', `/usuarios/${corpo.usuario.id}`, { tipo: 'admin', unidades: [minha] });
    const tokenAdmin = (await api('POST', '/auth/login', { email: 'supervisora@cofre.test', senha })).corpo.token;
    const [daMinha, daOutra] = [await caixa(minha, 10, 10), await caixa(outra, 10, 10)];
    await api('POST', '/cofre/movimentacoes', { unidade_id: minha, tipo: 'aporte', cedulas: notas(5), data: hoje });
    const visto = (await api('GET', `/auditoria?de=${hoje}&ate=${hoje}`, undefined, tokenAdmin)).corpo as Registro[];
    expect(visto.some((item) => item.entidade === 'caixa' && item.entidade_id === daMinha)).toBe(true);
    expect(visto.some((item) => item.entidade === 'caixa' && item.entidade_id === daOutra)).toBe(false);
    expect(visto.some((item) => item.entidade === 'cofre')).toBe(false);
    expect(visto.some((item) => item.entidade === 'usuario' && item.entidade_id === corpo.usuario.id)).toBe(true);
  });
});
