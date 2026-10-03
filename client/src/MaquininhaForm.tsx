import { useState } from 'react';
import { request } from './api';
import { Icone } from './icones';
import { limites } from '../../server/src/limites';

type Unit = { id: number; nome: string };
const vazio = { nome: '', numero: '', numero_serie: '' };

/**
 * Modal de cadastro de maquininha. Com `unidadeId` cadastra nessa unidade; sem ele mostra o seletor de unidade.
 * Renderize fora de outros <form> (ele é um <form>).
 */
export default function MaquininhaForm({ unidadeId, units = [], onSaved, onClose }: { unidadeId?: number; units?: Unit[]; onSaved: () => void; onClose: () => void }) {
  const [unidade, setUnidade] = useState('');
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState('');
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    try { await request(`/unidades/${unidadeId ?? Number(unidade)}/maquininhas`, { method: 'POST', body: JSON.stringify(form) }); onSaved(); } catch (err) { setErro((err as Error).message); }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={salvar}>
    <div className="modal-head"><div><span className="eyebrow">CADASTRO</span><h2>Nova maquininha</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
    {unidadeId === undefined && <label>Unidade<select autoFocus value={unidade} onChange={(event) => setUnidade(event.target.value)} required><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}
    <label>Nome<input autoFocus={unidadeId !== undefined} placeholder="Ex.: SICREDI" maxLength={limites.nomeMaquininha} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required /></label>
    <label>Número<input placeholder="Ex.: 1" maxLength={limites.numeroMaquininha} value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} required /></label>
    <label>Número de série<input placeholder="Ex.: ASD415H7" maxLength={limites.serieMaquininha} value={form.numero_serie} onChange={(event) => setForm({ ...form, numero_serie: event.target.value })} required /></label>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">Salvar maquininha</button></div>
  </form></div>;
}
