import { describe, expect, it } from 'vitest';
import { cascataGaveta, diasDoPeriodo, mixPagamento, passagemDeTurno, periodoAnterior, porDia, porDiaDaSemana, porUnidade, quebraPorUnidade, resultadoConferencia, resumo, saidasPorUnidade, situacaoPorDia, taxaDeAcertoSemanal, variacao, type CaixaRelatorio } from './relatorioDados';

const config = { tolerancia_dinheiro: 5, fechamento_cego: true, ve_diferenca: true, escolhe_data_caixa: true };
const terra = { id: 1, nome: 'TERRA E MAR' };
const doce = { id: 2, nome: 'DOCELATTO' };

let proximoId = 1;
const caixa = (dados: Partial<CaixaRelatorio>): CaixaRelatorio => ({
  id: proximoId++, unidade_id: 1, unidade_nome: 'TERRA E MAR', troco_continua: false, usuario_id: 1, usuario_nome: 'Ana',
  turno: 'ALMOÇO', status: 'finalizado', problema_resolvido: null, dia: '2026-09-07', criado_em: '2026-09-07 13:00:00',
  saldo_inicial: 200, dinheiro_fisico: 300, total_entradas: 1000, total_maquininhas: 900, total_saidas: 0,
  diferenca_dinheiro: 0, diferenca_cartoes: 0, dinheiro_anterior: null, entradas: { dinheiro: 100, pix: 900 }, maquininhas: [],
  ...dados
});

