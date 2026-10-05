import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { money, request } from './api';
import { diaBrasilia, formatDateTime, formatDay, mesAtual, parseDate } from './datas';
import DataInput from './DataInput';
import UnitMultiSelect from './UnitMultiSelect';
import Paginacao, { paginar, paginaValida } from './Paginacao';
import { MoneyInput } from './inputs';
import { useDialogos } from './dialogos';
import { Icone } from './icones';
import { limites } from '../../server/src/limites';

type Unit = { id: number; nome: string };
type Saldo = { unidade_id: number; nome: string; total: number; fundo_gaveta: number };
type Movimentacao = { chave: string; movimentacao_id: number | null; fechamento_id: number | null; unidade_id: number; unidade_nome: string; tipo: string; valor: number; data: string; observacao: string | null; transferencia_id: number | null; contraparte_nome: string | null; turno: string | null; usuario_nome: string; criado_em: string; ativo: number; excluido_por_nome: string | null; excluido_em: string | null };
type Extrato = { movimentacoes: Movimentacao[]; totais: { tipo: string; entradas: number; saidas: number }[] };

const nomesTipo: Record<string, string> = { envio_caixa: 'Envio do caixa', retirada_troco: 'Retirada para troco', transferencia: 'Transferência entre unidades', deposito_banco: 'Depósito no banco', pagamento_fornecedor: 'Pagamento a fornecedor', retirada_dono: 'Retirada do dono', aporte: 'Aporte', ajuste: 'Ajuste de conferência', outros: 'Outros' };
const tiposManuais = ['deposito_banco', 'pagamento_fornecedor', 'retirada_dono', 'aporte', 'ajuste', 'outros'];
// tipos que vão para os dois lados: quem lança diz o sentido e explica na observação
const comSentido = ['ajuste', 'outros'];
// abre (e volta ao limpar) no mês corrente; os saldos não dependem do filtro
const filtroPadrao = () => { const mes = mesAtual(); return { de: formatDay(mes.de), ate: formatDay(mes.ate), unidades: [] as number[], tipo: '', excluidas: false }; };
const cor = (valor: number) => valor < 0 ? 'red' : valor > 0 ? 'green' : '';

const descricao = (mov: Movimentacao) => {
  if (mov.tipo === 'transferencia') return `Transferência ${mov.valor < 0 ? 'para' : 'de'} ${mov.contraparte_nome}`;
  if (mov.fechamento_id) return `${nomesTipo[mov.tipo]} (${mov.turno === 'JANTAR' ? 'jantar' : 'almoço'})`;
  return nomesTipo[mov.tipo];
};

