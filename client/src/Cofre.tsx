import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { money, request } from './api';
import { diaBrasilia, formatDateTime, formatDay, mesAtual, parseDate } from './datas';
import DataInput from './DataInput';
import UnitMultiSelect from './UnitMultiSelect';
import Paginacao, { paginar, paginaValida } from './Paginacao';
import { CountGrid, countsPayload, countsTotal, denominacoes, type Counts } from './CaixaEditor';
import { useDialogos } from './dialogos';
import { Icone } from './icones';
import PainelLateral from './PainelLateral';
import { limites } from '../../server/src/limites';

type Unit = { id: number; nome: string };
type Cedula = { denominacao: number; quantidade: number };
// cedulas: as do total, com sinal (negativa quando saiu mais do que entrou); cedulas_gaveta: as da abertura dos caixas abertos
type Saldo = { unidade_id: number; nome: string; total: number; fundo_gaveta: number; cedulas: Cedula[]; cedulas_gaveta: Cedula[] };
type Movimentacao = { chave: string; movimentacao_id: number | null; fechamento_id: number | null; unidade_id: number; unidade_nome: string; tipo: string; valor: number; data: string; observacao: string | null; transferencia_id: number | null; contraparte_nome: string | null; turno: string | null; usuario_nome: string; criado_em: string; ativo: number; excluido_por_nome: string | null; excluido_em: string | null; cedulas: Cedula[] };
type Extrato = { movimentacoes: Movimentacao[]; totais: { tipo: string; entradas: number; saidas: number }[] };

const nomesTipo: Record<string, string> = { envio_caixa: 'Envio do caixa', retirada_troco: 'Retirada para troco', transferencia: 'Transferência entre unidades', deposito_banco: 'Depósito no banco', pagamento_fornecedor: 'Pagamento a fornecedor', retirada_dono: 'Retirada do dono', aporte: 'Aporte', ajuste: 'Ajuste de conferência', outros: 'Outros' };
const tiposManuais = ['deposito_banco', 'pagamento_fornecedor', 'retirada_dono', 'aporte', 'ajuste', 'outros'];
// tipos que vão para os dois lados: quem lança diz o sentido e explica na observação
const comSentido = ['ajuste', 'outros'];
// tipos que sempre tiram dinheiro do cofre (o aporte sempre põe)
const tiposDeSaida = ['deposito_banco', 'pagamento_fornecedor', 'retirada_dono'];
// abre (e volta ao limpar) no mês corrente; os saldos não dependem do filtro
const filtroPadrao = () => { const mes = mesAtual(); return { de: formatDay(mes.de), ate: formatDay(mes.ate), unidades: [] as number[], tipo: '', excluidas: false }; };
const cor = (valor: number) => valor < 0 ? 'red' : valor > 0 ? 'green' : '';
const centavos = (valor: number) => Math.round(valor * 100) / 100;
const somaCedulas = (cedulas: Cedula[]) => centavos(cedulas.reduce((soma, cedula) => soma + cedula.denominacao * cedula.quantidade, 0));
const quantidade = (valor: number) => valor.toLocaleString('pt-BR');

const descricao = (mov: Movimentacao) => {
  if (mov.tipo === 'transferencia') return `Transferência ${mov.valor < 0 ? 'para' : 'de'} ${mov.contraparte_nome}`;
  if (mov.fechamento_id) return `${nomesTipo[mov.tipo]} (${mov.turno === 'JANTAR' ? 'jantar' : 'almoço'})`;
  return nomesTipo[mov.tipo];
};

// o que está no cofre é o total menos o fundo na gaveta, cédula por cédula
const cedulasNoCofre = (saldo: Saldo) => denominacoes
  .map((denominacao) => ({ denominacao, quantidade: (saldo.cedulas.find((cedula) => cedula.denominacao === denominacao)?.quantidade ?? 0) - (saldo.cedulas_gaveta.find((cedula) => cedula.denominacao === denominacao)?.quantidade ?? 0) }))
  .filter((cedula) => cedula.quantidade !== 0);