describe('períodos', () => {
  it('lista os dias do período, inclusive nas pontas', () => {
    expect(diasDoPeriodo('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
  it('o período anterior tem o mesmo tamanho e termina na véspera', () => {
    expect(periodoAnterior('2026-10-01', '2026-10-07')).toEqual({ de: '2026-09-24', ate: '2026-09-30' });
  });
  it('variação sem base de comparação é null', () => {
    expect(variacao(100, 0)).toBeNull();
    expect(variacao(150, 100)).toBe(0.5);
  });
});

describe('resumo', () => {
  it('soma o faturamento de todos e a quebra só dos caixas fechados', () => {
    const r = resumo([
      caixa({ diferenca_dinheiro: -10 }),
      caixa({ diferenca_dinheiro: 3 }),
      caixa({ status: 'aberto', diferenca_dinheiro: -500 })
    ], config);
    expect(r.faturamento).toBe(3000);
    expect(r.dinheiro).toEqual({ falta: 10, sobra: 3 });
    expect(r.foraDaTolerancia).toBe(1);
  });
  it('conta divergência de cartões mesmo de centavos e os pendentes de conferência', () => {
    const r = resumo([
      caixa({ diferenca_cartoes: -0.5 }),
      caixa({ status: 'conferido', diferenca_dinheiro: -50 }),
      caixa({})
    ], config);
    expect(r.comDivergenciaCartoes).toBe(1);
    expect(r.aguardandoConferencia).toBe(2);
    expect(r.pendentes).toBe(1);
  });
  it('falta de um caixa não é compensada pela sobra de outro', () => {
    const r = resumo([caixa({ diferenca_dinheiro: -100, diferenca_cartoes: 50 }), caixa({ diferenca_dinheiro: 100, diferenca_cartoes: -50 })], config);
    expect(r.dinheiro).toEqual({ falta: 100, sobra: 100 });
    expect(r.cartoes).toEqual({ falta: 50, sobra: 50 });
    expect(r.foraDaTolerancia).toBe(2);
  });
  it('período vazio dá tudo zero', () => {
    expect(resumo([], config)).toEqual({ faturamento: 0, caixas: 0, dinheiro: { falta: 0, sobra: 0 }, foraDaTolerancia: 0, cartoes: { falta: 0, sobra: 0 }, comDivergenciaCartoes: 0, aguardandoConferencia: 0, pendentes: 0 });
  });
});

describe('faturamento', () => {
  it('por dia deixa null no dia em que a unidade não teve caixa', () => {
    const linhas = porDia([caixa({ dia: '2026-09-07' }), caixa({ dia: '2026-09-07', total_entradas: 500 })], [terra, doce], ['2026-09-07', '2026-09-08']);
    expect(linhas).toEqual([{ dia: '2026-09-07', 1: 1500, 2: null }, { dia: '2026-09-08', 1: null, 2: null }]);
  });
  it('por unidade ordena do maior para o menor e traz o período anterior', () => {
    const linhas = porUnidade([caixa({ unidade_id: 2, total_entradas: 3000 }), caixa({})], [caixa({ unidade_id: 2, total_entradas: 2500 })], [terra, doce]);
    expect(linhas.map((linha) => [linha.nome, linha.total, linha.anterior])).toEqual([['DOCELATTO', 3000, 2500], ['TERRA E MAR', 1000, 0]]);
  });
  it('média por dia da semana divide pelo número de dias com caixa, não de caixas', () => {
    // 07/09/2026 e 14/09/2026 são segundas-feiras
    const [linha] = porDiaDaSemana([caixa({ dia: '2026-09-07' }), caixa({ dia: '2026-09-07', turno: 'JANTAR' }), caixa({ dia: '2026-09-14' })], [terra]);
    expect(linha.medias[0]).toBe(1500);
    expect(linha.medias[1]).toBeNull();
  });
  it('mix de pagamento em fração do faturamento, ignorando forma sem lançamento', () => {
    const mix = mixPagamento([caixa({ total_entradas: 400, entradas: { pix: 300, credito: 100 } })]);
    expect(mix.slice(0, 2).map((fatia) => [fatia.rotulo, fatia.participacao])).toEqual([['Pix', 0.75], ['Crédito', 0.25]]);
    expect(mix.find((fatia) => fatia.forma === 'dinheiro')?.valor).toBe(0);
  });
});

describe('quebras', () => {
  it('quebra por unidade separa falta e sobra e começa pela maior quebra total', () => {
    const linhas = quebraPorUnidade([caixa({ diferenca_dinheiro: 4 }), caixa({ unidade_id: 2, diferenca_dinheiro: -30 }), caixa({ unidade_id: 2, diferenca_dinheiro: 30 })], [terra, doce]);
    expect(linhas.map((linha) => [linha.nome, linha.falta, linha.sobra])).toEqual([['DOCELATTO', -30, 30], ['TERRA E MAR', 0, 4]]);
  });
  it('cascata da gaveta vai das entradas em dinheiro ao apurado, sem somar o troco', () => {
    const etapas = cascataGaveta([
      caixa({ saldo_inicial: 200, entradas: { dinheiro: 500 }, total_saidas: 50, dinheiro_fisico: 640 }),
      caixa({ saldo_inicial: 640, entradas: { dinheiro: 100 }, dinheiro_fisico: 745 })
    ]);
    expect(etapas.map((etapa) => [etapa.etapa, etapa.valor])).toEqual([['Entradas em dinheiro', 600], ['Saídas', -50], ['Esperado', 550], ['Quebra', -5], ['Apurado', 545]]);
    expect(etapas[3].tipo).toBe('falta');
  });
  it('caixa sem entrada em dinheiro conta zero na cascata', () => {
    const etapas = cascataGaveta([caixa({ saldo_inicial: 200, entradas: { pix: 1000 }, dinheiro_fisico: 200 })]);
    expect(etapas[0].valor).toBe(0);
    expect(etapas[3].valor).toBe(0);
  });
  it('situação do dia: não bateu prevalece; dia sem caixa e caixa reaberto ficam à parte', () => {
    const [linha] = situacaoPorDia([
      caixa({ dia: '2026-09-07' }), caixa({ dia: '2026-09-07', diferenca_dinheiro: -20 }),
      caixa({ dia: '2026-09-09', status: 'aberto' })
    ], [terra], ['2026-09-07', '2026-09-08', '2026-09-09'], config);
    expect(linha.dias.map((dia) => dia.situacao)).toEqual(['nao-bateu', 'sem-caixa', 'em-aberto']);
    expect(linha.dias[0].aguardando).toBe(true);
  });
  it('taxa de acerto semanal respeita a tolerância e ignora caixa reaberto', () => {
    const [semana] = taxaDeAcertoSemanal([
      caixa({ diferenca_dinheiro: -4 }), caixa({ diferenca_dinheiro: -6 }), caixa({ status: 'aberto', diferenca_dinheiro: -100 })
    ], [terra, doce], config);
    expect(semana).toEqual({ semana: '2026-09-07', 1: 0.5, 2: null });
  });
  it('resultado da conferência separa certo, errado, só conferido e aguardando', () => {
    const [linha] = resultadoConferencia([
      caixa({ status: 'conferido', problema_resolvido: 1 }), caixa({ status: 'conferido', problema_resolvido: 0 }),
      caixa({ status: 'conferido' }), caixa({})
    ], [terra]);
    expect(linha).toEqual({ nome: 'TERRA E MAR', certo: 1, errado: 1, conferido: 1, aguardando: 1 });
  });
});

describe('dinheiro', () => {
  it('saídas em relação às entradas em dinheiro; sem entrada em dinheiro fica null', () => {
    const linhas = saidasPorUnidade([caixa({ total_saidas: 25, entradas: { dinheiro: 100 } }), caixa({ unidade_id: 2, total_saidas: 10, entradas: { pix: 50 } })], [terra, doce]);
    expect(linhas.map((linha) => [linha.nome, linha.saidas, linha.participacao])).toEqual([['TERRA E MAR', 25, 0.25], ['DOCELATTO', 10, null]]);
  });
  it('passagem de turno só nas unidades com troco contínuo e com caixa anterior', () => {
    const linhas = passagemDeTurno([
      caixa({ troco_continua: true, dinheiro_anterior: 350, saldo_inicial: 330 }),
      caixa({ troco_continua: true, dinheiro_anterior: null }),
      caixa({ troco_continua: false, dinheiro_anterior: 350, saldo_inicial: 200 })
    ]);
    expect(linhas.map((linha) => [linha.anterior, linha.saldo_inicial, linha.diferenca])).toEqual([[350, 330, -20]]);
  });
});
