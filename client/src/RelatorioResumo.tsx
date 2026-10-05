import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './api';
import { formatDay } from './datas';
import { diasDoPeriodo, porDia, porUnidade, quebraPorUnidade, resumo, variacao } from './relatorioDados';
import { legenda, cores, corDaUnidade, dica, dicaMoeda, diaCurto, eixo, Grafico, moedaCurta, percentual, nomeCurto, SemDados, useEixoDeNomes } from './graficos';
import type { DadosRelatorio } from './Relatorios';

const textoVariacao = (valor: number | null) => valor === null ? 'Sem caixas no período anterior' : `${valor >= 0 ? '+' : '−'}${percentual(Math.abs(valor))} sobre o período anterior`;
const plural = (quantidade: number, singular: string, varios: string) => `${quantidade} ${quantidade === 1 ? singular : varios}`;

export default function RelatorioResumo({ caixas, anteriores, anterior, unidades, todasUnidades, de, ate, config }: DadosRelatorio) {
  const atual = resumo(caixas, config);
  const passado = resumo(anteriores, config);
  const mudanca = variacao(atual.faturamento, passado.faturamento);
  const dias = diasDoPeriodo(de, ate);
  const linhasDia = porDia(caixas, unidades, dias);
  // com muitos dias a linha não tem marcadores; um dia isolado (sem vizinhos) ainda precisa de um ponto para aparecer
  const pontoDaLinha = (serie: string) => (props: { cx?: number; cy?: number; index?: number; stroke?: string; key?: React.Key | null }) => {
    const vazio = (indice: number) => (linhasDia[indice] as Record<string, unknown> | undefined)?.[serie] == null;
    const indice = props.index ?? 0;
    const mostrar = props.cy != null && (dias.length <= 7 || (vazio(indice - 1) && vazio(indice + 1)));
    return mostrar ? <circle key={props.key ?? undefined} cx={props.cx} cy={props.cy} r={dias.length <= 7 ? 4 : 3} fill={props.stroke} /> : <g key={props.key ?? undefined} />;
  };
  const quebras = quebraPorUnidade(caixas, unidades);
  // zero no centro, falta à esquerda e sobra à direita; folga nas pontas para o valor escrito
  const limite = Math.max(...quebras.flatMap((linha) => [-linha.falta, linha.sobra]), 1) * 1.6;
  const corDaQuebra = (lado: { falta: number; sobra: number }) => lado.falta ? 'red' : lado.sobra ? 'orange' : 'green';
  const larguraNomes = useEixoDeNomes();
  return <>
    <div className="stats relatorio-cards">
      <article><span>Faturamento</span><strong>{money(atual.faturamento)}</strong><small className={mudanca === null ? '' : mudanca >= 0 ? 'green' : 'red'}>{textoVariacao(mudanca)}</small></article>
      <article><span>Quebra de dinheiro</span><strong className={corDaQuebra(atual.dinheiro)}>{money(atual.dinheiro.falta + atual.dinheiro.sobra)}</strong><small>Falta {money(atual.dinheiro.falta)} · sobra {money(atual.dinheiro.sobra)} · {plural(atual.foraDaTolerancia, 'caixa fora da tolerância', 'caixas fora da tolerância')}</small></article>
      <article><span>Divergência em cartões/Pix</span><strong className={corDaQuebra(atual.cartoes)}>{money(atual.cartoes.falta + atual.cartoes.sobra)}</strong><small>Maquininhas abaixo {money(atual.cartoes.falta)} · acima {money(atual.cartoes.sobra)} · {plural(atual.comDivergenciaCartoes, 'caixa com divergência', 'caixas com divergência')}</small></article>
      <article><span>Aguardando conferência</span><strong className={atual.pendentes ? 'orange' : ''}>{atual.aguardandoConferencia}</strong><small>{plural(atual.pendentes, 'com diferença pendente', 'com diferença pendente')}</small></article>
    </div>
    {!caixas.length ? <SemDados /> : <div className="relatorio-grid">
      <Grafico largo titulo="Faturamento por dia" descricao="Soma das entradas do sistema nos caixas finalizados em cada dia">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={linhasDia} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={cores.grade} vertical={false} />
            <XAxis dataKey="dia" tickFormatter={diaCurto} {...eixo} minTickGap={16} />
            <YAxis tickFormatter={moedaCurta} {...eixo} width={72} />
            <Tooltip {...dica} formatter={dicaMoeda} labelFormatter={(dia) => formatDay(String(dia))} />
            {unidades.length > 1 && <Legend iconType="plainline" {...legenda} />}
            {unidades.map((unidade) => <Line key={unidade.id} dataKey={String(unidade.id)} name={unidade.nome} stroke={corDaUnidade(todasUnidades, unidade.id)} strokeWidth={2} dot={pontoDaLinha(String(unidade.id))} activeDot={{ r: 5 }} connectNulls={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </Grafico>
      <Grafico titulo="Faturamento por unidade" descricao={`Período atual comparado a ${formatDay(anterior.de)} a ${formatDay(anterior.ate)}`}>
        <ResponsiveContainer width="100%" height={Math.max(160, unidades.length * 64)}>
          <BarChart data={porUnidade(caixas, anteriores, unidades)} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barGap={2}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="nome" tickFormatter={(nome: string) => nomeCurto(nome)} {...eixo} width={larguraNomes} />
            <Tooltip {...dica} formatter={dicaMoeda} cursor={{ fill: '#f4f8f7' }} />
            <Legend {...legenda} />
            <Bar dataKey="total" name="Período atual" fill={cores.atual} radius={[0, 4, 4, 0]} barSize={14}><LabelList dataKey="total" position="right" formatter={(valor) => moedaCurta(Number(valor))} fill="#18324a" fontSize={11} /></Bar>
            <Bar dataKey="anterior" name="Período anterior" fill={cores.anterior} radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </Grafico>
      <Grafico titulo="Quebra de dinheiro por unidade" descricao="Faltas (à esquerda) e sobras (à direita) da gaveta nos caixas fechados, somadas em separado">
        <ResponsiveContainer width="100%" height={Math.max(160, unidades.length * 48)}>
          <BarChart data={quebras} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis type="number" hide domain={[-limite, limite]} />
            <YAxis type="category" dataKey="nome" tickFormatter={(nome: string) => nomeCurto(nome)} {...eixo} width={larguraNomes} />
            <ReferenceLine x={0} stroke={cores.neutro} />
            <Tooltip {...dica} formatter={(valor, nome) => [money(Math.abs(Number(valor))), nome]} cursor={{ fill: '#f4f8f7' }} />
            <Bar dataKey="falta" name="Falta" stackId="quebra" fill={cores.falta} radius={4} barSize={18}><LabelList dataKey="falta" content={({ x, y, width, height, value }) => { const numero = Number(value); if (!numero) return null; const [inicio, fimBarra] = [Number(x), Number(x) + Number(width)].sort((a, b) => a - b); return <text x={numero < 0 ? inicio - 6 : fimBarra + 6} y={Number(y) + Number(height) / 2} textAnchor={numero < 0 ? 'end' : 'start'} dominantBaseline="central" fill="#18324a" fontSize={11}>{money(Math.abs(numero))}</text>; }} /></Bar>
            <Bar dataKey="sobra" name="Sobra" stackId="quebra" fill={cores.sobra} radius={4} barSize={18}><LabelList dataKey="sobra" content={({ x, y, width, height, value }) => { const numero = Number(value); if (!numero) return null; const [inicio, fimBarra] = [Number(x), Number(x) + Number(width)].sort((a, b) => a - b); return <text x={numero < 0 ? inicio - 6 : fimBarra + 6} y={Number(y) + Number(height) / 2} textAnchor={numero < 0 ? 'end' : 'start'} dominantBaseline="central" fill="#18324a" fontSize={11}>{money(Math.abs(numero))}</text>; }} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </Grafico>
    </div>}
  </>;
}