function TabelaCedulas({ valor, cedulas }: { valor: number; cedulas: Cedula[] }) {
  // lançamentos anteriores às cédulas entram no valor sem o detalhe
  const semDetalhe = centavos(valor - somaCedulas(cedulas));
  return <table>
    <thead><tr><th>Cédula/moeda</th><th>Qtd.</th><th>Valor</th></tr></thead>
    <tbody>
      {cedulas.map((cedula) => <tr key={cedula.denominacao} className={cedula.quantidade < 0 ? 'red' : ''}><td>{money(cedula.denominacao)}</td><td>{quantidade(cedula.quantidade)}</td><td>{money(cedula.denominacao * cedula.quantidade)}</td></tr>)}
      {semDetalhe !== 0 && <tr className="cofre-sem-detalhe"><td colSpan={2}>Sem detalhe (lançado antes das cédulas)</td><td>{money(semDetalhe)}</td></tr>}
      {!cedulas.length && !semDetalhe && <tr><td colSpan={3}>Nenhuma cédula ou moeda.</td></tr>}
    </tbody>
    <tfoot><tr><th colSpan={2}>Total</th><th>{money(valor)}</th></tr></tfoot>
  </table>;
}

/** Composição do saldo da unidade por cédula e moeda, no painel lateral aberto pelo indicador da unidade: uma aba para o cofre
 * e outra para a gaveta dos caixas abertos, cada uma com o valor dela. */
function ComposicaoSaldo({ saldo }: { saldo: Saldo }) {
  const [aba, setAba] = useState<'cofre' | 'gaveta'>('cofre');
  const noCofre = cedulasNoCofre(saldo);
  const valorCofre = centavos(saldo.total - saldo.fundo_gaveta);
  const botaoAba = (chave: typeof aba, rotulo: string, valor: number) => <button type="button" role="tab" aria-selected={aba === chave} className={aba === chave ? 'active' : ''} onClick={() => setAba(chave)}>{rotulo}<span className={`cofre-aba-valor ${valor < 0 ? 'red' : ''}`}>{money(valor)}</span></button>;
  return <div className="cofre-composicao">
    <div className="abas" role="tablist">{botaoAba('cofre', 'Cofre', valorCofre)}{botaoAba('gaveta', 'Gaveta', saldo.fundo_gaveta)}</div>
    {aba === 'cofre' ? <>
      <p className="muted">Dinheiro guardado no cofre.</p>
      <TabelaCedulas valor={valorCofre} cedulas={noCofre} />
      {noCofre.some((cedula) => cedula.quantidade < 0) && <div className="alert">Quantidade negativa: saiu do cofre mais do que entrou dessa cédula ou moeda, como num troco trocado no banco sem lançamento. Acerte com um ajuste de conferência.</div>}
    </> : <>
      <p className="muted">Troco dos caixas abertos, que volta para o cofre quando eles são finalizados.</p>
      <TabelaCedulas valor={saldo.fundo_gaveta} cedulas={saldo.cedulas_gaveta} />
    </>}
  </div>;
}

function CedulasDaMovimentacao({ mov }: { mov: Movimentacao }) {
  const contagem = mov.tipo === 'envio_caixa' ? ' · contagem do fechamento' : mov.tipo === 'retirada_troco' ? ' · contagem da abertura' : '';
  return <div className="cofre-cedulas">
    <span className="eyebrow">{mov.valor < 0 ? 'Saíram do cofre' : 'Entraram no cofre'}{contagem}</span>
    <ul>{mov.cedulas.map((cedula) => <li key={cedula.denominacao}><span>{quantidade(cedula.quantidade)} × {money(cedula.denominacao)}</span><strong>{money(cedula.quantidade * cedula.denominacao)}</strong></li>)}</ul>
  </div>;
}

