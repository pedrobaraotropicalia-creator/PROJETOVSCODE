import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './api';
import { formatDay } from './datas';
import { cascataGaveta, diasDoPeriodo, pontosDeQuebra, resultadoConferencia, situacaoPorDia, taxaDeAcertoSemanal, type Situacao } from './relatorioDados';
import { legenda, cores, corDaUnidade, dica, diaCurto, eixo, Grafico, Legenda, moedaCurta, percentual, nomeCurto, SemDados, useEixoDeNomes } from './graficos';
import type { DadosRelatorio } from './Relatorios';

const corDaEtapa = { total: cores.atual, saida: cores.neutro, falta: cores.falta, sobra: cores.sobra };
const situacoes: Record<Situacao, { cor: string; rotulo: string }> = {
  bateu: { cor: cores.bom, rotulo: 'Bateu' },
  'nao-bateu': { cor: cores.falta, rotulo: 'Não bateu' },
  'em-aberto': { cor: cores.anterior, rotulo: 'Reaberto (diferença parcial)' },
  'sem-caixa': { cor: '#f1f4f5', rotulo: 'Sem caixa finalizado' }
};
// espalha os pontos de uma mesma unidade na vertical, sempre na mesma posição para o mesmo caixa
const espalhar = (id: number) => ((id * 9301 + 49297) % 233280) / 233280 * 0.5 - 0.25;

