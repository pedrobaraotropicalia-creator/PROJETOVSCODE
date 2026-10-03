import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './api';
import { formatDay } from './datas';
import { formasPagamento } from './quebra';
import { mediaPorCaixa, mixPagamento, mixPorUnidade, mixSemanal, nomesDiasDaSemana, porDiaDaSemana, porMaquininha, porTurno } from './relatorioDados';
import { legenda, cores, corDaUnidade, dica, dicaMoeda, diaCurto, eixo, Grafico, MapaDeCalor, moedaCurta, percentual, nomeCurto, SemDados, useEixoDeNomes } from './graficos';
import type { DadosRelatorio } from './Relatorios';

// seis formas em linhas não se distinguem; na evolução semanal elas viram quatro grupos
const grupos = [
  { chave: 'cartoes', rotulo: 'Cartões', formas: ['credito', 'debito'], cor: '#2a78d6' },
  { chave: 'pix', rotulo: 'Pix', formas: ['pix'], cor: '#eb6834' },
  { chave: 'vales', rotulo: 'Vales (refeição e alimentação)', formas: ['refeicao', 'alimentacao'], cor: '#1baf7a' },
  { chave: 'dinheiro', rotulo: 'Dinheiro', formas: ['dinheiro'], cor: '#4a3aa7' }
];

export default function RelatorioFaturamento({ caixas, unidades, todasUnidades }: DadosRelatorio) {
  const larguraNomes = useEixoDeNomes();
  if (!caixas.length) return <SemDados />;
  const mix = mixPagamento(caixas);
  const semanas = mixSemanal(caixas).map((semana) => ({ semana: semana.semana, ...Object.fromEntries(grupos.map((grupo) => [grupo.chave, grupo.formas.reduce((total, forma) => total + semana.participacao[forma], 0)])) }));
  const semana = porDiaDaSemana(caixas, unidades);
  const porUnidadeMix = mixPorUnidade(caixas, unidades);
  const maquininhas = porMaquininha(caixas, unidades);
  const medias = mediaPorCaixa(caixas, unidades);
  return <div className="relatorio-grid">
    <Grafico titulo="Almoço e jantar" descricao="Faturamento de cada turno por unidade">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={porTurno(caixas, unidades)} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={cores.grade} vertical={false} />
          <XAxis dataKey="nome" {...eixo} interval={0} tickFormatter={(nome: string) => nomeCurto(nome, 14)} />
          <YAxis tickFormatter={moedaCurta} {...eixo} width={72} />
          <Tooltip {...dica} formatter={dicaMoeda} cursor={{ fill: '#f4f8f7' }} />
          <Legend {...legenda} />
          <Bar dataKey="almoco" name="Almoço" fill="#86b6ef" radius={[4, 4, 0, 0]} barSize={22} />
          <Bar dataKey="jantar" name="Jantar" fill={cores.atual} radius={[4, 4, 0, 0]} barSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico titulo="Formas de pagamento" descricao="Participação de cada forma no faturamento">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={mix} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="rotulo" {...eixo} width={96} />
          <Tooltip {...dica} cursor={{ fill: '#f4f8f7' }} formatter={(valor, _nome, item) => [`${money(Number(valor))} (${percentual(item.payload.participacao)})`, 'Faturamento']} />
          <Bar dataKey="valor" fill={cores.atual} radius={[0, 4, 4, 0]} barSize={16}><LabelList dataKey="participacao" position="right" formatter={(valor) => percentual(Number(valor))} fill="#18324a" fontSize={11} /></Bar>
        </BarChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico largo titulo="Média por caixa" descricao="Faturamento dividido pelo número de caixas (turnos) da unidade">
      <div className="medias-caixa">{medias.map((linha) => <article key={linha.nome}><span>{linha.nome}</span><strong>{linha.media === null ? '–' : money(linha.media)}</strong><small>{linha.caixas} {linha.caixas === 1 ? 'caixa' : 'caixas'}</small></article>)}</div>
    </Grafico>
    <Grafico largo titulo="Faturamento médio por dia da semana" descricao="Média dos dias em que a unidade teve caixa finalizado; quanto mais escuro, maior">
      <MapaDeCalor linhas={semana.map((linha) => linha.nome)} colunas={nomesDiasDaSemana} valores={semana.map((linha) => linha.medias)} formatar={moedaCurta} />
    </Grafico>
    <Grafico largo titulo="Formas de pagamento por unidade" descricao="Participação de cada forma no faturamento da unidade">
      <MapaDeCalor linhas={porUnidadeMix.map((linha) => linha.nome)} colunas={Object.values(formasPagamento)} valores={porUnidadeMix.map((linha) => Object.keys(formasPagamento).map((forma) => linha.participacao[forma]))} formatar={percentual} />
    </Grafico>
    <Grafico largo titulo="Evolução das formas de pagamento" descricao="Participação no faturamento de cada semana (a partir de segunda)">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={semanas} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={cores.grade} vertical={false} />
          <XAxis dataKey="semana" tickFormatter={diaCurto} {...eixo} />
          <YAxis tickFormatter={percentual} {...eixo} width={44} />
          <Tooltip {...dica} formatter={(valor) => percentual(Number(valor))} labelFormatter={(inicio) => `Semana de ${formatDay(String(inicio))}`} />
          <Legend iconType="plainline" {...legenda} />
          {grupos.map((grupo) => <Line key={grupo.chave} dataKey={grupo.chave} name={grupo.rotulo} stroke={grupo.cor} strokeWidth={2} dot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico largo titulo="Maquininhas" descricao="Valor registrado em cada maquininha no período">
      {maquininhas.length ? <ResponsiveContainer width="100%" height={Math.max(120, maquininhas.length * 34)}>
        <BarChart data={maquininhas.map((item) => ({ ...item, rotulo: `${nomeCurto(item.unidade)} · ${item.nome} nº ${item.numero}` }))} layout="vertical" margin={{ top: 0, right: 80, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="rotulo" {...eixo} width={larguraNomes * 2} />
          <Tooltip {...dica} formatter={dicaMoeda} cursor={{ fill: '#f4f8f7' }} />
          <Bar dataKey="valor" name="Valor" radius={[0, 4, 4, 0]} barSize={16}>
            {maquininhas.map((item, indice) => <Cell key={indice} fill={corDaUnidade(todasUnidades, item.unidade_id)} />)}
            <LabelList dataKey="valor" position="right" formatter={(valor) => moedaCurta(Number(valor))} fill="#18324a" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer> : <SemDados>Nenhuma maquininha lançada no período.</SemDados>}
    </Grafico>
  </div>;
}