/** Cofre de cada unidade: o dono vê todas; o admin, só as vinculadas (units já vem filtrada), e só transfere entre elas. */
export default function Cofre({ units, recarga, onAbrirCaixa }: { units: Unit[]; recarga: number; onAbrirCaixa: (id: number) => void }) {
  const { confirmar } = useDialogos();
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [extrato, setExtrato] = useState<Extrato>({ movimentacoes: [], totais: [] });
  const [filtro, setFiltro] = useState(filtroPadrao);
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState<'movimentacao' | 'transferencia' | null>(null);
  const [carga, setCarga] = useState(0);
  // linhas do extrato com as cédulas abertas, pela chave
  const [abertas, setAbertas] = useState<string[]>([]);
  // unidade com as cédulas do saldo no painel lateral
  const [composicao, setComposicao] = useState<number | null>(null);
  const saldoAberto = saldos.find((saldo) => saldo.unidade_id === composicao);
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
  const alternarCedulas = (chave: string) => setAbertas((atuais) => atuais.includes(chave) ? atuais.filter((item) => item !== chave) : [...atuais, chave]);

  async function excluir(mov: Movimentacao) {
    if (!await confirmar({ titulo: 'Excluir movimentação', mensagem: <><strong>{descricao(mov)}</strong> de {money(Math.abs(mov.valor))} em {mov.unidade_nome} ({formatDay(mov.data)}) sai do saldo e do extrato{mov.transferencia_id ? <>, nas duas unidades</> : null}. Ela continua visível com o filtro "Mostrar excluídas".</>, confirmar: 'Excluir movimentação', perigo: true })) return;
    try { await request(`/cofre/movimentacoes/${mov.movimentacao_id}`, { method: 'DELETE' }); recarregar(); toast.success('Movimentação excluída.'); } catch (err) { toast.error((err as Error).message); }
  }

  return <>
    {/* clicar no indicador abre as cédulas; o botão continua para quem usa teclado */}
    <section className="cofre-saldos">{saldos.map((saldo) => <article key={saldo.unidade_id} className="clickable-row" onClick={() => setComposicao(saldo.unidade_id)}>
      <span className="texto-livre">{saldo.nome}</span>
      <strong className={saldo.total < 0 ? 'red' : ''}>{money(saldo.total)}</strong>
      <small>No cofre: {money(saldo.total - saldo.fundo_gaveta)} · Na gaveta: {money(saldo.fundo_gaveta)}</small>
      {saldo.total < 0 && <small className="red">Saldo negativo: confira o cofre e lance um ajuste.</small>}
      <button type="button" className="cofre-ver-cedulas" aria-label={`Ver as cédulas e moedas de ${saldo.nome}`}>Ver cédulas e moedas</button>
    </article>)}</section>
    {saldoAberto && <PainelLateral eyebrow="CÉDULAS E MOEDAS" titulo={saldoAberto.nome} onClose={() => setComposicao(null)}><ComposicaoSaldo saldo={saldoAberto} /></PainelLateral>}
    <section className="panel">
      <div className="panel-heading cofre-cabecalho"><div><span className="eyebrow">DINHEIRO EM ESPÉCIE</span><h2>Movimentações</h2></div><div className="row-actions">{units.length > 1 && <button type="button" className="ghost" onClick={() => setModal('transferencia')}>Transferir</button>}<button type="button" className="primary" onClick={() => setModal('movimentacao')}><Icone nome="adicionar" /> Nova movimentação</button></div></div>
      <div className="filters close-filters report-filters">
        <label className="report-date">De<DataInput label="Data inicial" value={filtro.de} onChange={(valor) => setFiltro({ ...filtro, de: valor })} /></label>
        <label className="report-date">Até<DataInput label="Data final" value={filtro.ate} onChange={(valor) => setFiltro({ ...filtro, ate: valor })} /></label>
        <UnitMultiSelect units={units} value={filtro.unidades} onChange={(unidades) => setFiltro({ ...filtro, unidades })} ariaLabel="Filtrar por unidades" />
        <select aria-label="Tipo" value={filtro.tipo} onChange={(event) => setFiltro({ ...filtro, tipo: event.target.value })}><option value="">Todos os tipos</option>{Object.entries(nomesTipo).map(([tipo, nome]) => <option key={tipo} value={tipo}>{nome}</option>)}</select>
        <label className="unit-troco"><input type="checkbox" checked={filtro.excluidas} onChange={(event) => setFiltro({ ...filtro, excluidas: event.target.checked })} />Mostrar excluídas</label>
        {JSON.stringify(filtro) !== JSON.stringify(filtroPadrao()) && <button type="button" className="ghost" onClick={() => setFiltro(filtroPadrao())}>Limpar filtros</button>}
      </div>
      {extrato.totais.length > 0 && <div className="table-wrap cofre-totais"><table><thead><tr><th>Tipo</th><th>Entradas</th><th>Saídas</th></tr></thead><tbody>{Object.keys(nomesTipo).map((tipo) => extrato.totais.find((total) => total.tipo === tipo)).filter((total) => total !== undefined).map((total) => <tr key={total.tipo}><td><strong>{nomesTipo[total.tipo]}</strong></td><td className={cor(total.entradas)}>{total.entradas ? money(total.entradas) : '—'}</td><td className={cor(-total.saidas)}>{total.saidas ? money(total.saidas) : '—'}</td></tr>)}</tbody></table></div>}
      <div className="table-wrap"><table className="cofre-extrato tabela-cartoes"><thead><tr><th>Data</th><th>Unidade</th><th>Movimentação</th><th>Valor</th><th>Observação</th><th>Lançado por</th><th>Ações</th></tr></thead><tbody>
        {extrato.movimentacoes.length ? paginar(extrato.movimentacoes, paginaAtual).map((mov) => <Fragment key={mov.chave}>
          <tr className={`${mov.ativo ? '' : 'cofre-excluida'} ${abertas.includes(mov.chave) ? 'cofre-com-cedulas' : ''}`}>
            <td className="cartao-meta">{formatDay(mov.data)}</td>
            <td className="cartao-meta"><span className="texto-livre">{mov.unidade_nome}</span></td>
            <td className="cartao-titulo"><strong>{descricao(mov)}</strong></td>
            <td className={`close-diff cartao-destaque ${cor(mov.valor)}`}>{money(mov.valor)}</td>
            <td data-rotulo="Observação" className={mov.observacao ? '' : 'sem-valor'}><span className="texto-livre">{mov.observacao || '—'}</span></td>
            <td data-rotulo="Lançado por"><span className="texto-livre">{mov.usuario_nome}</span><small className="cofre-quando">{formatDateTime(mov.criado_em)}</small>{!mov.ativo && mov.excluido_em && <small className="cofre-quando">Excluída por {mov.excluido_por_nome} em {formatDateTime(mov.excluido_em)}</small>}</td>
            <td className={`cartao-acoes ${mov.fechamento_id || mov.ativo || mov.cedulas.length ? '' : 'sem-valor'}`}><div className="row-actions">
              {mov.cedulas.length > 0 && <button type="button" className="row-action" aria-expanded={abertas.includes(mov.chave)} title="Cédulas e moedas da movimentação" aria-label={`Cédulas e moedas de ${descricao(mov)} de ${formatDay(mov.data)}`} onClick={() => alternarCedulas(mov.chave)}>Cédulas</button>}
              {mov.fechamento_id ? <button type="button" className="row-action" onClick={() => onAbrirCaixa(mov.fechamento_id!)}>Ver caixa</button> : mov.ativo ? <button type="button" className="row-action row-action-danger" title="Excluir movimentação" aria-label={`Excluir ${descricao(mov)} de ${formatDay(mov.data)}`} onClick={() => excluir(mov)}><Icone nome="lixeira" /></button> : null}
            </div></td>
          </tr>
          {abertas.includes(mov.chave) && <tr className={`cofre-cedulas-linha ${mov.ativo ? '' : 'cofre-excluida'}`}><td colSpan={7}><CedulasDaMovimentacao mov={mov} /></td></tr>}
        </Fragment>) : <tr><td colSpan={7} className="empty">Nenhuma movimentação no filtro.</td></tr>}
      </tbody></table></div>
      <Paginacao total={extrato.movimentacoes.length} pagina={paginaAtual} onChange={setPagina} />
    </section>
    {modal && <LancamentoModal modo={modal} units={units} onClose={() => setModal(null)} onSaved={(mensagem) => { setModal(null); recarregar(); toast.success(mensagem); }} />}
  </>;
}

