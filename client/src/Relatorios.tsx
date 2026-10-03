import { useEffect, useState } from 'react';
import { request } from './api';
import { diaBrasilia, formatDay, parseDate } from './datas';
import DataInput from './DataInput';
import UnitMultiSelect from './UnitMultiSelect';
import type { Configuracoes } from './quebra';
import { periodoAnterior, somarDias, type CaixaRelatorio, type UnidadeRelatorio } from './relatorioDados';
import RelatorioResumo from './RelatorioResumo';
import RelatorioFaturamento from './RelatorioFaturamento';
import RelatorioQuebras from './RelatorioQuebras';
import RelatorioDinheiro from './RelatorioDinheiro';

type Atalho = 'hoje' | '7' | '30' | 'mes' | 'personalizado';
type Aba = 'resumo' | 'faturamento' | 'quebras' | 'dinheiro';
const abas: [Aba, string][] = [['resumo', 'Resumo'], ['faturamento', 'Faturamento'], ['quebras', 'Quebras'], ['dinheiro', 'Dinheiro']];
const atalhos: [Exclude<Atalho, 'personalizado'>, string][] = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Mês']];

const periodoDoAtalho = (atalho: Exclude<Atalho, 'personalizado'>) => {
  const hoje = diaBrasilia(new Date());
  const de = atalho === 'hoje' ? hoje : atalho === 'mes' ? `${hoje.slice(0, 8)}01` : somarDias(hoje, -(Number(atalho) - 1));
  return { de, ate: hoje };
};
const consulta = (de: string, ate: string, unidades: number[]) => `/relatorios/caixas?${new URLSearchParams({ de, ate, ...(unidades.length ? { unidades: unidades.join(',') } : {}) })}`;

export type DadosRelatorio = { caixas: CaixaRelatorio[]; anteriores: CaixaRelatorio[]; unidades: UnidadeRelatorio[]; todasUnidades: UnidadeRelatorio[]; de: string; ate: string; config: Configuracoes };

export default function Relatorios({ units, config }: { units: UnidadeRelatorio[]; config: Configuracoes }) {
  const [atalho, setAtalho] = useState<Atalho>('30');
  const [periodo, setPeriodo] = useState(() => periodoDoAtalho('30'));
  const [textos, setTextos] = useState(() => ({ de: formatDay(periodo.de), ate: formatDay(periodo.ate) }));
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [aba, setAba] = useState<Aba>('resumo');
  const [dados, setDados] = useState<{ caixas: CaixaRelatorio[]; anteriores: CaixaRelatorio[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // recarrega a cada mudança de período ou unidades; resposta de um filtro já trocado é descartada
  useEffect(() => {
    let atual = true;
    const anterior = periodoAnterior(periodo.de, periodo.ate);
    setCarregando(true); setErro('');
    Promise.all([request(consulta(periodo.de, periodo.ate, selecionadas)), request(consulta(anterior.de, anterior.ate, selecionadas))])
      .then(([caixas, anteriores]) => { if (atual) setDados({ caixas, anteriores }); })
      .catch((err) => { if (atual) setErro((err as Error).message); })
      .finally(() => { if (atual) setCarregando(false); });
    return () => { atual = false; };
  }, [periodo.de, periodo.ate, selecionadas]);

  function escolherAtalho(proximo: Exclude<Atalho, 'personalizado'>) {
    const novo = periodoDoAtalho(proximo);
    setAtalho(proximo); setPeriodo(novo); setTextos({ de: formatDay(novo.de), ate: formatDay(novo.ate) });
  }
  function digitar(campo: 'de' | 'ate', texto: string) {
    const proximos = { ...textos, [campo]: texto };
    setTextos(proximos);
    const [de, ate] = [parseDate(proximos.de), parseDate(proximos.ate)];
    if (de && ate && de <= ate) { setAtalho('personalizado'); setPeriodo({ de, ate }); }
  }
  const [de, ate] = [parseDate(textos.de), parseDate(textos.ate)];
  const aviso = de && ate && de > ate ? 'A data inicial é depois da final.' : '';
  const visiveis = selecionadas.length ? units.filter((unidade) => selecionadas.includes(unidade.id)) : units;
  const props: DadosRelatorio | null = dados && { ...dados, unidades: visiveis, todasUnidades: units, de: periodo.de, ate: periodo.ate, config };

  return <section className="panel relatorios">
    <div className="relatorio-filtros">
      <div className="atalhos" role="group" aria-label="Período">{atalhos.map(([valor, rotulo]) => <button key={valor} type="button" className={atalho === valor ? 'active' : ''} aria-pressed={atalho === valor} onClick={() => escolherAtalho(valor)}>{rotulo}</button>)}</div>
      <label className="report-date">De<DataInput label="Data inicial" value={textos.de} onChange={(texto) => digitar('de', texto)} /></label>
      <label className="report-date">Até<DataInput label="Data final" value={textos.ate} onChange={(texto) => digitar('ate', texto)} /></label>
      <UnitMultiSelect units={units} value={selecionadas} onChange={setSelecionadas} ariaLabel="Unidades" />
      {carregando && <span className="muted relatorio-carregando">Carregando…</span>}
    </div>
    {aviso && <div className="alert">{aviso}</div>}
    {erro && <div className="alert">{erro}</div>}
    <div className="abas" role="tablist">{abas.map(([valor, rotulo]) => <button key={valor} type="button" role="tab" aria-selected={aba === valor} className={aba === valor ? 'active' : ''} onClick={() => setAba(valor)}>{rotulo}</button>)}</div>
    {props && (aba === 'resumo' ? <RelatorioResumo {...props} /> : aba === 'faturamento' ? <RelatorioFaturamento {...props} /> : aba === 'quebras' ? <RelatorioQuebras {...props} /> : <RelatorioDinheiro {...props} />)}
  </section>;
}
