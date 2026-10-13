import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { request } from './api';
import DataInput from './DataInput';
import { Icone } from './icones';
import Paginacao, { paginar, paginaValida } from './Paginacao';
import { formatDateTime, formatDay, mesAtual, parseDate } from './datas';

type Alteracao = { campo: string; de: string | null; para: string | null };
type Registro = { id: number; criado_em: string; usuario_id: number; usuario_nome: string; entidade: string; entidade_id: number | null; acao: string; descricao: string; alteracoes: Alteracao[] };
type Filtro = { de: string; ate: string; entidade: string; usuario: string };

const entidades: Record<string, string> = { caixa: 'Caixas', unidade: 'Unidades', usuario: 'Usuários', maquininha: 'Maquininhas', motivo: 'Motivos de saída', cofre: 'Cofre' };
// abre (e volta ao limpar) no mês corrente, o mesmo padrão de Caixas fechados, Cofre e Relatórios
const filtroPadrao = (): Filtro => { const mes = mesAtual(); return { de: formatDay(mes.de), ate: formatDay(mes.ate), entidade: '', usuario: '' }; };
// selo pela natureza da ação: criação em verde, exclusão em vermelho, o resto (alteração, finalização, conferência...) em laranja
// toda linha da tabela tem duas linhas de texto: até duas alterações cabem; com mais, aparece a primeira e o "+N alterações" abre o resto
const visiveis = (alteracoes: Alteracao[]) => alteracoes.length <= 2 ? alteracoes : alteracoes.slice(0, 1);
const textoDaAlteracao = (alteracao: Alteracao) => `${alteracao.campo}: ${alteracao.de ?? '—'} → ${alteracao.para ?? '—'}`;
const seloDaAcao = (acao: string) => /^(Excluiu|Inativou)/.test(acao) ? 'status status-errado' : /^(Criou|Abriu|Cadastrou|Reativou)/.test(acao) ? 'status' : 'status finalizado';

/** Auditoria (dono e admin, que vê só as unidades vinculadas e não vê o cofre): o que foi alterado, quando, por quem e o de/para
 * de cada campo, gravados pelo server (auditoria.ts). */
export default function Auditoria({ recarga, onAbrirCaixa }: { recarga: number; onAbrirCaixa: (id: number) => void }) {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>(filtroPadrao);
  const [pagina, setPagina] = useState(1);
  const [abertas, setAbertas] = useState<Set<number>>(new Set());
  const alternar = (id: number) => setAbertas((atuais) => { const novas = new Set(atuais); if (!novas.delete(id)) novas.add(id); return novas; });
  const de = parseDate(filtro.de); const ate = parseDate(filtro.ate);
  // o período vai para o server, porque a tabela só cresce; registro e pessoa são filtrados aqui
  useEffect(() => {
    if (!de || !ate) return;
    let atual = true; setCarregando(true);
    request(`/auditoria?${new URLSearchParams({ de, ate })}`).then((linhas) => { if (atual) setRegistros(linhas); }).catch((err) => toast.error((err as Error).message)).finally(() => { if (atual) setCarregando(false); });
    return () => { atual = false; };
  }, [de, ate, recarga]);
  useEffect(() => setPagina(1), [filtro]);
  const filtrados = registros.filter((item) => (!filtro.entidade || item.entidade === filtro.entidade) && (!filtro.usuario || item.usuario_id === Number(filtro.usuario)));
  const pessoas = [...new Map(registros.map((item) => [item.usuario_id, item.usuario_nome])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const paginaAtual = paginaValida(pagina, filtrados.length);
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">HISTÓRICO</span><h2>Alterações registradas</h2></div></div>
    <div className="filters close-filters report-filters">
      <label className="report-date">De<DataInput label="Data inicial" value={filtro.de} onChange={(valor) => setFiltro({ ...filtro, de: valor })} /></label>
      <label className="report-date">Até<DataInput label="Data final" value={filtro.ate} onChange={(valor) => setFiltro({ ...filtro, ate: valor })} /></label>
      <select aria-label="Registro" value={filtro.entidade} onChange={(event) => setFiltro({ ...filtro, entidade: event.target.value })}><option value="">Todos os registros</option>{Object.entries(entidades).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select>
      {pessoas.length > 1 && <select aria-label="Quem fez" value={filtro.usuario} onChange={(event) => setFiltro({ ...filtro, usuario: event.target.value })}><option value="">Todas as pessoas</option>{pessoas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select>}
      {JSON.stringify(filtro) !== JSON.stringify(filtroPadrao()) && <button className="ghost" onClick={() => setFiltro(filtroPadrao())}>Limpar filtros</button>}
    </div>
    <div className="filter-summary">{carregando ? 'Carregando…' : `${filtrados.length} ${filtrados.length === 1 ? 'alteração' : 'alterações'}`}</div>
    <div className="table-wrap"><table className="tabela-auditoria">
      <colgroup><col className="col-quando" /><col className="col-quem" /><col className="col-acao" /><col className="col-registro" /><col /></colgroup>
      <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th><th>De → para</th></tr></thead>
      <tbody>
        {paginar(filtrados, paginaAtual).map((item) => <tr key={item.id}>
          <td className="auditoria-quando">{formatDateTime(item.criado_em)}</td>
          <td><span className="auditoria-quem" title={item.usuario_nome}>{item.usuario_nome}</span></td>
          <td><span className={seloDaAcao(item.acao)}>{item.acao}</span></td>
          {/* caixa ainda existente abre a consulta (/caixas-fechados/:id); os demais registros são só texto */}
          <td><div className="auditoria-registro">{item.entidade === 'caixa' && item.entidade_id && item.acao !== 'Excluiu' ? <button type="button" className="link-registro" title={`Abrir a consulta: ${item.descricao}`} onClick={() => onAbrirCaixa(item.entidade_id!)}>{item.descricao}</button> : <strong className="auditoria-descricao" title={item.descricao}>{item.descricao}</strong>}<small className="muted">{entidades[item.entidade] ?? item.entidade}</small></div></td>
          <td>
            <ul className={`de-para ${abertas.has(item.id) ? 'de-para-aberto' : ''}`}>{(abertas.has(item.id) ? item.alteracoes : visiveis(item.alteracoes)).map((alteracao, indice) => <li key={indice} title={textoDaAlteracao(alteracao)}>
              <span className="de-para-campo">{alteracao.campo}:</span>{' '}
              {alteracao.de !== null && <s className="de-para-de">{alteracao.de}</s>}
              {alteracao.de !== null && alteracao.para !== null && <Icone nome="avancar" />}
              {alteracao.para !== null && <strong className="de-para-para">{alteracao.para}</strong>}
            </li>)}</ul>
            {item.alteracoes.length > 2 && <button type="button" className="ghost de-para-mais" aria-expanded={abertas.has(item.id)} onClick={() => alternar(item.id)}>{abertas.has(item.id) ? 'Mostrar menos' : `+${item.alteracoes.length - 1} alterações`}</button>}
          </td>
        </tr>)}
        {!carregando && !filtrados.length && <tr><td colSpan={5} className="empty">Nenhuma alteração no período.</td></tr>}
      </tbody>
    </table></div>
    <Paginacao total={filtrados.length} pagina={paginaAtual} onChange={setPagina} />
  </section>;
}