function LancamentoModal({ modo, units, onClose, onSaved }: { modo: 'movimentacao' | 'transferencia'; units: Unit[]; onClose: () => void; onSaved: (mensagem: string) => void }) {
  const transferencia = modo === 'transferencia';
  const [form, setForm] = useState({ unidade: '', destino: '', tipo: '', sentido: '', data: formatDay(diaBrasilia(new Date())), observacao: '' });
  // o valor é a soma das cédulas e moedas contadas
  const [cedulas, setCedulas] = useState<Counts>({});
  const [erro, setErro] = useState('');
  const pedeSentido = comSentido.includes(form.tipo);
  const sai = !transferencia && (tiposDeSaida.includes(form.tipo) || (pedeSentido && form.sentido === 'saida'));
  const entra = !transferencia && (form.tipo === 'aporte' || (pedeSentido && form.sentido === 'entrada'));
  async function salvar(event: React.FormEvent) {
    event.preventDefault(); setErro('');
    const data = parseDate(form.data);
    if (!data) return setErro('Informe a data no formato DD/MM/AAAA.');
    if (!countsTotal(cedulas)) return setErro('Informe a quantidade das cédulas e moedas.');
    const corpo = transferencia
      ? { origem: Number(form.unidade), destino: Number(form.destino), cedulas: countsPayload(cedulas), data, observacao: form.observacao }
      : { unidade_id: Number(form.unidade), tipo: form.tipo, ...(pedeSentido ? { sentido: form.sentido } : {}), cedulas: countsPayload(cedulas), data, observacao: form.observacao };
    try { const resposta = await request(transferencia ? '/cofre/transferencias' : '/cofre/movimentacoes', { method: 'POST', body: JSON.stringify(corpo) }); onSaved(resposta.mensagem); } catch (err) { setErro((err as Error).message); }
  }
  const seletorUnidade = (rotulo: string, campo: 'unidade' | 'destino') => <label>{rotulo}<select value={form[campo]} onChange={(event) => setForm({ ...form, [campo]: event.target.value })} required><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>;
  return <div className="modal-backdrop"><form className="modal cofre-lancamento" onSubmit={salvar}>
    <div className="modal-head"><div><span className="eyebrow">COFRE</span><h2>{transferencia ? 'Transferir entre unidades' : 'Nova movimentação'}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
    {transferencia ? <div className="form-grid">{seletorUnidade('Sai do cofre de', 'unidade')}{seletorUnidade('Entra no cofre de', 'destino')}</div> : <>
      {seletorUnidade('Unidade', 'unidade')}
      <div className="form-grid">
        <label>Tipo<select value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value })} required><option value="">Selecione</option>{tiposManuais.map((tipo) => <option key={tipo} value={tipo}>{nomesTipo[tipo]}</option>)}</select></label>
        {pedeSentido && <label>Sentido<select value={form.sentido} onChange={(event) => setForm({ ...form, sentido: event.target.value })} required><option value="">Selecione</option><option value="entrada">Entra no cofre</option><option value="saida">Sai do cofre</option></select></label>}
      </div>
    </>}
    {/* cor da contagem do caixa: verde quando o dinheiro entra no cofre, laranja quando sai */}
    <CountGrid variant={sai ? 'fechamento' : 'abertura'} kicker={transferencia ? 'TRANSFERÊNCIA' : sai ? 'SAÍDA' : entra ? 'ENTRADA' : 'VALOR'}
      title={transferencia ? 'Cédulas e moedas transferidas' : sai ? 'Cédulas e moedas que saem do cofre' : entra ? 'Cédulas e moedas que entram no cofre' : 'Cédulas e moedas da movimentação'}
      description={transferencia ? 'Saem do cofre de origem e entram no de destino; o valor da transferência é o total.' : 'Conte cada cédula e moeda; o valor da movimentação é o total.'}
      counts={cedulas} onChange={setCedulas} />
    <div className="form-grid">
      <label>Data<DataInput label="Data da movimentação" value={form.data} onChange={(data) => setForm({ ...form, data })} /></label>
      <label>Observação{pedeSentido ? '' : ' (opcional)'}<input maxLength={limites.observacaoCofre} value={form.observacao} onChange={(event) => setForm({ ...form, observacao: event.target.value })} required={pedeSentido} placeholder={form.tipo === 'ajuste' ? 'Ex.: saldo inicial, contagem do cofre' : ''} /></label>
    </div>
    {erro && <div className="alert">{erro}</div>}
    <div className="modal-footer"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{transferencia ? 'Transferir' : 'Lançar movimentação'}</button></div>
  </form></div>;
}