export default function RelatorioQuebras({ caixas, unidades, todasUnidades, de, ate, config }: DadosRelatorio) {
  const larguraNomes = useEixoDeNomes();
  if (!caixas.length) return <SemDados />;
  const cascata = cascataGaveta(caixas).map((etapa) => ({ ...etapa, base: Math.min(etapa.inicio, etapa.fim), altura: Math.abs(etapa.fim - etapa.inicio) }));
  const calendario = situacaoPorDia(caixas, unidades, diasDoPeriodo(de, ate), config);
  const pontos = pontosDeQuebra(caixas, config).map((ponto) => ({ ...ponto, posicao: unidades.findIndex((unidade) => unidade.nome === ponto.unidade) + espalhar(ponto.id) }));
  const tolerancia = config.tolerancia_dinheiro;
  return <div className="relatorio-grid">
    <Grafico largo titulo="Movimento do dinheiro da gaveta" descricao="Soma dos caixas fechados. Esperado = entradas em dinheiro − saídas. Apurado = dinheiro contado no fechamento − saldo inicial. A diferença é a quebra.">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={cascata} margin={{ top: 24, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={cores.grade} vertical={false} />
          <XAxis dataKey="etapa" {...eixo} interval={0} />
          <YAxis tickFormatter={moedaCurta} {...eixo} width={72} />
          <Tooltip {...dica} cursor={{ fill: '#f4f8f7' }} content={({ active, payload }) => active && payload?.length ? <div className="grafico-dica"><strong>{payload[0].payload.etapa}</strong>{money(payload[0].payload.valor)}</div> : null} />
          <Bar dataKey="base" stackId="cascata" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="altura" stackId="cascata" radius={[4, 4, 0, 0]} barSize={48}>
            {cascata.map((etapa) => <Cell key={etapa.etapa} fill={corDaEtapa[etapa.tipo]} />)}
            <LabelList dataKey="valor" position="top" formatter={(valor) => money(Number(valor))} fill="#18324a" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico largo titulo="Calendário dos caixas" descricao="Situação de cada unidade em cada dia. O ponto marca caixa ainda não conferido.">
      <div className="calendario-rolagem"><table className="calendario"><thead><tr><th />{calendario[0]?.dias.map(({ dia }) => <th key={dia}>{dia.slice(8, 10)}</th>)}</tr></thead><tbody>{calendario.map((linha) => <tr key={linha.nome}><th title={linha.nome}>{linha.nome}</th>{linha.dias.map((celula) => <td key={celula.dia}><span className={`calendario-dia ${celula.aguardando ? 'aguardando' : ''}`} style={{ background: situacoes[celula.situacao].cor }} title={`${linha.nome} · ${formatDay(celula.dia)}: ${situacoes[celula.situacao].rotulo}${celula.caixas.map((caixa) => `\n${caixa.turno} · ${caixa.usuario_nome} · ${caixa.status === 'conferido' ? 'conferido' : caixa.status === 'finalizado' ? 'aguardando conferência' : 'reaberto'}`).join('')}`} /></td>)}</tr>)}</tbody></table></div>
      <Legenda itens={Object.values(situacoes)} />
    </Grafico>
    <Grafico titulo="Quebra de cada caixa" descricao={`Cada ponto é um caixa fechado. A faixa cinza é a tolerância (${money(tolerancia)}).`}>
      <ResponsiveContainer width="100%" height={Math.max(200, unidades.length * 56)}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={cores.grade} horizontal={false} />
          <ReferenceArea x1={-tolerancia} x2={tolerancia} fill="#eef2f3" fillOpacity={1} />
          <ReferenceLine x={0} stroke={cores.neutro} />
          <XAxis type="number" dataKey="valor" tickFormatter={moedaCurta} {...eixo} />
          <YAxis type="number" dataKey="posicao" domain={[-0.5, unidades.length - 0.5]} ticks={unidades.map((_, indice) => indice)} tickFormatter={(indice) => nomeCurto(unidades[indice]?.nome ?? '')} {...eixo} width={larguraNomes} reversed />
          <Tooltip {...dica} cursor={false} content={({ active, payload }) => active && payload?.length ? <div className="grafico-dica"><strong>{payload[0].payload.unidade}</strong>{formatDay(payload[0].payload.dia)} · {payload[0].payload.turno} · {payload[0].payload.operador}<br />{money(payload[0].payload.valor)}</div> : null} />
          <Scatter data={pontos} isAnimationActive={false}>
            {pontos.map((ponto) => <Cell key={ponto.id} fill={!ponto.fora ? cores.neutro : ponto.valor < 0 ? cores.falta : cores.sobra} fillOpacity={ponto.fora ? 0.9 : 0.45} stroke="#fff" strokeWidth={1} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <Legenda itens={[{ cor: cores.falta, rotulo: 'Falta fora da tolerância' }, { cor: cores.sobra, rotulo: 'Sobra fora da tolerância' }, { cor: cores.neutro, rotulo: 'Dentro da tolerância' }]} />
    </Grafico>
    <Grafico titulo="Caixas que bateram, por semana" descricao="Percentual dos caixas fechados de cada semana (a partir de segunda) que bateram">
      <ResponsiveContainer width="100%" height={Math.max(200, unidades.length * 56)}>
        <LineChart data={taxaDeAcertoSemanal(caixas, unidades, config)} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={cores.grade} vertical={false} />
          <XAxis dataKey="semana" tickFormatter={diaCurto} {...eixo} />
          <YAxis domain={[0, 1]} tickFormatter={percentual} {...eixo} width={44} />
          <Tooltip {...dica} formatter={(valor) => percentual(Number(valor))} labelFormatter={(semana) => `Semana de ${formatDay(String(semana))}`} />
          {unidades.length > 1 && <Legend iconType="plainline" {...legenda} />}
          {unidades.map((unidade) => <Line key={unidade.id} dataKey={String(unidade.id)} name={unidade.nome} stroke={corDaUnidade(todasUnidades, unidade.id)} strokeWidth={2} dot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico largo titulo="Resultado da conferência" descricao="Quantidade de caixas por decisão do dono">
      <ResponsiveContainer width="100%" height={Math.max(200, unidades.length * 72)}>
        <BarChart data={resultadoConferencia(caixas, unidades)} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barGap={2}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="nome" tickFormatter={(nome: string) => nomeCurto(nome)} {...eixo} width={larguraNomes} />
          <Tooltip {...dica} cursor={{ fill: '#f4f8f7' }} />
          <Legend {...legenda} />
          {([['certo', 'Certo', cores.bom], ['errado', 'Errado', cores.falta], ['conferido', 'Conferido sem decisão', cores.neutro], ['aguardando', 'Aguardando conferência', cores.alerta]] as const).map(([chave, rotulo, cor]) =>
            <Bar key={chave} dataKey={chave} name={rotulo} fill={cor} radius={[0, 4, 4, 0]} barSize={10}><LabelList dataKey={chave} position="right" fill="#18324a" fontSize={11} /></Bar>)}
        </BarChart>
      </ResponsiveContainer>
    </Grafico>
  </div>;
}
