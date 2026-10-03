import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './api';
import { formatDay } from './datas';
import { corDiferenca } from './quebra';
import { diasDoPeriodo, porDia, porUnidade, quebraPorUnidade, resumo, variacao } from './relatorioDados';
import { legenda, cores, corDaUnidade, dica, dicaMoeda, diaCurto, eixo, Grafico, moedaCurta, percentual, nomeCurto, SemDados, useEixoDeNomes } from './graficos';
import type { DadosRelatorio } from './Relatorios';

const textoVariacao = (valor: number | null) => valor === null ? 'Sem caixas no período anterior' : `${valor >= 0 ? '+' : '−'}${percentual(Math.abs(valor))} sobre o período anterior`;
const plural = (quantidade: number, singular: string, varios: string) => `${quantidade} ${quantidade === 1 ? singular : varios}`;

export default function RelatorioResumo({ caixas, anteriores, unidades, todasUnidades, de, ate, config }: DadosRelatorio) {
  const atual = resumo(caixas, config);
  const passado = resumo(anteriores, config);
  const mudanca = variacao(atual.faturamento, passado.faturamento);
  const dias = diasDoPeriodo(de, ate);
  const quebras = quebraPorUnidade(caixas, unidades);
  // zero no centro: o valor fica do lado oposto da barra, onde sempre há espaço
  const limite = Math.max(...quebras.map((linha) => Math.abs(linha.valor)), 1);
  const larguraNomes = useEixoDeNomes();
  return <>
    <div className="stats relatorio-cards">
      <article><span>Faturamento</span><strong>{money(atual.faturamento)}</strong><small className={mudanca === null ? '' : mudanca >= 0 ? 'green' : 'red'}>{textoVariacao(mudanca)}</small></article>
      <article><span>Quebra de dinheiro</span><strong className={corDiferenca(atual.quebraDinheiro)}>{money(atual.quebraDinheiro)}</strong><small>{plural(atual.foraDaTolerancia, 'caixa fora da tolerância', 'caixas fora da tolerância')}</small></article>
      <article><span>Divergência em cartões/Pix</span><strong className={corDiferenca(atual.divergenciaCartoes)}>{money(atual.divergenciaCartoes)}</strong><small>{plural(atual.comDivergenciaCartoes, 'caixa com divergência', 'caixas com divergência')}</small></article>
      <article><span>Aguardando conferência</span><strong className={atual.pendentes ? 'orange' : ''}>{atual.aguardandoConferencia}</strong><small>{plural(atual.pendentes, 'com diferença pendente', 'com diferença pendente')}</small></article>
    </div>
    {!caixas.length ? <SemDados /> : <div className="relatorio-grid">
      <Grafico largo titulo="Faturamento por dia" descricao="Soma das entradas do sistema nos caixas finalizados em cada dia">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={porDia(caixas, unidades, dias)} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={cores.grade} vertical={false} />
            <XAxis dataKey="dia" tickFormatter={diaCurto} {...eixo} minTickGap={16} />
            <YAxis tickFormatter={moedaCurta} {...eixo} width={72} />
            <Tooltip {...dica} formatter={dicaMoeda} labelFormatter={(dia) => formatDay(String(dia))} />
            {unidades.length > 1 && <Legend iconType="plainline" {...legenda} />}
            {unidades.map((unidade) => <Line key={unidade.id} dataKey={String(unidade.id)} name={unidade.nome} stroke={corDaUnidade(todasUnidades, unidade.id)} strokeWidth={2} dot={dias.length <= 7 ? { r: 4 } : false} activeDot={{ r: 5 }} connectNulls={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </Grafico>
      <Grafico titulo="Faturamento por unidade" descricao="Período atual comparado ao período anterior de mesmo tamanho">
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
      <Grafico titulo="Quebra de dinheiro por unidade" descricao="Soma das faltas e sobras da gaveta nos caixas fechados">
        <ResponsiveContainer width="100%" height={Math.max(160, unidades.length * 48)}>
          <BarChart data={quebras} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis type="number" hide domain={[-limite, limite]} />
            <YAxis type="category" dataKey="nome" tickFormatter={(nome: string) => nomeCurto(nome)} {...eixo} width={larguraNomes} />
            <ReferenceLine x={0} stroke={cores.neutro} />
            <Tooltip {...dica} formatter={(valor) => [money(Number(valor)), Number(valor) < 0 ? 'Falta' : 'Sobra']} cursor={{ fill: '#f4f8f7' }} />
            <Bar dataKey="valor" radius={4} barSize={18}>
              {quebras.map((linha) => <Cell key={linha.unidade_id} fill={linha.valor < 0 ? cores.falta : cores.sobra} />)}
              <LabelList dataKey="valor" content={({ x, y, width, height, value }) => { const negativo = Number(value) < 0; const zero = negativo ? Math.max(Number(x), Number(x) + Number(width)) : Math.min(Number(x), Number(x) + Number(width)); const ponta = negativo ? zero + 6 : zero - 6; return <text x={ponta} y={Number(y) + Number(height) / 2} textAnchor={negativo ? 'start' : 'end'} dominantBaseline="central" fill="#18324a" fontSize={11}>{money(Number(value))}</text>; }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Grafico>
    </div>}
  </>;
}