export default function Cofre({ units, recarga, onAbrirCaixa }: { units: Unit[]; recarga: number; onAbrirCaixa: (id: number) => void }) {
  const { confirmar } = useDialogos();
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [extrato, setExtrato] = useState<Extrato>({ movimentacoes: [], totais: [] });
  const [filtro, setFiltro] = useState(filtroPadrao);
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState<'movimentacao' | 'transferencia' | null>(null);
  const [carga, setCarga] = useState(0);
  // datas incompletas ficam fora da consulta até virarem uma data válida
  const [de, ate] = [parseDate(filtro.de), parseDate(filtro.ate)];
  const consulta = new URLSearchParams({ ...(de ? { de } : {}), ...(ate ? { ate } : {}), ...(filtro.unidades.length ? { unidades: filtro.unidades.join(',') } : {}), ...(filtro.tipo ? { tipo: filtro.tipo } : {}), ...(filtro.excluidas ? { excluidas: '1' } : {}) }).toString();
  useEffect(() => {
    let atual = true;
    Promise.all([request('/cofre'), request(`/cofre/movimentacoes?${consulta}`)]).then(([novosSaldos, novoExtrato]) => { if (atual) { setSaldos(novosSaldos); setExtrato(novoExtrato); } }).catch((err) => toast.error((err as Error).message));
    return () => { atual = false; };
  }, [consulta, recarga, carga]);
  useEffect(() => setPagina(1), [consulta]);
  const recarregar = () => setCarga((valor) => valor + 1);
  const paginaAtual = paginaValida(pagina, extrato.movimentacoes.length);

  async function excluir(mov: Movimentacao) {
    if (!await confirmar({ titulo: 'Excluir movimentação', mensagem: <><strong>{descricao(mov)}</strong> de {money(Math.abs(mov.valor))} em {mov.unidade_nome} ({formatDay(mov.data)}) sai do saldo e do extrato{mov.transferencia_id ? <>, nas duas unidades</> : null}. Ela continua visível com o filtro "Mostrar excluídas".</>, confirmar: 'Excluir movimentação', perigo: true })) return;
    try { await request(`/cofre/movimentacoes/${mov.movimentacao_id}`, { method: 'DELETE' }); recarregar(); toast.success('Movimentação excluída.'); } catch (err) { toast.error((err as Error).message); }
  }

  return <>
    <section className="cofre-saldos">{saldos.map((saldo) => <article key={saldo.unidade_id}>
      <span className="texto-livre">{saldo.nome}</span>
      <strong className={saldo.total < 0 ? 'red' : ''}>{money(saldo.total)}</strong>
      <small>No cofre: {money(saldo.total - saldo.fundo_gaveta)} · Na gaveta: {money(saldo.fundo_gaveta)}</small>
      {saldo.total < 0 && <small className="red">Saldo negativo: confira o cofre e lance um ajuste.</small>}
    </article>)}</section>
    <section className="panel">
      <div className="panel-heading cofre-cabecalho"><div><span className="eyebrow">DINHEIRO EM ESPÉCIE</span><h2>Movimentações</h2></div><div className="row-actions"><button type="button" className="ghost" onClick={() => setModal('transferencia')}>Transferir</button><button type="button" className="primary" onClick={() => setModal('movimentacao')}><Icone nome="adicionar" /> Nova movimentação</button></div></div>
      <div className="filters close-filters report-filters">
        <label className="report-date">De<DataInput label="Data inicial" value={filtro.de} onChange={(valor) => setFiltro({ ...filtro, de: valor })} /></label>
        <label className="report-date">Até<DataInput label="Data final" value={filtro.ate} onChange={(valor) => setFiltro({ ...filtro, ate: valor })} /></label>
        <UnitMultiSelect units={units} value={filtro.unidades} onChange={(unidades) => setFiltro({ ...filtro, unidades })} ariaLabel="Filtrar por unidades" />
        <select aria-label="Tipo" value={filtro.tipo} onChange={(event) => setFiltro({ ...filtro, tipo: event.target.value })}><option value="">Todos os tipos</option>{Object.entries(nomesTipo).map(([tipo, nome]) => <option key={tipo} value={tipo}>{nome}</option>)}</select>
        <label className="unit-troco"><input type="checkbox" checked={filtro.excluidas} onChange={(event) => setFiltro({ ...filtro, excluidas: event.target.checked })} />Mostrar excluídas</label>
        {JSON.stringify(filtro) !== JSON.stringify(filtroPadrao()) && <button type="button" className="ghost" onClick={() => setFiltro(filtroPadrao())}>Limpar filtros</button>}
      </div>
      {extrato.totais.length > 0 && <div className="table-wrap cofre-totais"><table><thead><tr><th>Tipo</th><th>Entradas</th><th>Saídas</th></tr></thead><tbody>{Object.keys(nomesTipo).map((tipo) => extrato.totais.find((total) => total.tipo === tipo)).filter((total) => total !== undefined).map((total) => <tr key={total.tipo}><td><strong>{nomesTipo[total.tipo]}</strong></td><td className={cor(total.entradas)}>{total.entradas ? money(total.entradas) : '—'}</td><td className={cor(-total.saidas)}>{total.saidas ? money(total.saidas) : '—'}</td></tr>)}</tbody></table></div>}
      <div className="table-wrap"><table className="cofre-extrato"><thead><tr><th>Data</th><th>Unidade</th><th>Movimentação</th><th>Valor</th><th>Observação</th><th>Lançado por</th><th>Ações</th></tr></thead><tbody>
        {extrato.movimentacoes.length ? paginar(extrato.movimentacoes, paginaAtual).map((mov) => <tr key={mov.chave} className={mov.ativo ? '' : 'cofre-excluida'}>
          <td>{formatDay(mov.data)}</td>
          <td><span className="texto-livre">{mov.unidade_nome}</span></td>
          <td><strong>{descricao(mov)}</strong></td>
          <td className={`close-diff ${cor(mov.valor)}`}>{money(mov.valor)}</td>
          <td><span className="texto-livre">{mov.observacao || '—'}</span></td>
          <td><span className="texto-livre">{mov.usuario_nome}</span><small className="cofre-quando">{formatDateTime(mov.criado_em)}</small>{!mov.ativo && mov.excluido_em && <small className="cofre-quando">Excluída por {mov.excluido_por_nome} em {formatDateTime(mov.excluido_em)}</small>}</td>
          <td>{mov.fechamento_id ? <button type="button" className="row-action" onClick={() => onAbrirCaixa(mov.fechamento_id!)}>Ver caixa</button> : mov.ativo ? <button type="button" className="row-action row-action-danger" title="Excluir movimentação" aria-label={`Excluir ${descricao(mov)} de ${formatDay(mov.data)}`} onClick={() => excluir(mov)}><Icone nome="lixeira" /></button> : null}</td>
        </tr>) : <tr><td colSpan={7} className="empty">Nenhuma movimentação no filtro.</td></tr>}
      </tbody></table></div>
      <Paginacao total={extrato.movimentacoes.length} pagina={paginaAtual} onChange={setPagina} />
    </section>
    {modal && <LancamentoModal modo={modal} units={units} onClose={() => setModal(null)} onSaved={(mensagem) => { setModal(null); recarregar(); toast.success(mensagem); }} />}
  </>;
}

