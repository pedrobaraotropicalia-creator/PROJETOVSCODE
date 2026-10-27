import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { request } from './api';
import { useDialogos } from './dialogos';
import { Icone } from './icones';
import { limites } from '../../server/src/limites';

export type Sentido = 'entrada' | 'saida' | 'ambos';
export type TipoCofre = { id: number; nome: string; sentido: Sentido; exige_observacao: number; ativo: number };
export const nomesSentido: Record<Sentido, string> = { entrada: 'Entrada', saida: 'Saída', ambos: 'Entrada e saída' };
// as cores do extrato: verde entra, vermelho sai
const corSentido: Record<Sentido, string> = { entrada: '', saida: 'status-errado', ambos: 'finalizado' };
const explicacaoSentido: Record<Sentido, string> ={ entrada: 'Sempre põe dinheiro no cofre.', saida: 'Sempre tira dinheiro do cofre.', ambos: 'Quem lança diz se o dinheiro entra ou sai.' };

/** Tipos dos lançamentos da Nova movimentação do cofre: uma lista para a rede, de quem gere o cofre (dono e admin sem cargo Caixa).
 * Transferência, envio do caixa e retirada para troco não estão aqui, porque cada um tem regra própria. */
export default function TiposCofre({ recarga }: { recarga: number }) {
  const { confirmar } = useDialogos();
  const [tipos, setTipos] = useState<TipoCofre[]>([]);
  const [situacao, setSituacao] = useState('ativos');
  const [editando, setEditando] = useState<TipoCofre | 'novo' | null>(null);
  const carregar = () => { request('/cofre/tipos').then(setTipos).catch((err) => toast.error((err as Error).message)); };
  useEffect(carregar, [recarga]);
  async function desativar(tipo: TipoCofre) {
    if (!await confirmar({ titulo: 'Desativar tipo', mensagem: <>O tipo <strong>{tipo.nome}</strong> deixa de aparecer na Nova movimentação do cofre. Os lançamentos que já o usaram continuam no extrato com o nome dele, e o tipo pode ser reativado na situação Inativos.</>, confirmar: 'Desativar tipo', perigo: true })) return;
    try { await request(`/cofre/tipos/${tipo.id}`, { method: 'DELETE' }); carregar(); toast.success('Tipo desativado.'); } catch (err) { toast.error((err as Error).message); }
  }
  async function reativar(tipo: TipoCofre) { try { await request(`/cofre/tipos/${tipo.id}/reativar`, { method: 'POST' }); carregar(); toast.success(`${tipo.nome} voltou para a Nova movimentação.`); } catch (err) { toast.error((err as Error).message); } }
  const filtrados = tipos.filter((tipo) => !situacao || (situacao === 'ativos') === !!tipo.ativo);
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">CADASTROS</span><h2>Tipos de movimentação</h2></div><button type="button" className="primary" onClick={() => setEditando('novo')}><Icone nome="adicionar" /> Novo tipo</button></div>
    <p className="muted">Usados na Nova movimentação do cofre. O novo nome aparece também nos lançamentos antigos; o sentido novo vale só para os próximos.</p>
    <div className="filters"><select aria-label="Situação" value={situacao} onChange={(event) => setSituacao(event.target.value)}><option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="">Ativos e inativos</option></select></div>
    <div className="table-wrap"><table className="tabela-cartoes"><thead><tr><th>Nome</th><th>Sentido</th><th>Observação</th><th></th></tr></thead><tbody>
      {filtrados.length ? filtrados.map((tipo) => <tr key={tipo.id} className={`clickable-row ${tipo.ativo ? '' : 'linha-inativa'}`} title="Clique para editar" onClick={() => setEditando(tipo)}>
        <td className="cartao-titulo"><div className="usuario-nome"><strong className="texto-livre">{tipo.nome}</strong>{!tipo.ativo && <span className="status inativo" title="Fora da Nova movimentação; pode ser reativado">Inativo</span>}</div></td>
        <td className="cartao-destaque"><span className={`status ${corSentido[tipo.sentido]}`} title={explicacaoSentido[tipo.sentido]}>{nomesSentido[tipo.sentido]}</span></td>
        <td className="cartao-campo" data-rotulo="Observação">{tipo.exige_observacao ? 'Obrigatória' : 'Opcional'}</td>
        <td className="cartao-acoes"><div className="row-actions">
          <button type="button" className="ghost" aria-label={`Editar tipo ${tipo.nome}`} onClick={(event) => { event.stopPropagation(); setEditando(tipo); }}>Editar</button>
          {tipo.ativo ? <button type="button" className="row-action row-action-danger" title="Desativar tipo" aria-label={`Desativar tipo ${tipo.nome}`} onClick={(event) => { event.stopPropagation(); desativar(tipo); }}>Desativar</button>
            : <button type="button" className="row-action" title="Reativar tipo" aria-label={`Reativar tipo ${tipo.nome}`} onClick={(event) => { event.stopPropagation(); reativar(tipo); }}>Reativar</button>}
        </div></td>
      </tr>) : <tr><td colSpan={4} className="empty">Nenhum tipo nesta situação.</td></tr>}
    </tbody></table></div>
    {editando && <TipoCofreModal tipo={editando === 'novo' ? undefined : editando} onClose={() => setEditando(null)} onSaved={(mensagem) => { setEditando(null); carregar(); toast.success(mensagem); }} />}
  </section>;
}

/** Cadastro (sem `tipo`) ou edição de um tipo de movimentação do cofre. */
function TipoCofreModal({ tipo, onClose, onSaved }: { tipo?: TipoCofre; onClose: () => void; onSaved: (mensagem: string) => void }) {
  const [form, setForm] = useState({ nome: tipo?.nome ?? '', sentido: (tipo?.sentido ?? '') as Sentido | '', exige_observacao: !!tipo?.exige_observacao });
  const [erro, setErro] = useState('');
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    try { await request(tipo ? `/cofre/tipos/${tipo.id}` : '/cofre/tipos', { method: tipo ? 'PATCH' : 'POST', body: JSON.stringify(form) }); onSaved(tipo ? 'Tipo atualizado.' : 'Tipo cadastrado.'); } catch (err) { setErro((err as Error).message); }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={salvar}>
    <div className="modal-head"><div><span className="eyebrow">COFRE</span><h2>{tipo ? 'Editar tipo de movimentação' : 'Novo tipo de movimentação'}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
    <label>Nome<input autoFocus placeholder="Ex.: Pagamento de boleto" maxLength={limites.nomeTipoCofre} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required /></label>
    <label>Sentido<select value={form.sentido} onChange={(event) => setForm({ ...form, sentido: event.target.value as Sentido })} required><option value="">Selecione</option>{Object.entries(nomesSentido).map(([sentido, nome]) => <option key={sentido} value={sentido}>{nome}</option>)}</select>{form.sentido && <small className="muted">{explicacaoSentido[form.sentido]}</small>}</label>
    {tipo && form.sentido !== tipo.sentido && <p className="muted">Os lançamentos já feitos com este tipo continuam como estão; o sentido novo vale para os próximos.</p>}
    <label className="unit-troco unidade-config-troco"><input type="checkbox" role="switch" checked={form.exige_observacao} onChange={(event) => setForm({ ...form, exige_observacao: event.target.checked })} /><span><strong>{form.exige_observacao ? 'Observação obrigatória' : 'Observação opcional'}</strong><small className="muted">Ligue quando quem lança precisa explicar a movimentação, como num ajuste de conferência.</small></span></label>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{tipo ? 'Salvar alterações' : 'Cadastrar tipo'}</button></div>
  </form></div>;
}
