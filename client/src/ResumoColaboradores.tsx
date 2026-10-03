import { money } from './api';
import { bateu, corDiferenca, divergeCartoes, type Configuracoes } from './quebra';

type Caixa = { usuario_id: number; usuario_nome: string; status: string; finalizado_em: string | null; diferenca_dinheiro?: number; diferenca_cartoes?: number };
type Linha = { usuario_id: number; nome: string; caixas: number; naoBateram: number; falta: number; sobra: number; liquida: number; cartoes: number };

function agrupar(caixas: Caixa[], config: Configuracoes) {
  const linhas = new Map<number, Linha>();
  // caixa em aberto tem diferença parcial e fica fora do resumo
  for (const caixa of caixas.filter((item) => item.status !== 'aberto' && item.finalizado_em)) {
    const linha = linhas.get(caixa.usuario_id) ?? { usuario_id: caixa.usuario_id, nome: caixa.usuario_nome, caixas: 0, naoBateram: 0, falta: 0, sobra: 0, liquida: 0, cartoes: 0 };
    const quebra = caixa.diferenca_dinheiro ?? 0;
    linha.caixas += 1;
    if (bateu(caixa, config) === false) linha.naoBateram += 1;
    if (quebra < 0) linha.falta += quebra; else linha.sobra += quebra;
    linha.liquida += quebra;
    if (divergeCartoes(caixa)) linha.cartoes += 1;
    linhas.set(caixa.usuario_id, linha);
  }
  return [...linhas.values()].sort((a, b) => a.liquida - b.liquida);
}

/** Quebra de caixa por colaborador sobre os caixas já filtrados em Caixas fechados. */
export default function ResumoColaboradores({ caixas, config, onSelecionar }: { caixas: Caixa[]; config: Configuracoes; onSelecionar: (usuarioId: number) => void }) {
  const linhas = agrupar(caixas, config);
  const total = linhas.reduce((soma, linha) => ({ ...soma, caixas: soma.caixas + linha.caixas, naoBateram: soma.naoBateram + linha.naoBateram, falta: soma.falta + linha.falta, sobra: soma.sobra + linha.sobra, liquida: soma.liquida + linha.liquida, cartoes: soma.cartoes + linha.cartoes }), { usuario_id: 0, nome: 'Total', caixas: 0, naoBateram: 0, falta: 0, sobra: 0, liquida: 0, cartoes: 0 });
  const celulas = (linha: Linha) => <>
    <td>{linha.caixas}</td>
    <td className={linha.naoBateram ? 'orange' : ''}>{linha.naoBateram} <small className="muted">({linha.caixas ? Math.round((linha.naoBateram / linha.caixas) * 100) : 0}%)</small></td>
    <td className={`close-diff ${linha.falta < 0 ? 'red' : ''}`}>{money(linha.falta)}</td>
    <td className={`close-diff ${linha.sobra > 0 ? 'orange' : ''}`}>{money(linha.sobra)}</td>
    <td className="close-diff"><strong className={corDiferenca(linha.liquida)}>{money(linha.liquida)}</strong></td>
    <td className={linha.cartoes ? 'orange' : ''}>{linha.cartoes}</td>
  </>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Colaborador</th><th>Caixas</th><th>Não bateram</th><th>Falta</th><th>Sobra</th><th>Quebra líquida</th><th>Diverg. cartões/Pix</th></tr></thead>
    <tbody>{linhas.length ? linhas.map((linha) => <tr className="clickable-row" key={linha.usuario_id} title={`Ver os caixas de ${linha.nome}`} onClick={() => onSelecionar(linha.usuario_id)}><td><strong className="texto-livre">{linha.nome}</strong></td>{celulas(linha)}</tr>) : <tr><td colSpan={7} className="empty">Nenhum caixa finalizado com os filtros selecionados.</td></tr>}</tbody>
    {linhas.length > 1 && <tfoot><tr className="report-total"><td><strong>Total</strong></td>{celulas(total)}</tr></tfoot>}
  </table></div>;
}
