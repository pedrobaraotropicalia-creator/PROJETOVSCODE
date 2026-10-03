import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './api';
import { formatDay } from './datas';
import { CENTAVO, corDiferenca } from './quebra';
import { passagemDeTurno, saidasPorUnidade } from './relatorioDados';
import { cores, dica, eixo, Grafico, moedaCurta, percentual, nomeCurto, SemDados, useEixoDeNomes } from './graficos';
import type { DadosRelatorio } from './Relatorios';

export default function RelatorioDinheiro({ caixas, unidades }: DadosRelatorio) {
  const larguraNomes = useEixoDeNomes();
  if (!caixas.length) return <SemDados />;
  const saidas = saidasPorUnidade(caixas, unidades);
  const passagens = passagemDeTurno(caixas);
  const comTroco = [...new Set(passagens.map((passagem) => passagem.unidade))];
  const divergentes = passagens.filter((passagem) => Math.abs(passagem.diferenca) > CENTAVO);
  return <div className="relatorio-grid">
    <Grafico largo titulo="Saídas da gaveta" descricao="Soma das saídas de dinheiro e o percentual que representam das entradas em dinheiro">
      <ResponsiveContainer width="100%" height={Math.max(160, unidades.length * 48)}>
        <BarChart data={saidas} layout="vertical" margin={{ top: 0, right: 120, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nome" tickFormatter={(nome: string) => nomeCurto(nome)} {...eixo} width={larguraNomes} />
          <Tooltip {...dica} cursor={{ fill: '#f4f8f7' }} formatter={(valor, _nome, item) => [`${money(Number(valor))} de ${money(item.payload.entradas)} em dinheiro`, 'Saídas']} />
          <Bar dataKey="saidas" fill={cores.atual} radius={[0, 4, 4, 0]} barSize={18}>
            <LabelList position="right" fill="#18324a" fontSize={11} content={({ x, y, width, height, index }) => { const linha = saidas[Number(index)]; return <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2} dominantBaseline="central" fill="#18324a" fontSize={11}>{money(linha.saidas)}{linha.participacao === null ? '' : ` · ${percentual(linha.participacao)}`}</text>; }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Grafico>
    <Grafico largo titulo="Troco entre turnos" descricao="Saldo inicial de cada caixa menos o dinheiro contado no caixa anterior da mesma unidade. Negativo: o dinheiro diminuiu entre um caixa e outro.">
      {!comTroco.length ? <SemDados>Nenhuma unidade do filtro passa o troco para o caixa seguinte. Ligue a opção em Unidades para acompanhar.</SemDados> : <>
        <div className="medias-caixa">{comTroco.map((unidade) => { const daqui = passagens.filter((passagem) => passagem.unidade === unidade); const total = daqui.reduce((soma, passagem) => soma + passagem.diferenca, 0); return <article key={unidade}><span>{unidade}</span><strong className={corDiferenca(total)}>{money(total)}</strong><small>{daqui.filter((passagem) => Math.abs(passagem.diferenca) > CENTAVO).length} de {daqui.length} passagens com diferença</small></article>; })}</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={passagens.map((passagem) => ({ ...passagem, rotulo: `${passagem.dia}|${passagem.turno}` }))} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={cores.grade} vertical={false} />
            <XAxis dataKey="rotulo" tickFormatter={(rotulo: string) => `${rotulo.slice(8, 10)}/${rotulo.slice(5, 7)}`} {...eixo} minTickGap={16} />
            <YAxis tickFormatter={moedaCurta} {...eixo} width={72} />
            <ReferenceLine y={0} stroke={cores.neutro} />
            <Tooltip {...dica} cursor={{ fill: '#f4f8f7' }} content={({ active, payload }) => active && payload?.length ? <div className="grafico-dica"><strong>{payload[0].payload.unidade}</strong>{formatDay(payload[0].payload.dia)} · {payload[0].payload.turno} · {payload[0].payload.operador}<br />Contado antes: {money(payload[0].payload.anterior)}<br />Saldo inicial: {money(payload[0].payload.saldo_inicial)}<br /><strong>{money(payload[0].payload.diferenca)}</strong></div> : null} />
            <Bar dataKey="diferenca" radius={4} maxBarSize={18}>{passagens.map((passagem) => <Cell key={passagem.id} fill={passagem.diferenca < 0 ? cores.falta : cores.sobra} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
        {divergentes.length > 0 && <div className="table-wrap"><table><thead><tr><th>Dia</th><th>Turno</th><th>Unidade</th><th>Abriu o caixa</th><th>Contado no anterior</th><th>Saldo inicial</th><th>Diferença</th></tr></thead><tbody>{divergentes.map((passagem) => <tr key={passagem.id}><td>{formatDay(passagem.dia)}</td><td>{passagem.turno}</td><td>{passagem.unidade}</td><td>{passagem.operador}</td><td>{money(passagem.anterior)}</td><td>{money(passagem.saldo_inicial)}</td><td><strong className={corDiferenca(passagem.diferenca)}>{money(passagem.diferenca)}</strong></td></tr>)}</tbody></table></div>}
      </>}
    </Grafico>
  </div>;
}
