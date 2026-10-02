import { useState } from 'react';
import { PatternFormat } from 'react-number-format';
import { money } from './api';
import { diaBrasilia, formatDate, parseDate } from './datas';
import { bateu, corDiferenca, divergeCartoes, type Configuracoes } from './quebra';
import UnitMultiSelect from './UnitMultiSelect';

type Unit = { id: number; nome: string };
type Caixa = { usuario_id: number; usuario_nome: string; unidade_id: number; status: string; finalizado_em: string | null; diferenca_dinheiro?: number; diferenca_cartoes?: number };
type Linha = { usuario_id: number; nome: string; caixas: number; naoBateram: number; falta: number; sobra: number; liquida: number; cartoes: number };

// análise por padrão de 15 dias, não por episódio isolado
const PERIODO_PADRAO_DIAS = 15;

function DateInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <PatternFormat format="##/##/####" mask="_" placeholder="DD/MM/AAAA" inputMode="numeric" aria-label={label} value={value} onValueChange={(values) => onChange(values.value ? values.formattedValue : '')} />;
}

function agrupar(caixas: Caixa[], config: Configuracoes) {
  const linhas = new Map<number, Linha>();
  for (const caixa of caixas) {
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

export default function Relatorios({ closes, units, config }: { closes: Caixa[]; units: Unit[]; config: Configuracoes }) {
  const hoje = new Date();
  const [de, setDe] = useState(formatDate(new Date(hoje.getTime() - (PERIODO_PADRAO_DIAS - 1) * 86_400_000)));
  const [ate, setAte] = useState(formatDate(hoje));
  const [unidades, setUnidades] = useState<number[]>([]);
  const [inicio, fim] = [parseDate(de), parseDate(ate)];
  const periodoValido = inicio && fim && inicio <= fim;
  const caixas = periodoValido ? closes.filter((caixa) => caixa.status !== 'aberto' && caixa.finalizado_em && (!unidades.length || unidades.includes(caixa.unidade_id)) && diaBrasilia(caixa.finalizado_em) >= inicio && diaBrasilia(caixa.finalizado_em) <= fim) : [];
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
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">RELATÓRIO</span><h2>Quebra de caixa por operador</h2></div></div>
    <p className="muted">Quebra de dinheiro dos caixas finalizados no período{config.tolerancia_dinheiro > 0 ? `, com tolerância de ${money(config.tolerancia_dinheiro)} por caixa` : ''}. Quem tem mais falta aparece primeiro.</p>
    <div className="filters close-filters">
      <label className="report-date">De<DateInput label="Data inicial" value={de} onChange={setDe} /></label>
      <label className="report-date">Até<DateInput label="Data final" value={ate} onChange={setAte} /></label>
      <UnitMultiSelect units={units} value={unidades} onChange={setUnidades} ariaLabel="Filtrar por unidades" />
    </div>
    {!periodoValido && <div className="alert">Informe um período válido no formato DD/MM/AAAA.</div>}
    <div className="table-wrap"><table>
      <thead><tr><th>Operador</th><th>Caixas</th><th>Não bateram</th><th>Falta</th><th>Sobra</th><th>Quebra líquida</th><th>Diverg. cartões/Pix</th></tr></thead>
      <tbody>{linhas.length ? linhas.map((linha) => <tr key={linha.usuario_id}><td><strong>{linha.nome}</strong></td>{celulas(linha)}</tr>) : <tr><td colSpan={7} className="empty">Nenhum caixa finalizado no período.</td></tr>}</tbody>
      {linhas.length > 1 && <tfoot><tr className="report-total"><td><strong>Total</strong></td>{celulas(total)}</tr></tfoot>}
    </table></div>
  </section>;
}
