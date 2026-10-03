import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { money } from './api';
import { formatDate, formatDateTime } from './datas';
import { descreverQuebra, formasPagamento, statusCaixa, type Configuracoes } from './quebra';

type Contagem = { etapa: 'abertura' | 'fechamento'; denominacao: number; quantidade: number; total: number };
export type DetalheCaixa = {
  /** Campos de diferença vêm ausentes da API no fechamento cego. */
  fechamento: { id: number; unidade_nome: string; usuario_nome: string; turno: string; status: string; problema_resolvido: number | null; conferido_por_nome: string | null; criado_em: string; finalizado_em: string | null; saldo_inicial: number; total_entradas: number; total_maquininhas: number; total_saidas: number; dinheiro_fisico: number; diferenca_dinheiro?: number; diferenca_cartoes?: number };
  entradas: { forma_pagamento: string; valor: number }[];
  maquininhas: { nome: string; numero: string; numero_serie: string; valor: number }[];
  saidas: { motivo: string; valor: number }[];
  contagens: Contagem[];
};

const MARGEM = 14;
const COR_TITULO: [number, number, number] = [24, 50, 74];
const COR_CABECALHO: [number, number, number] = [36, 112, 120];
// o Intl separa "R$" do número com espaços Unicode; a fonte padrão do jsPDF só garante o espaço comum
const texto = (conteudo: string) => conteudo.replace(/\s/g, ' ');
const valor = (numero: number) => texto(money(numero));
const soma = (itens: { valor: number }[]) => itens.reduce((total, item) => total + item.valor, 0);
const ultimaTabela = (doc: jsPDF) => (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

/** Gera e baixa o PDF com todos os registros de um caixa. */
export function exportarPdfCaixa(data: DetalheCaixa, config: Configuracoes, emitidoPor: string) {
  const caixa = data.fechamento;
  const doc = new jsPDF();
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const emitidoEm = formatDateTime(new Date());

  doc.setTextColor(...COR_TITULO);
  doc.setFont('helvetica', 'bold').setFontSize(16).text(`Fechamento de caixa #${caixa.id}`, MARGEM, 18);
  doc.setFont('helvetica', 'normal').setFontSize(11).text(`${caixa.unidade_nome} · ${caixa.turno}`, MARGEM, 25);
  let y = 30;

  const tabela = (titulo: string, head: string[], body: RowInput[], foot?: RowInput) => {
    if (y > alturaPagina - 40) { doc.addPage(); y = 18; }
    doc.setTextColor(...COR_TITULO).setFont('helvetica', 'bold').setFontSize(11).text(titulo, MARGEM, y + 6);
    const vazio = [[{ content: 'Nada registrado.', colSpan: head.length, styles: { textColor: 120, fontStyle: 'italic' as const } }]];
    autoTable(doc, {
      startY: y + 9,
      head: [head],
      body: body.length ? body : vazio,
      foot: foot && body.length ? [foot] : undefined,
      theme: 'grid',
      margin: { left: MARGEM, right: MARGEM },
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: COR_CABECALHO },
      footStyles: { fillColor: [233, 243, 240], textColor: COR_TITULO },
      // valores à direita em cabeçalho, linhas e total
      didParseCell: (cell) => { if (cell.column.index === head.length - 1) cell.cell.styles.halign = 'right'; }
    });
    y = ultimaTabela(doc) + 4;
  };

  const identificacao: RowInput[] = [
    ['Operador', caixa.usuario_nome],
    ['Aberto em', formatDateTime(caixa.criado_em)],
    ['Finalizado em', caixa.finalizado_em ? formatDateTime(caixa.finalizado_em) : 'Não finalizado'],
    ['Status', statusCaixa(caixa, config)]
  ];
  if (caixa.conferido_por_nome) identificacao.push(['Conferido por', caixa.conferido_por_nome]);
  autoTable(doc, { startY: y, body: identificacao, theme: 'plain', margin: { left: MARGEM, right: MARGEM }, styles: { fontSize: 10, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } } });
  y = ultimaTabela(doc) + 2;

  const resumo: RowInput[] = [
    ['Saldo inicial', valor(caixa.saldo_inicial)],
    ['Entradas do sistema', valor(caixa.total_entradas)],
    ['Maquininhas', valor(caixa.total_maquininhas)],
    ['Saídas', valor(caixa.total_saidas)],
    ['Dinheiro físico contado', valor(caixa.dinheiro_fisico)]
  ];
  if (caixa.diferenca_dinheiro === undefined) resumo.push(['Diferença', 'Oculta (fechamento cego)']);
  else {
    resumo.push(['Quebra de dinheiro', valor(caixa.diferenca_dinheiro)], ['Divergência cartões/Pix', valor(caixa.diferenca_cartoes ?? 0)]);
    if (caixa.status !== 'aberto') resumo.push(['Resultado', texto(descreverQuebra(caixa, config))]);
  }
  tabela(caixa.status === 'aberto' ? 'Resumo (caixa em aberto: valores parciais)' : 'Resumo', ['Item', 'Valor'], resumo);

  const contagem = (etapa: Contagem['etapa']) => {
    const itens = data.contagens.filter((item) => item.etapa === etapa).sort((a, b) => b.denominacao - a.denominacao);
    return { body: itens.map((item) => [`${item.denominacao >= 2 ? 'Nota' : 'Moeda'} de ${valor(item.denominacao)}`, String(item.quantidade), valor(item.total)]), total: valor(soma(itens.map((item) => ({ valor: item.total })))) };
  };
  const abertura = contagem('abertura');
  tabela('Contagem de abertura', ['Cédula ou moeda', 'Quantidade', 'Total'], abertura.body, ['Total', '', abertura.total]);

  const ordemFormas = Object.keys(formasPagamento);
  const entradas = [...data.entradas].sort((a, b) => ordemFormas.indexOf(a.forma_pagamento) - ordemFormas.indexOf(b.forma_pagamento));
  tabela('Entradas do sistema por forma de pagamento', ['Forma de pagamento', 'Valor'], entradas.map((item) => [formasPagamento[item.forma_pagamento] ?? item.forma_pagamento, valor(item.valor)]), ['Total', valor(soma(entradas))]);

  tabela('Relatórios das maquininhas', ['Maquininha', 'Número', 'Série', 'Valor'], data.maquininhas.map((item) => [item.nome, item.numero, item.numero_serie, valor(item.valor)]), ['Total', '', '', valor(soma(data.maquininhas))]);

  tabela('Saídas de dinheiro', ['Motivo', 'Valor'], data.saidas.map((item) => [item.motivo, valor(item.valor)]), ['Total', valor(soma(data.saidas))]);

  const final = contagem('fechamento');
  tabela('Contagem final', ['Cédula ou moeda', 'Quantidade', 'Total'], final.body, ['Total', '', final.total]);

  const paginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(112, 131, 141);
    doc.text(`Emitido em ${emitidoEm} por ${emitidoPor}`, MARGEM, alturaPagina - 8);
    doc.text(`Página ${pagina} de ${paginas}`, larguraPagina - MARGEM, alturaPagina - 8, { align: 'right' });
  }

  const dia = formatDate(caixa.finalizado_em || caixa.criado_em).replace(/\//g, '-');
  doc.save(`caixa-${caixa.id}-${caixa.unidade_nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dia}.pdf`);
}
