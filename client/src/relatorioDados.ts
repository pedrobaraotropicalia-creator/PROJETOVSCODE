import { bateu, formasPagamento, quebraDinheiro, divergeCartoes, type Configuracoes } from './quebra';

/** Linha de GET /relatorios/caixas: um caixa já finalizado alguma vez, com o dia da primeira finalização (Brasília). */
export type CaixaRelatorio = {
  id: number; unidade_id: number; unidade_nome: string; troco_continua: boolean; usuario_id: number; usuario_nome: string;
  turno: string; status: string; problema_resolvido: number | null; dia: string; criado_em: string;
  saldo_inicial: number; dinheiro_fisico: number; total_entradas: number; total_maquininhas: number; total_saidas: number;
  diferenca_dinheiro: number; diferenca_cartoes: number; dinheiro_anterior: number | null;
  entradas: Record<string, number>; maquininhas: { id: number; nome: string; numero: string; valor: number }[];
};
export type UnidadeRelatorio = { id: number; nome: string };

const soma = <T>(itens: T[], valor: (item: T) => number) => itens.reduce((total, item) => total + valor(item), 0);
const centavos = (valor: number) => Math.round(valor * 100) / 100;
// caixa reaberto continua no faturamento (dia da primeira finalização), mas a diferença dele ainda é parcial
const fechados = (caixas: CaixaRelatorio[]) => caixas.filter((caixa) => caixa.status !== 'aberto');
const daUnidade = (caixas: CaixaRelatorio[], unidadeId: number) => caixas.filter((caixa) => caixa.unidade_id === unidadeId);
// faltas e sobras somadas em separado: uma não compensa a outra entre caixas diferentes
const faltaESobra = (valores: number[]) => ({ falta: centavos(soma(valores, (valor) => Math.max(-valor, 0))), sobra: centavos(soma(valores, (valor) => Math.max(valor, 0))) });
const dinheiro = (caixa: CaixaRelatorio) => caixa.entradas.dinheiro ?? 0;

const comoData = (dia: string) => new Date(`${dia}T12:00:00Z`);
export const somarDias = (dia: string, dias: number) => { const data = comoData(dia); data.setUTCDate(data.getUTCDate() + dias); return data.toISOString().slice(0, 10); };
/** 0 = segunda … 6 = domingo */
export const diaDaSemana = (dia: string) => (comoData(dia).getUTCDay() + 6) % 7;
export const nomesDiasDaSemana = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
/** Segunda-feira da semana do dia, como 'AAAA-MM-DD' */
export const inicioDaSemana = (dia: string) => somarDias(dia, -diaDaSemana(dia));
export const diasDoPeriodo = (de: string, ate: string) => { const dias: string[] = []; for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) dias.push(dia); return dias; };
/** Período de mesmo tamanho imediatamente antes */
export const periodoAnterior = (de: string, ate: string) => { const tamanho = diasDoPeriodo(de, ate).length; return { de: somarDias(de, -tamanho), ate: somarDias(de, -1) }; };

/** Variação relativa; null quando não há base de comparação. */
export const variacao = (atual: number, anterior: number) => anterior ? (atual - anterior) / anterior : null;

export function resumo(caixas: CaixaRelatorio[], config: Configuracoes) {
  const finalizados = fechados(caixas);
  return {
    faturamento: centavos(soma(caixas, (caixa) => caixa.total_entradas)),
    caixas: caixas.length,
    dinheiro: faltaESobra(finalizados.map((caixa) => caixa.diferenca_dinheiro)),
    foraDaTolerancia: finalizados.filter((caixa) => quebraDinheiro(caixa, config)).length,
    cartoes: faltaESobra(finalizados.map((caixa) => caixa.diferenca_cartoes)),
    comDivergenciaCartoes: finalizados.filter(divergeCartoes).length,
    aguardandoConferencia: caixas.filter((caixa) => caixa.status === 'finalizado').length,
    pendentes: caixas.filter((caixa) => caixa.status === 'finalizado' && bateu(caixa, config) === false).length
  };
}

/** Faturamento por dia, uma chave por unidade; null no dia em que a unidade não teve caixa. */
export const porDia = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[], dias: string[]) =>
  dias.map((dia) => ({ dia, ...Object.fromEntries(unidades.map((unidade) => { const doDia = daUnidade(caixas, unidade.id).filter((caixa) => caixa.dia === dia); return [unidade.id, doDia.length ? centavos(soma(doDia, (caixa) => caixa.total_entradas)) : null]; })) }));

/** Faturamento por unidade no período e no anterior, do maior para o menor. */
export const porUnidade = (caixas: CaixaRelatorio[], anteriores: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => ({ unidade_id: unidade.id, nome: unidade.nome, total: centavos(soma(daUnidade(caixas, unidade.id), (caixa) => caixa.total_entradas)), anterior: centavos(soma(daUnidade(anteriores, unidade.id), (caixa) => caixa.total_entradas)) }))
    .sort((a, b) => b.total - a.total);

