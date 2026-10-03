import { useEffect, useState, type ReactNode } from 'react';
import { money } from './api';

/** Uma cor fixa por unidade, pela posição dela na lista completa (o filtro não repinta as outras). Ordem validada para daltonismo. */
const coresUnidades = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#e87ba4'];
export const corDaUnidade = (unidades: { id: number }[], id: number) => coresUnidades[unidades.findIndex((unidade) => unidade.id === id) % coresUnidades.length];
export const cores = { atual: '#18324a', anterior: '#c3ccd0', falta: '#d03b3b', sobra: '#eb6834', neutro: '#8a9aa1', bom: '#0ca30c', alerta: '#fab219', grade: '#e8eef0', texto: '#70838d' };
// azul do mais claro ao mais escuro, para mapas de calor
const rampa = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];

const moedaCompacta = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
export const moedaCurta = (valor: number) => moedaCompacta.format(valor);
export const percentual = (valor: number) => `${Math.round(valor * 100)}%`;
/** Corta nomes longos de unidade nos eixos e legendas; o nome completo fica na dica. */
export const nomeCurto = (nome: string, limite = 24) => nome.length > limite ? `${nome.slice(0, limite - 1)}…` : nome;
/** 'AAAA-MM-DD' → 'DD/MM' */
export const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export const eixo = { tick: { fill: cores.texto, fontSize: 11 }, tickLine: false, axisLine: { stroke: cores.grade } } as const;
export const dica = { contentStyle: { borderRadius: 3, border: '1px solid #e3eaec', boxShadow: '0 8px 24px #0c253b1f', fontSize: 12 }, labelStyle: { color: '#18324a', fontWeight: 700, marginBottom: 4 } } as const;
// o texto da legenda fica na cor do texto; quem identifica a série é a marca colorida ao lado
export const legenda = { itemSorter: null, wrapperStyle: { fontSize: 12 }, formatter: (valor: string) => <span style={{ color: '#18324a' }} title={valor}>{nomeCurto(valor, 32)}</span> };
export const dicaMoeda = (valor: unknown) => money(Number(valor));

/** Largura do eixo de nomes nas barras horizontais: menor no celular para sobrar espaço para as barras. */
export function useEixoDeNomes() {
  const consulta = '(max-width: 800px)';
  const [estreito, setEstreito] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => { const midia = window.matchMedia(consulta); const mudar = () => setEstreito(midia.matches); midia.addEventListener('change', mudar); return () => midia.removeEventListener('change', mudar); }, []);
  return estreito ? 96 : 150;
}

export function Grafico({ titulo, descricao, children, largo }: { titulo: string; descricao?: string; children: ReactNode; largo?: boolean }) {
  return <section className={`grafico ${largo ? 'grafico-largo' : ''}`}><header><h3>{titulo}</h3>{descricao && <p>{descricao}</p>}</header>{children}</section>;
}

/** Legenda de cores para grades feitas em CSS (mapa de calor, calendário). */
export const Legenda = ({ itens }: { itens: { cor: string; rotulo: string }[] }) =>
  <ul className="grafico-legenda">{itens.map((item) => <li key={item.rotulo}><span style={{ background: item.cor }} />{item.rotulo}</li>)}</ul>;

/** Mapa de calor: cada célula é pintada pela proporção em relação ao maior valor da grade. */
export function MapaDeCalor({ linhas, colunas, valores, formatar }: { linhas: string[]; colunas: string[]; valores: (number | null)[][]; formatar: (valor: number) => string }) {
  const maior = Math.max(...valores.flat().map((valor) => valor ?? 0), 0);
  return <div className="mapa-calor-rolagem"><table className="mapa-calor"><thead><tr><th />{colunas.map((coluna) => <th key={coluna}>{coluna}</th>)}</tr></thead><tbody>{linhas.map((linha, i) => <tr key={linha}><th title={linha}>{linha}</th>{valores[i].map((valor, j) => {
    if (valor === null) return <td key={j} className="vazio" title={`${linha} · ${colunas[j]}: sem dados`}>–</td>;
    const passo = maior ? Math.min(rampa.length - 1, Math.floor((valor / maior) * (rampa.length - 1))) : 0;
    return <td key={j} style={{ background: rampa[passo], color: passo >= 7 ? '#fff' : '#18324a' }} title={`${linha} · ${colunas[j]}: ${formatar(valor)}`}>{formatar(valor)}</td>;
  })}</tr>)}</tbody></table></div>;
}

export const SemDados = ({ children = 'Nenhum caixa finalizado neste período.' }: { children?: ReactNode }) => <div className="empty grafico-vazio">{children}</div>;
