import { useState } from 'react';
import { request } from './api';
import { Icone } from './icones';
import { limites } from '../../server/src/limites';

type Unit = { id: number; nome: string };
type Maquininha = { id: number; nome: string; numero: string; numero_serie: string; unidade_nome: string };
const vazio = { nome: '', numero: '', numero_serie: '' };

/**
 * Modal de cadastro ou edição de maquininha. Com `maquininha` edita nome, número e série (a unidade não muda);
 * sem ela cadastra na `unidadeId` ou, sem esta, mostra o seletor de unidade.
 * Renderize fora de outros <form> (ele é um <form>).
 */
export default function MaquininhaForm({ unidadeId, units = [], maquininha, onSaved, onClose }: { unidadeId?: number; units?: Unit[]; maquininha?: Maquininha; onSaved: () => void; onClose: () => void }) {
  const [unidade, setUnidade] = useState('');
  const [form, setForm] = useState(maquininha ? { nome: maquininha.nome, numero: maquininha.numero, numero_serie: maquininha.numero_serie } : vazio);
  const [erro, setErro] = useState('');
  const escolheUnidade = !maquininha && unidadeId === undefined;
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    const [caminho, metodo] = maquininha ? [`/maquininhas/${maquininha.id}`, 'PATCH'] : [`/unidades/${unidadeId ?? Number(unidade)}/maquininhas`, 'POST'];
    try { await request(caminho, { method: metodo, body: JSON.stringify(form) }); onSaved(); } catch (err) { setErro((err as Error).message); }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={salvar}>
    <div className="modal-head"><div><span className="eyebrow">CADASTRO</span><h2>{maquininha ? 'Editar maquininha' : 'Nova maquininha'}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
    {maquininha && <p className="muted">Unidade: <strong>{maquininha.unidade_nome}</strong>. O novo nome, número e série aparecem em todos os caixas desta maquininha, inclusive os antigos; os valores informados nos caixas não mudam.</p>}
    {escolheUnidade && <label>Unidade<select autoFocus value={unidade} onChange={(event) => setUnidade(event.target.value)} required><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}
    <label>Nome<input autoFocus={!escolheUnidade} placeholder="Ex.: SICREDI" maxLength={limites.nomeMaquininha} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required /></label>
    <label>Número<input placeholder="Ex.: 1" maxLength={limites.numeroMaquininha} value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} required /></label>
    <label>Número de série<input placeholder="Ex.: ASD415H7" maxLength={limites.serieMaquininha} value={form.numero_serie} onChange={(event) => setForm({ ...form, numero_serie: event.target.value })} required /></label>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{maquininha ? 'Salvar alterações' : 'Salvar maquininha'}</button></div>
  </form></div>;
}