/** Faltas e sobras de dinheiro por unidade (falta negativa, para o gráfico divergente), da maior quebra total para a menor. */
export const quebraPorUnidade = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => { const { falta, sobra } = faltaESobra(fechados(daUnidade(caixas, unidade.id)).map((caixa) => caixa.diferenca_dinheiro)); return { unidade_id: unidade.id, nome: unidade.nome, falta: falta ? -falta : 0, sobra }; })
    .sort((a, b) => (b.sobra - b.falta) - (a.sobra - a.falta));

export const porTurno = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => { const daqui = daUnidade(caixas, unidade.id); return { nome: unidade.nome, almoco: centavos(soma(daqui.filter((caixa) => caixa.turno === 'ALMOÇO'), (caixa) => caixa.total_entradas)), jantar: centavos(soma(daqui.filter((caixa) => caixa.turno === 'JANTAR'), (caixa) => caixa.total_entradas)) }; });

/** Faturamento médio por dia da semana (só dias em que a unidade teve caixa), uma linha por unidade. */
export const porDiaDaSemana = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => {
    const daqui = daUnidade(caixas, unidade.id);
    return { nome: unidade.nome, medias: nomesDiasDaSemana.map((_, semana) => { const doDia = daqui.filter((caixa) => diaDaSemana(caixa.dia) === semana); const dias = new Set(doDia.map((caixa) => caixa.dia)).size; return dias ? centavos(soma(doDia, (caixa) => caixa.total_entradas) / dias) : null; }) };
  });

export const mediaPorCaixa = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => { const daqui = daUnidade(caixas, unidade.id); return { nome: unidade.nome, caixas: daqui.length, media: daqui.length ? centavos(soma(daqui, (caixa) => caixa.total_entradas) / daqui.length) : null }; });

const formas = Object.keys(formasPagamento);
const participacao = (caixas: CaixaRelatorio[]) => {
  const total = soma(caixas, (caixa) => caixa.total_entradas);
  return Object.fromEntries(formas.map((forma) => [forma, total ? soma(caixas, (caixa) => caixa.entradas[forma] ?? 0) / total : 0]));
};

/** Participação de cada forma de pagamento no faturamento, da maior para a menor. */
export const mixPagamento = (caixas: CaixaRelatorio[]) => {
  const fatias = participacao(caixas);
  return formas.map((forma) => ({ forma, rotulo: formasPagamento[forma], valor: centavos(soma(caixas, (caixa) => caixa.entradas[forma] ?? 0)), participacao: fatias[forma] }))
    .sort((a, b) => b.valor - a.valor);
};
export const mixPorUnidade = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => ({ nome: unidade.nome, participacao: participacao(daUnidade(caixas, unidade.id)) }));
/** Participação de cada forma por semana (a semana começa na segunda). */
export const mixSemanal = (caixas: CaixaRelatorio[]) =>
  [...new Set(caixas.map((caixa) => inicioDaSemana(caixa.dia)))].sort()
    .map((semana) => ({ semana, participacao: participacao(caixas.filter((caixa) => inicioDaSemana(caixa.dia) === semana)) }));

/** Valor registrado em cada maquininha, agrupado por unidade e do maior para o menor dentro dela. */
export const porMaquininha = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.flatMap((unidade) => {
    const totais = new Map<number, { unidade_id: number; unidade: string; nome: string; numero: string; valor: number }>();
    daUnidade(caixas, unidade.id).forEach((caixa) => caixa.maquininhas.forEach((maquininha) => {
      const atual = totais.get(maquininha.id) ?? { unidade_id: unidade.id, unidade: unidade.nome, nome: maquininha.nome, numero: maquininha.numero, valor: 0 };
      totais.set(maquininha.id, { ...atual, valor: centavos(atual.valor + maquininha.valor) });
    }));
    return [...totais.values()].sort((a, b) => b.valor - a.valor);
  });

/** Movimento da gaveta somado nos caixas fechados: entradas em dinheiro − saídas = esperado; contado − saldo inicial = apurado; a diferença é a quebra.
 * O saldo inicial fica de fora da soma: é o mesmo troco contado de novo a cada caixa. */