function LancamentoModal({ modo, units, onClose, onSaved }: { modo: 'movimentacao' | 'transferencia'; units: Unit[]; onClose: () => void; onSaved: (mensagem: string) => void }) {
  const transferencia = modo === 'transferencia';
  const [form, setForm] = useState({ unidade: '', destino: '', tipo: '', sentido: '', data: formatDay(diaBrasilia(new Date())), observacao: '' });
  const [valor, setValor] = useState<number | undefined>(undefined);
  const [erro, setErro] = useState('');
  const pedeSentido = comSentido.includes(form.tipo);
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    const data = parseDate(form.data);
    if (!data) return setErro('Informe a data no formato DD/MM/AAAA.');
    const corpo = transferencia
      ? { origem: Number(form.unidade), destino: Number(form.destino), valor: valor ?? 0, data, observacao: form.observacao }
      : { unidade_id: Number(form.unidade), tipo: form.tipo, ...(pedeSentido ? { sentido: form.sentido } : {}), valor: valor ?? 0, data, observacao: form.observacao };
    try { const resposta = await request(transferencia ? '/cofre/transferencias' : '/cofre/movimentacoes', { method: 'POST', body: JSON.stringify(corpo) }); onSaved(resposta.mensagem); } catch (err) { setErro((err as Error).message); }
  }
  const seletorUnidade = (rotulo: string, campo: 'unidade' | 'destino') => <label>{rotulo}<select value={form[campo]} onChange={(event) => setForm({ ...form, [campo]: event.target.value })} required><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>;
  return <div className="modal-backdrop"><form className="modal" onSubmit={salvar}>
    <div className="modal-head"><div><span className="eyebrow">COFRE</span><h2>{transferencia ? 'Transferir entre unidades' : 'Nova movimentação'}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
    {transferencia ? <div className="form-grid">{seletorUnidade('Sai do cofre de', 'unidade')}{seletorUnidade('Entra no cofre de', 'destino')}</div> : <>
      {seletorUnidade('Unidade', 'unidade')}
      <div className="form-grid">
        <label>Tipo<select value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value })} required><option value="">Selecione</option>{tiposManuais.map((tipo) => <option key={tipo} value={tipo}>{nomesTipo[tipo]}</option>)}</select></label>
        {pedeSentido && <label>Sentido<select value={form.sentido} onChange={(event) => setForm({ ...form, sentido: event.target.value })} required><option value="">Selecione</option><option value="entrada">Entra no cofre</option><option value="saida">Sai do cofre</option></select></label>}
      </div>
    </>}
    <div className="form-grid">
      <label>Valor<MoneyInput value={valor} onChange={setValor} /></label>
      <label>Data<DataInput label="Data da movimentação" value={form.data} onChange={(data) => setForm({ ...form, data })} /></label>
    </div>
    <label>Observação{pedeSentido ? '' : ' (opcional)'}<input maxLength={limites.observacaoCofre} value={form.observacao} onChange={(event) => setForm({ ...form, observacao: event.target.value })} required={pedeSentido} placeholder={form.tipo === 'ajuste' ? 'Ex.: saldo inicial, contagem do cofre' : ''} /></label>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{transferencia ? 'Transferir' : 'Lançar movimentação'}</button></div>
  </form></div>;
}
