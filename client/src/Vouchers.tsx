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
import { VALIDADE_VOUCHER_DIAS } from '../../server/src/voucher';

type Unit = { id: number; nome: string };
type Situacao = 'disponivel' | 'vencido' | 'cancelado';
type Voucher = { id: number; codigo: string; unidade_id: number; unidade_nome: string; valor: number; email: string; nome: string; origem: string | null; data_emissao: string; validade: string; observacoes: string | null; usuario_nome: string; criado_em: string; ativo: number; situacao: Situacao; cancelado_por_nome: string | null; cancelado_em: string | null; motivo_cancelamento: string | null };

const situacoes: Record<Situacao, string> = { disponivel: 'Disponível', vencido: 'Vencido', cancelado: 'Cancelado' };
// abre (e volta ao limpar) nos emitidos no mês corrente
const filtroPadrao = () => { const mes = mesAtual(); return { de: formatDay(mes.de), ate: formatDay(mes.ate), unidades: [] as number[], situacao: '', busca: '' }; };
const somarDias = (dia: string, dias: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
// a busca não diferencia maiúsculas nem acentos
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const passaNaBusca = (voucher: Voucher, busca: string) => { const termo = normalizar(busca.trim()); return !termo || [voucher.codigo, voucher.email, voucher.nome, voucher.origem].some((campo) => campo && normalizar(campo).includes(termo)); };
const quantos = (quantidade: number) => `${quantidade} ${quantidade === 1 ? 'voucher' : 'vouchers'}`;
// jsPDF só é baixado quando alguém exporta
async function baixarPdf(id: number) { try { await (await import('./pdfVoucher')).exportarPdfVoucher(await request(`/vouchers/${id}`)); } catch (err) { toast.error((err as Error).message); } }

/** Vales consumo das unidades: cadastro, PDF e cancelamento (admin e dono das unidades vinculadas; só o dono reativa). */
export default function Vouchers({ units, isOwner, recarga }: { units: Unit[]; isOwner: boolean; recarga: number }) {
  const { confirmar, pedirTexto } = useDialogos();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [filtro, setFiltro] = useState(filtroPadrao);
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState<{ voucher?: Voucher } | null>(null);
  const [carga, setCarga] = useState(0);
  // período e unidades vão para o server; situação e busca filtram aqui. Datas incompletas ficam fora até virarem uma data válida
  const [de, ate] = [parseDate(filtro.de), parseDate(filtro.ate)];
  const consulta = new URLSearchParams({ ...(de ? { de } : {}), ...(ate ? { ate } : {}), ...(filtro.unidades.length ? { unidades: filtro.unidades.join(',') } : {}) }).toString();
  useEffect(() => {
    let atual = true;
    request(`/vouchers?${consulta}`).then((lista) => { if (atual) setVouchers(lista); }).catch((err) => toast.error((err as Error).message));
    return () => { atual = false; };
  }, [consulta, recarga, carga]);
  useEffect(() => setPagina(1), [filtro]);
  const recarregar = () => setCarga((valor) => valor + 1);
  // os indicadores contam todas as situações do período e da busca; a situação escolhida filtra só a lista
  const buscados = vouchers.filter((voucher) => passaNaBusca(voucher, filtro.busca));
  const filtrados = buscados.filter((voucher) => !filtro.situacao || voucher.situacao === filtro.situacao);
  const paginaAtual = paginaValida(pagina, filtrados.length);
  const soma = (itens: Voucher[]) => itens.reduce((total, voucher) => total + voucher.valor, 0);
  const daSituacao = (situacao: Situacao) => buscados.filter((voucher) => voucher.situacao === situacao);
  const [disponiveis, vencidos, cancelados] = [daSituacao('disponivel'), daSituacao('vencido'), daSituacao('cancelado')];
  const origens = [...new Set(vouchers.map((voucher) => voucher.origem).filter((origem): origem is string => !!origem))].sort((a, b) => a.localeCompare(b));

  async function cancelar(voucher: Voucher) {
    const motivo = await pedirTexto({ titulo: 'Cancelar voucher', mensagem: <>O voucher <strong>{voucher.codigo}</strong> de {money(voucher.valor)} ({voucher.unidade_nome}, válido até {formatDay(voucher.validade)}) deixa de valer. {isOwner ? 'Ele pode ser reativado depois, na situação Cancelado.' : 'Só o dono pode reativá-lo depois.'}</>, rotulo: 'Motivo do cancelamento', maxLength: limites.motivoCancelamento, confirmar: 'Cancelar voucher', cancelar: 'Voltar', perigo: true });
    if (motivo === null) return;
    try { await request(`/vouchers/${voucher.id}`, { method: 'DELETE', body: JSON.stringify({ motivo }) }); recarregar(); toast.success(`Voucher ${voucher.codigo} cancelado.`); } catch (err) { toast.error((err as Error).message); }
  }
  async function reativar(voucher: Voucher) {
    if (!await confirmar({ titulo: 'Reativar voucher', mensagem: <>O voucher <strong>{voucher.codigo}</strong> de {money(voucher.valor)} ({voucher.unidade_nome}) volta a valer até {formatDay(voucher.validade)}.</>, confirmar: 'Reativar voucher' })) return;
    try { await request(`/vouchers/${voucher.id}/reativar`, { method: 'POST' }); recarregar(); toast.success(`Voucher ${voucher.codigo} reativado.`); } catch (err) { toast.error((err as Error).message); }
  }
  const naLinha = (acao: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); acao(); };

  return <>
    <section className="stats">
      <article><span>Disponíveis</span><strong>{disponiveis.length}</strong><small>{money(soma(disponiveis))} em vouchers válidos</small></article>
      <article><span>Vencidos sem uso</span><strong className={vencidos.length ? 'orange' : ''}>{vencidos.length}</strong><small>{money(soma(vencidos))}</small></article>
      <article><span>Cancelados</span><strong>{cancelados.length}</strong><small>{money(soma(cancelados))}</small></article>
    </section>
    <section className="panel">
      <div className="panel-heading vouchers-cabecalho"><div><span className="eyebrow">VALES CONSUMO</span><h2>Vouchers emitidos</h2></div><button type="button" className="primary" onClick={() => setModal({})}><Icone nome="adicionar" /> Novo voucher</button></div>
      <div className="filters close-filters report-filters">
        <label className="report-date">Emitidos de<DataInput label="Emitidos a partir de" value={filtro.de} onChange={(valor) => setFiltro({ ...filtro, de: valor })} /></label>
        <label className="report-date">Até<DataInput label="Emitidos até" value={filtro.ate} onChange={(valor) => setFiltro({ ...filtro, ate: valor })} /></label>
        {units.length > 1 && <UnitMultiSelect units={units} value={filtro.unidades} onChange={(unidades) => setFiltro({ ...filtro, unidades })} ariaLabel="Filtrar por unidades" />}
        <select aria-label="Situação" value={filtro.situacao} onChange={(event) => setFiltro({ ...filtro, situacao: event.target.value })}><option value="">Todas as situações</option>{Object.entries(situacoes).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select>
        <input type="search" className="vouchers-busca" aria-label="Buscar voucher" placeholder="Código, e-mail, nome ou origem" value={filtro.busca} onChange={(event) => setFiltro({ ...filtro, busca: event.target.value })} />
        {JSON.stringify(filtro) !== JSON.stringify(filtroPadrao()) && <button type="button" className="ghost" onClick={() => setFiltro(filtroPadrao())}>Limpar filtros</button>}
      </div>
      <div className="filter-summary">{quantos(filtrados.length)} · <strong>{money(soma(filtrados))}</strong></div>
      <div className="table-wrap"><table className="tabela-vouchers tabela-cartoes"><thead><tr><th>Código</th><th>Unidade</th><th>Beneficiário</th><th>Emissão</th><th>Validade</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
        {filtrados.length ? paginar(filtrados, paginaAtual).map((voucher) => <tr key={voucher.id} className={`clickable-row ${voucher.ativo ? '' : 'linha-inativa'}`} title={voucher.ativo ? 'Clique para editar' : 'Clique para ver o voucher cancelado'} onClick={() => setModal({ voucher })}>
          <td className="cartao-titulo"><strong className="voucher-codigo">{voucher.codigo}</strong></td>
          <td className="cartao-meta"><span className="texto-livre">{voucher.unidade_nome}</span></td>
          <td data-rotulo="Beneficiário"><span className="texto-livre">{voucher.nome}</span><small className="voucher-email texto-livre">{voucher.email}</small></td>
          <td className="cartao-campo" data-rotulo="Emissão">{formatDay(voucher.data_emissao)}</td>
          <td className="cartao-campo" data-rotulo="Validade">{formatDay(voucher.validade)}</td>
          <td className="cartao-destaque voucher-valor"><strong>{money(voucher.valor)}</strong></td>
          <td className="cartao-destaque"><span className={`status ${voucher.situacao}`} title={voucher.situacao === 'cancelado' ? `Cancelado por ${voucher.cancelado_por_nome} em ${formatDateTime(voucher.cancelado_em!)}: ${voucher.motivo_cancelamento}` : undefined}>{situacoes[voucher.situacao]}</span></td>
          <td className="cartao-acoes"><div className="row-actions">
            <button type="button" className="ghost" aria-label={`${voucher.ativo ? 'Editar' : 'Ver'} voucher ${voucher.codigo}`} onClick={naLinha(() => setModal({ voucher }))}>{voucher.ativo ? 'Editar' : 'Ver'}</button>
            {voucher.ativo ? <>
              <button type="button" className="row-action" title="Baixar PDF" aria-label={`Baixar PDF do voucher ${voucher.codigo}`} onClick={naLinha(() => baixarPdf(voucher.id))}><Icone nome="baixar" /> PDF</button>
              <button type="button" className="row-action row-action-danger" title="Cancelar voucher" aria-label={`Cancelar voucher ${voucher.codigo}`} onClick={naLinha(() => cancelar(voucher))}><Icone nome="lixeira" /></button>
            </> : isOwner && <button type="button" className="row-action" onClick={naLinha(() => reativar(voucher))}>Reativar</button>}
          </div></td>
        </tr>) : <tr><td colSpan={8} className="empty">Nenhum voucher no filtro.</td></tr>}
      </tbody></table></div>
      <Paginacao total={filtrados.length} pagina={paginaAtual} onChange={setPagina} />
    </section>
    {modal && <VoucherModal voucher={modal.voucher} units={units} origens={origens} onClose={() => setModal(null)} onCriado={recarregar} onSaved={() => { setModal(null); recarregar(); toast.success('Voucher atualizado.'); }} />}
  </>;
}

/** Cadastro (sem `voucher`) e edição de um voucher; o cancelado abre só para leitura. Depois de cadastrar, mostra o código e o PDF. */
function VoucherModal({ voucher, units, origens, onClose, onCriado, onSaved }: { voucher?: Voucher; units: Unit[]; origens: string[]; onClose: () => void; onCriado: () => void; onSaved: () => void }) {
  const somenteLeitura = !!voucher && !voucher.ativo;
  const hoje = diaBrasilia(new Date());
  const [form, setForm] = useState({ unidade: String(voucher?.unidade_id ?? (units.length === 1 ? units[0].id : '')), codigo: voucher?.codigo ?? '', email: voucher?.email ?? '', nome: voucher?.nome ?? '', origem: voucher?.origem ?? '', emissao: formatDay(voucher?.data_emissao ?? hoje), validade: formatDay(voucher?.validade ?? somarDias(hoje, VALIDADE_VOUCHER_DIAS)), observacoes: voucher?.observacoes ?? '' });
  const [valor, setValor] = useState<number | undefined>(voucher?.valor);
  // no cadastro a validade acompanha a emissão até ser mudada à mão
  const [validadeManual, setValidadeManual] = useState(!!voucher);
  const [erro, setErro] = useState('');
  const [criado, setCriado] = useState<Voucher | null>(null);
  // a unidade de um voucher antigo pode ter saído da lista (excluída)
  const opcoes = voucher && !units.some((unit) => unit.id === voucher.unidade_id) ? [...units, { id: voucher.unidade_id, nome: voucher.unidade_nome }] : units;

  function mudarEmissao(emissao: string) {
    const dia = parseDate(emissao);
    setForm((atual) => ({ ...atual, emissao, ...(dia && !validadeManual ? { validade: formatDay(somarDias(dia, VALIDADE_VOUCHER_DIAS)) } : {}) }));
  }
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    const [emissao, validade] = [parseDate(form.emissao), parseDate(form.validade)];
    if (!valor) return setErro('Informe o valor do voucher.');
    if (!emissao) return setErro('Informe a emissão no formato DD/MM/AAAA.');
    if (!validade) return setErro('Informe a validade no formato DD/MM/AAAA.');
    const dados = { unidade_id: Number(form.unidade), codigo: form.codigo.replace(/\s+/g, ''), valor, email: form.email.trim().toLowerCase(), nome: form.nome.trim(), origem: form.origem.trim(), data_emissao: emissao, validade, observacoes: form.observacoes.trim() };
    try {
      if (!voucher) { setCriado(await request('/vouchers', { method: 'POST', body: JSON.stringify(dados) })); onCriado(); return; }
      // na edição vai só o que mudou
      const original: typeof dados = { unidade_id: voucher.unidade_id, codigo: voucher.codigo, valor: voucher.valor, email: voucher.email, nome: voucher.nome, origem: voucher.origem ?? '', data_emissao: voucher.data_emissao, validade: voucher.validade, observacoes: voucher.observacoes ?? '' };
      const mudancas = Object.fromEntries(Object.entries(dados).filter(([campo, novo]) => novo !== original[campo as keyof typeof dados]));
      if (!Object.keys(mudancas).length) return onClose();
      await request(`/vouchers/${voucher.id}`, { method: 'PATCH', body: JSON.stringify(mudancas) }); onSaved();
    } catch (err) { setErro((err as Error).message); }
  }
  const cabecalho = (eyebrow: string, titulo: string) => <div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{titulo}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>;

  if (criado) return <div className="modal-backdrop"><section className="modal">
    {cabecalho('VOUCHER CADASTRADO', `${money(criado.valor)} · ${criado.unidade_nome}`)}
    <p>Vale até <strong>{formatDay(criado.validade)}</strong>. Baixe o PDF para imprimir ou enviar a <strong>{criado.nome}</strong>.</p>
    <div className="codigo-acesso voucher-criado"><strong className="voucher-codigo">{criado.codigo}</strong></div>
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Fechar</button><button type="button" className="primary" onClick={() => baixarPdf(criado.id)}><Icone nome="baixar" /> Baixar PDF</button></div>
  </section></div>;

  return <div className="modal-backdrop"><form className="modal" onSubmit={salvar}>
    {cabecalho(somenteLeitura ? 'VOUCHER CANCELADO' : 'VALE CONSUMO', voucher ? `Voucher ${voucher.codigo}` : 'Novo voucher')}
    {voucher && <p className="muted voucher-autoria">Cadastrado por {voucher.usuario_nome} em {formatDateTime(voucher.criado_em)}.</p>}
    {somenteLeitura && <div className="aviso-cargo"><Icone nome="inativar" /><p>Cancelado por <strong>{voucher.cancelado_por_nome}</strong> em {formatDateTime(voucher.cancelado_em!)}. Motivo: {voucher.motivo_cancelamento}</p></div>}
    <fieldset className="voucher-campos" disabled={somenteLeitura}>
      <div className="form-grid">
        <label>Unidade<select value={form.unidade} onChange={(event) => setForm({ ...form, unidade: event.target.value })} required><option value="">Selecione</option>{opcoes.map((unit) => <option key={unit.id} value={unit.id}>{unit.nome}</option>)}</select></label>
        <label>Valor<MoneyInput value={valor} onChange={setValor} /></label>
      </div>
      <label>Código<input className="voucher-codigo" value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value.toUpperCase() })} maxLength={limites.codigoVoucher} placeholder={voucher ? undefined : 'Gerado ao salvar'} required={!!voucher} autoCapitalize="characters" spellCheck={false} />{!somenteLeitura && <small className="muted">{voucher ? 'Mude só para corrigir um código impresso por outro sistema.' : 'Deixe vazio para gerar um código de 13 dígitos. Preencha para cadastrar um voucher já impresso.'}</small>}</label>
      <div className="form-grid">
        <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={limites.email} required /></label>
        <label>Nome do beneficiário<input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} maxLength={limites.nomeBeneficiario} required /></label>
      </div>
      <label>Origem (opcional)<input list="origens-voucher" value={form.origem} onChange={(event) => setForm({ ...form, origem: event.target.value })} maxLength={limites.origemVoucher} placeholder="Ex.: sala de vendas Royal Prime" /><datalist id="origens-voucher">{origens.map((origem) => <option key={origem} value={origem} />)}</datalist></label>
      <div className="form-grid">
        <label>Emissão<DataInput label="Data de emissão" value={form.emissao} onChange={mudarEmissao} /></label>
        <label>Validade<DataInput label="Validade" value={form.validade} onChange={(validade) => { setValidadeManual(true); setForm({ ...form, validade }); }} /><small className="muted">Último dia em que o voucher vale.</small></label>
      </div>
      <label>Observações gerais (opcional)<textarea rows={3} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} maxLength={limites.observacaoVoucher} /><small className="muted">Uso interno: não saem no PDF.</small></label>
    </fieldset>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer">{somenteLeitura ? <button type="button" className="ghost" onClick={onClose}>Fechar</button> : <><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{voucher ? 'Salvar' : 'Cadastrar voucher'}</button></>}</div>
  </form></div>;
}
