import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '/api';
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Unit = { id: number; nome: string };
type Point = { dia: string; unidade_id: number; unidade_nome: string; total: number };

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || 'Não foi possível carregar o dashboard.');
  return data;
}

export default function RevenueDashboard() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ total: number; series: Point[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/unidades').then(setUnits).catch((err) => setError(err.message)); }, []);
  async function load() {
    try {
      setError('');
      const params = new URLSearchParams();
      if (from) params.set('de', new Date(from).toISOString().slice(0, 19).replace('T', ' '));
      if (to) params.set('ate', new Date(to).toISOString().slice(0, 19).replace('T', ' '));
      if (selected.length) params.set('unidades', selected.join(','));
      setData(await api(`/dashboard/faturamento?${params.toString()}`));
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { load(); }, [selected]);
  const visibleUnits = selected.length ? units.filter((unit) => selected.includes(unit.id)) : units;
  const unitTotals = visibleUnits.map((unit) => ({ ...unit, total: data?.series.filter((point) => point.unidade_id === unit.id).reduce((sum, point) => sum + point.total, 0) || 0 }));
  const max = Math.max(...(data?.series.map((point) => point.total) || [1]), 1);
  return <section className="panel revenue-dashboard"><div className="panel-heading"><div><span className="eyebrow">ANÁLISE DE FATURAMENTO</span><h2>Dashboard de faturamento</h2></div></div><div className="revenue-filters"><label>De<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Até<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="primary" onClick={load}>Atualizar dashboard</button></div><div className="unit-selector"><div><strong>Unidades para comparar</strong><small>{selected.length ? `${selected.length} selecionada(s)` : 'Todas as unidades'}</small></div><button className="ghost" onClick={() => setSelected([])}>Limpar seleção</button><div className="unit-checks">{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={selected.includes(unit.id)} onChange={() => setSelected((current) => current.includes(unit.id) ? current.filter((id) => id !== unit.id) : [...current, unit.id])} />{unit.nome}</label>)}</div></div>{error && <div className="alert">{error}</div>}<div className="revenue-cards"><article><span>Faturamento total do período</span><strong>{money(data?.total || 0)}</strong></article><article><span>Unidades selecionadas</span><strong>{selected.length || units.length}</strong></article>{unitTotals.slice(0, 3).map((unit) => <article key={unit.id}><span>{unit.nome}</span><strong>{money(unit.total)}</strong></article>)}</div><div className="chart-header"><h3>Faturamento por dia e unidade</h3><span>Valores do sistema em R$</span></div>{data?.series.length ? <div className="revenue-chart">{data.series.map((point, index) => <div className="chart-column" key={`${point.dia}-${point.unidade_id}-${index}`} title={`${point.unidade_nome} - ${point.dia}: ${money(point.total)}`}><div className="chart-bar" style={{ height: `${Math.max((point.total / max) * 100, 4)}%` }} /><small>{point.dia.slice(5)}</small><em>{point.unidade_nome.slice(0, 8)}</em></div>)}</div> : <div className="empty revenue-empty">Selecione um período e clique em “Atualizar dashboard” para carregar o faturamento.</div>}</section>;
}