export function cascataGaveta(caixas: CaixaRelatorio[]) {
  const finalizados = fechados(caixas);
  const entradas = centavos(soma(finalizados, dinheiro));
  const saidas = centavos(soma(finalizados, (caixa) => caixa.total_saidas));
  const esperado = centavos(entradas - saidas);
  const apurado = centavos(soma(finalizados, (caixa) => caixa.dinheiro_fisico - caixa.saldo_inicial));
  const quebra = centavos(apurado - esperado);
  return [
    { etapa: 'Entradas em dinheiro', inicio: 0, fim: entradas, valor: entradas, tipo: 'total' },
    { etapa: 'Saídas', inicio: entradas, fim: esperado, valor: -saidas, tipo: 'saida' },
    { etapa: 'Esperado', inicio: 0, fim: esperado, valor: esperado, tipo: 'total' },
    { etapa: 'Quebra', inicio: esperado, fim: apurado, valor: quebra, tipo: quebra < 0 ? 'falta' : 'sobra' },
    { etapa: 'Apurado', inicio: 0, fim: apurado, valor: apurado, tipo: 'total' }
  ] as const;
}

export type Situacao = 'sem-caixa' | 'bateu' | 'nao-bateu' | 'em-aberto';
/** Situação de cada unidade em cada dia: não bateu se algum caixa fechado do dia não bateu; aguardando marca caixa ainda não conferido. */
export const situacaoPorDia = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[], dias: string[], config: Configuracoes) =>
  unidades.map((unidade) => ({
    nome: unidade.nome,
    dias: dias.map((dia) => {
      const doDia = daUnidade(caixas, unidade.id).filter((caixa) => caixa.dia === dia);
      const resultados = fechados(doDia).map((caixa) => bateu(caixa, config));
      const situacao: Situacao = !doDia.length ? 'sem-caixa' : resultados.includes(false) ? 'nao-bateu' : resultados.length ? 'bateu' : 'em-aberto';
      return { dia, situacao, aguardando: doDia.some((caixa) => caixa.status === 'finalizado'), caixas: doDia };
    })
  }));

/** Quebra de cada caixa fechado, para ver se as diferenças são centavos ou valores fora da curva. */
export const pontosDeQuebra = (caixas: CaixaRelatorio[], config: Configuracoes) =>
  fechados(caixas).map((caixa) => ({ id: caixa.id, unidade: caixa.unidade_nome, dia: caixa.dia, turno: caixa.turno, operador: caixa.usuario_nome, valor: caixa.diferenca_dinheiro, fora: quebraDinheiro(caixa, config) !== null }));

/** Percentual de caixas fechados que bateram, por semana e unidade; null na semana sem caixa fechado. */
export const taxaDeAcertoSemanal = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[], config: Configuracoes) => {
  const finalizados = fechados(caixas);
  return [...new Set(finalizados.map((caixa) => inicioDaSemana(caixa.dia)))].sort().map((semana) => ({
    semana,
    ...Object.fromEntries(unidades.map((unidade) => { const daSemana = daUnidade(finalizados, unidade.id).filter((caixa) => inicioDaSemana(caixa.dia) === semana); return [unidade.id, daSemana.length ? daSemana.filter((caixa) => bateu(caixa, config)).length / daSemana.length : null]; }))
  }));
};

/** Quantidade de caixas por resultado da conferência do dono. */
export const resultadoConferencia = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => {
    const daqui = daUnidade(caixas, unidade.id);
    const conferidos = daqui.filter((caixa) => caixa.status === 'conferido');
    return { nome: unidade.nome, certo: conferidos.filter((caixa) => caixa.problema_resolvido === 1).length, errado: conferidos.filter((caixa) => caixa.problema_resolvido === 0).length, conferido: conferidos.filter((caixa) => caixa.problema_resolvido === null).length, aguardando: daqui.filter((caixa) => caixa.status === 'finalizado').length };
  });

/** Saídas de dinheiro por unidade e quanto representam das entradas em dinheiro. */
export const saidasPorUnidade = (caixas: CaixaRelatorio[], unidades: UnidadeRelatorio[]) =>
  unidades.map((unidade) => {
    const daqui = daUnidade(caixas, unidade.id);
    const saidas = centavos(soma(daqui, (caixa) => caixa.total_saidas));
    const entradas = centavos(soma(daqui, dinheiro));
    return { nome: unidade.nome, saidas, entradas, participacao: entradas ? saidas / entradas : null };
  }).sort((a, b) => b.saidas - a.saidas);

/** Nas unidades em que o troco passa para o caixa seguinte: saldo inicial − dinheiro contado no caixa anterior (negativa = sumiu entre os turnos). */
export const passagemDeTurno = (caixas: CaixaRelatorio[]) =>
  caixas.filter((caixa) => caixa.troco_continua && caixa.dinheiro_anterior !== null)
    .map((caixa) => ({ id: caixa.id, unidade: caixa.unidade_nome, dia: caixa.dia, turno: caixa.turno, operador: caixa.usuario_nome, anterior: caixa.dinheiro_anterior as number, saldo_inicial: caixa.saldo_inicial, diferenca: centavos(caixa.saldo_inicial - (caixa.dinheiro_anterior as number)) }));
