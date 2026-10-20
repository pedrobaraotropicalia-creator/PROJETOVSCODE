import { money } from './api';

/** O que o usuário vê (GET /acesso): diferenças em alguma unidade e o campo de data na abertura do caixa. */
export type Acesso = { ve_diferenca: boolean; escolhe_data_caixa: boolean };
/** Campos de diferença vêm ausentes da API quando o usuário não pode vê-los (fechamento cego da unidade).
 * A tolerância é a da unidade do caixa, que a API manda junto com ele. */
export type Diferencas = { status: string; diferenca_dinheiro?: number; diferenca_cartoes?: number; tolerancia_dinheiro?: number };

export const CENTAVO = 0.009;

/** Falta ou sobra de dinheiro além da tolerância; null quando está dentro dela. */
export const quebraDinheiro = (item: Diferencas) => {
  const valor = item.diferenca_dinheiro ?? 0;
  if (Math.abs(valor) <= (item.tolerancia_dinheiro ?? 0) + CENTAVO) return null;
  return valor < 0 ? 'falta' : 'sobra';
};
/** Cartões e Pix precisam bater exatamente: divergência ali costuma ser erro de digitação ou venda sem repasse. */
export const divergeCartoes = (item: Diferencas) => Math.abs(item.diferenca_cartoes ?? 0) > CENTAVO;
/** null para caixa em aberto (diferença parcial) ou quando a diferença está oculta. */
export const bateu = (item: Diferencas) => item.status === 'aberto' || item.diferenca_dinheiro === undefined ? null : !quebraDinheiro(item) && !divergeCartoes(item);

export const formasPagamento: Record<string, string> = { credito: 'Crédito', debito: 'Débito', pix: 'Pix', refeicao: 'Refeição', alimentacao: 'Alimentação', dinheiro: 'Dinheiro' };

export const statusCaixa = (item: Diferencas & { problema_resolvido: number | null }) => {
  if (item.status === 'aberto') return 'Em aberto';
  if (item.status === 'conferido') return item.problema_resolvido === 1 ? 'Conferido/Certo' : item.problema_resolvido === 0 ? 'Conferido/Errado' : 'Conferido';
  const resultado = bateu(item);
  return resultado === null ? 'Finalizado' : resultado ? 'Bateu' : 'Pendente';
};

export const corDiferenca =(valor: number) => Math.abs(valor) <= CENTAVO ? 'green' : valor < 0 ? 'red' : 'orange';
export const descreverQuebra = (item: Diferencas) => {
  const quebra = quebraDinheiro(item);
  if (quebra) return `${quebra === 'falta' ? 'Falta' : 'Sobra'} de ${money(Math.abs(item.diferenca_dinheiro ?? 0))} no dinheiro`;
  if (divergeCartoes(item)) return 'Divergência em cartões/Pix';
  return Math.abs(item.diferenca_dinheiro ?? 0) > CENTAVO ? 'Dentro da tolerância' : 'Caixa bateu';
};
