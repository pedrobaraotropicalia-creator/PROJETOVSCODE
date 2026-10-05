import { money } from './api';

export type Configuracoes = { tolerancia_dinheiro: number; fechamento_cego: boolean; ve_diferenca: boolean; escolhe_data_caixa: boolean };
/** Campos de diferença vêm ausentes da API quando o usuário não pode vê-los (fechamento cego). */
export type Diferencas = { status: string; diferenca_dinheiro?: number; diferenca_cartoes?: number };

export const CENTAVO = 0.009;

/** Falta ou sobra de dinheiro além da tolerância; null quando está dentro dela. */
export const quebraDinheiro = (item: Diferencas, config: Configuracoes) => {
  const valor = item.diferenca_dinheiro ?? 0;
  if (Math.abs(valor) <= config.tolerancia_dinheiro + CENTAVO) return null;
  return valor < 0 ? 'falta' : 'sobra';
};
/** Cartões e Pix precisam bater exatamente: divergência ali costuma ser erro de digitação ou venda sem repasse. */
export const divergeCartoes = (item: Diferencas) => Math.abs(item.diferenca_cartoes ?? 0) > CENTAVO;
/** null para caixa em aberto (diferença parcial) ou quando a diferença está oculta. */
export const bateu = (item: Diferencas, config: Configuracoes) => item.status === 'aberto' || item.diferenca_dinheiro === undefined ? null : !quebraDinheiro(item, config) && !divergeCartoes(item);

export const formasPagamento: Record<string, string> = { credito: 'Crédito', debito: 'Débito', pix: 'Pix', refeicao: 'Refeição', alimentacao: 'Alimentação', dinheiro: 'Dinheiro' };

export const statusCaixa = (item: Diferencas & { problema_resolvido: number | null }, config: Configuracoes) => {
  if (item.status === 'aberto') return 'Em aberto';
  if (item.status === 'conferido') return item.problema_resolvido === 1 ? 'Conferido/Certo' : item.problema_resolvido === 0 ? 'Conferido/Errado' : 'Conferido';
  const resultado = bateu(item, config);
  return resultado === null ? 'Finalizado' : resultado ? 'Bateu' : 'Pendente';
};

export const corDiferenca =(valor: number) => Math.abs(valor) <= CENTAVO ? 'green' : valor < 0 ? 'red' : 'orange';
export const descreverQuebra = (item: Diferencas, config: Configuracoes) => {
  const quebra = quebraDinheiro(item, config);
  if (quebra) return `${quebra === 'falta' ? 'Falta' : 'Sobra'} de ${money(Math.abs(item.diferenca_dinheiro ?? 0))} no dinheiro`;
  if (divergeCartoes(item)) return 'Divergência em cartões/Pix';
  return Math.abs(item.diferenca_dinheiro ?? 0) > CENTAVO ? 'Dentro da tolerância' : 'Caixa bateu';
};
