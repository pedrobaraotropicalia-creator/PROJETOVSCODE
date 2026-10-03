import { useState } from 'react';
import { request } from './api';

type Unit = { id: number; nome: string };
const vazio = { nome: '', numero: '', numero_serie: '' };

/**
 * Cadastro de maquininha. Com `unidadeId` cadastra nessa unidade; sem ele mostra o seletor de unidade.
 * Não usa <form> porque também aparece dentro do formulário da etapa Maquininhas do caixa.
 */
export default function MaquininhaForm({ unidadeId, units = [], onSaved, onError }: { unidadeId?: number; units?: Unit[]; onSaved: () => void; onError: (message: string) => void }) {
  const [unidade, setUnidade] = useState('');
  const [form, setForm] = useState(vazio);
  async function salvar() {
    const destino = unidadeId ?? Number(unidade);
    if (!destino) return onError('Selecione a unidade da maquininha.');
    try { await request(`/unidades/${destino}/maquininhas`, { method: 'POST', body: JSON.stringify(form) }); setForm(vazio); onSaved(); } catch (err) { onError((err as Error).message); }
  }
  return <div className="machine-form">
    {unidadeId === undefined && <label>Unidade<select value={unidade} onChange={(event) => setUnidade(event.target.value)}><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}
    <label>Nome<input placeholder="Ex.: SICREDI" value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label>
    <label>Número<input placeholder="Ex.: 1" value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} /></label>
    <label>Número de série<input placeholder="Ex.: ASD415H7" value={form.numero_serie} onChange={(event) => setForm({ ...form, numero_serie: event.target.value })} /></label>
    <button type="button" className="primary" onClick={salvar}>Salvar maquininha</button>
  </div>;
}
