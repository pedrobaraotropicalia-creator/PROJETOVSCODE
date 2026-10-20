import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { request } from './api';
import { useDialogos } from './dialogos';
import { Icone } from './icones';
import NomeEditavel from './NomeEditavel';
import { limites } from '../../server/src/limites';

type Motivo = { id: number; nome: string };

/** Motivos das saídas da gaveta (admin e dono). Quem preenche o caixa também cadastra, direto na etapa Saídas. */
export default function Motivos({ recarga }: { recarga: number }) {
  const { confirmar } = useDialogos();
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [nome, setNome] = useState('');
  const carregar = () => { request('/motivos-saida').then(setMotivos).catch((err) => toast.error((err as Error).message)); };
  useEffect(carregar, [recarga]);
  async function adicionar(event: React.FormEvent) {
    event.preventDefault();
    try { await request('/motivos-saida', { method: 'POST', body: JSON.stringify({ nome }) }); setNome(''); carregar(); toast.success('Motivo adicionado.'); } catch (err) { toast.error((err as Error).message); }
  }
  async function renomear(motivo: Motivo, novo: string) { await request(`/motivos-saida/${motivo.id}`, { method: 'PATCH', body: JSON.stringify({ nome: novo }) }); carregar(); toast.success('Motivo renomeado.'); }
  async function excluir(motivo: Motivo) {
    if (!await confirmar({ titulo: 'Excluir motivo', mensagem: <>O motivo <strong>{motivo.nome}</strong> deixa de aparecer na etapa Saídas. Os caixas que já o usaram continuam mostrando o nome.</>, confirmar: 'Excluir motivo', perigo: true })) return;
    try { await request(`/motivos-saida/${motivo.id}`, { method: 'DELETE' }); carregar(); toast.success('Motivo excluído.'); } catch (err) { toast.error((err as Error).message); }
  }
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">CADASTROS</span><h2>Motivos de saída</h2></div></div>
    <p className="muted">Usados na etapa Saídas do caixa. Clique no nome para renomear: a correção vale também para os caixas antigos.</p>
    <form className="inline-form" onSubmit={adicionar}><input placeholder="Nome do novo motivo" value={nome} onChange={(event) => setNome(event.target.value)} maxLength={limites.nomeMotivo} required /><button className="primary">Adicionar motivo</button></form>
    <div className="unit-list">{motivos.map((motivo) => <div className="unit-item motivo-item" key={motivo.id}>
      <NomeEditavel nome={motivo.nome} rotulo="o motivo" maxLength={limites.nomeMotivo} onSalvar={(novo) => renomear(motivo, novo)} />
      <button className="row-action row-action-danger" type="button" title="Excluir motivo" aria-label={`Excluir motivo ${motivo.nome}`} onClick={() => excluir(motivo)}><Icone nome="lixeira" /></button>
    </div>)}</div>
  </section>;
}
