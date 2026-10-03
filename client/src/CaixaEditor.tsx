import { useEffect, useState } from 'react';
import { money, request } from './api';
import { MoneyInput, QuantityInput } from './inputs';
import MaquininhaForm from './MaquininhaForm';
import { toast } from 'sonner';
import { useDialogos } from './dialogos';
import { Icone } from './icones';
import { corDiferenca, descreverQuebra, formasPagamento, type Configuracoes } from './quebra';
import { limites } from '../../server/src/limites';

type Unit = { id: number; nome: string };
type Machine = { id: number; nome: string; numero: string; numero_serie: string };
type Contagem = { etapa: 'abertura' | 'fechamento'; denominacao: number; quantidade: number };
type Detalhe = {
  fechamento: { id: number; unidade_id: number; unidade_nome: string; turno: string; saldo_inicial: number; total_entradas: number; total_maquininhas: number; total_saidas: number; dinheiro_fisico: number; diferenca_dinheiro?: number; diferenca_cartoes?: number };
  entradas: { forma_pagamento: string; valor: number }[];
  maquininhas: { maquininha_id: number; valor: number }[];
  saidas: { valor: number; motivo: string }[];
  contagens: Contagem[];
};
type Counts = Record<number, number | undefined>;

const denominacoes = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];
const etapas = ['Abertura', 'Entradas', 'Maquininhas', 'Saídas', 'Contagem final', 'Revisão'];

const countsFrom = (data: { contagens: Contagem[] } | null, etapa: Contagem['etapa']) => Object.fromEntries((data?.contagens || []).filter((item) => item.etapa === etapa).map((item) => [item.denominacao, item.quantidade])) as Counts;
const countsPayload = (counts: Counts) => denominacoes.map((denominacao) => ({ denominacao, quantidade: counts[denominacao] ?? 0 }));
const stepsDone = (data: Detalhe) => [true, data.entradas.length > 0, data.maquininhas.length > 0, data.saidas.length > 0, data.contagens.some((item) => item.etapa === 'fechamento'), false];
// saídas são opcionais: ao retomar um caixa, abre na primeira etapa obrigatória pendente ou na revisão
const firstPendingStep = (data: Detalhe) => { const done = stepsDone(data); return [1, 2, 4].find((index) => !done[index]) ?? 5; };
const countsTotal = (counts: Counts) => denominacoes.reduce((sum, denominacao) => sum + denominacao * (counts[denominacao] ?? 0), 0);

function CountGrid({ variant, kicker, title, description, counts, onChange }: { variant: Contagem['etapa']; kicker: string; title: string; description: string; counts: Counts; onChange: (counts: Counts) => void }) {
  return <div className={`cash-count-box ${variant === 'abertura' ? 'cash-opening' : 'cash-closing'}`}>
    <div className="cash-count-heading"><span className="cash-count-kicker">{kicker}</span><h3>{title}</h3><p>{description}</p></div>
    <div className="cash-count-grid">{denominacoes.map((denominacao) => <label key={denominacao}>{denominacao >= 2 ? 'Nota' : 'Moeda'} de {money(denominacao)}<QuantityInput value={counts[denominacao]} onChange={(value) => onChange({ ...counts, [denominacao]: value })} /></label>)}</div>
    <strong className="cash-count-total">Total: {money(countsTotal(counts))}</strong>
  </div>;
}

function AberturaStep({ data, units, onSubmit }: { data: Detalhe | null; units: Unit[]; onSubmit: (body: object) => void }) {
  const [unit, setUnit] = useState(data ? String(data.fechamento.unidade_id) : '');
  const [turno, setTurno] = useState(data?.fechamento.turno || 'ALMOÇO');
  const [counts, setCounts] = useState(countsFrom(data, 'abertura'));
  const { confirmar } = useDialogos();
  const changesUnit = data && unit !== String(data.fechamento.unidade_id) && data.maquininhas.length > 0;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (changesUnit && !await confirmar({ titulo: 'Trocar a unidade do caixa', mensagem: <>Os valores de {data.maquininhas.length === 1 ? '1 maquininha' : `${data.maquininhas.length} maquininhas`} de <strong>{data.fechamento.unidade_nome}</strong> salvos neste caixa serão descartados, porque cada maquininha pertence a uma unidade. A etapa Maquininhas terá que ser preenchida de novo para <strong>{units.find((item) => String(item.id) === unit)?.nome}</strong>.</>, confirmar: 'Trocar unidade', perigo: true })) return;
    onSubmit({ unidade_id: Number(unit), turno, contagens: countsPayload(counts) });
  }
  return <form onSubmit={submit}>
    <div className="form-grid">
      <label>Unidade<select value={unit} onChange={(event) => setUnit(event.target.value)} required><option value="">Selecione</option>{units.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
      <label>Turno<select value={turno} onChange={(event) => setTurno(event.target.value)}><option value="ALMOÇO">ALMOÇO</option><option value="JANTAR">JANTAR</option></select></label>
    </div>
    {!units.length && <div className="alert">Você ainda não está vinculado a nenhuma unidade. Peça ao dono para vincular você antes de abrir um caixa.</div>}
    {changesUnit && <div className="machine-note">Ao trocar a unidade, os relatórios de maquininhas já salvos neste caixa serão descartados.</div>}
    <CountGrid variant="abertura" kicker="ETAPA 1" title="Dinheiro na abertura" description="Conte o dinheiro disponível antes de iniciar o caixa." counts={counts} onChange={setCounts} />
    <div className="step-actions"><span /><button className="primary" type="submit">{data ? 'Salvar abertura' : 'Abrir caixa'}</button></div>
  </form>;
}

function EntradasStep({ data, onSubmit }: { data: Detalhe; onSubmit: (body: object) => void }) {
  const [values, setValues] = useState<Record<string, number | undefined>>(Object.fromEntries(data.entradas.map((item) => [item.forma_pagamento, item.valor])));
  const total = Object.values(values).reduce((sum: number, value) => sum + (value ?? 0), 0);
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ entradas: Object.fromEntries(Object.keys(formasPagamento).map((forma) => [forma, values[forma] ?? 0])) }); }}>
    <h3>Entradas no sistema</h3>
    <p className="muted">Valores do relatório do sistema por forma de pagamento.</p>
    <div className="money-grid">{Object.entries(formasPagamento).map(([forma, label]) => <label key={forma}>{label}<MoneyInput value={values[forma]} onChange={(value) => setValues({ ...values, [forma]: value })} /></label>)}</div>
    <div className="step-actions"><strong>Total: {money(total)}</strong><button className="primary" type="submit">Salvar e continuar</button></div>
  </form>;
}

function MaquininhasStep({ data, onSubmit }: { data: Detalhe; onSubmit: (body: object) => void }) {
  const unit = data.fechamento.unidade_id;
  const [machines, setMachines] = useState<Machine[]>([]);
  const [values, setValues] = useState<Record<number, number | undefined>>(Object.fromEntries(data.maquininhas.map((item) => [item.maquininha_id, item.valor])));
  const [showForm, setShowForm] = useState(false);
  const [erro, setErro] = useState('');
  const load = () => request(`/unidades/${unit}/maquininhas`).then(setMachines).catch((err) => setErro(err.message));
  useEffect(() => { load(); }, [unit]);
  async function onMachineSaved() { setShowForm(false); await load(); toast.success('Maquininha adicionada a esta unidade.'); }
  const total = machines.reduce((sum, machine) => sum + (values[machine.id] ?? 0), 0);
  return <><form onSubmit={(event) => { event.preventDefault(); onSubmit({ maquininhas: machines.map((machine) => ({ maquininha_id: machine.id, valor: values[machine.id] ?? 0 })) }); }}>
    <div className="section-heading"><h3>Relatórios das maquininhas</h3><button type="button" className="ghost" onClick={() => setShowForm(true)}><Icone nome="adicionar" /> Adicionar nova maquininha</button></div>
    {erro && <div className="alert">{erro}</div>}
    {!machines.length && <p className="muted">Nenhuma maquininha cadastrada em {data.fechamento.unidade_nome}.</p>}
    {machines.map((machine) => <label className="machine-row" key={machine.id}><span><strong>{machine.nome}</strong> · nº {machine.numero} · série {machine.numero_serie}</span><MoneyInput value={values[machine.id]} onChange={(value) => setValues({ ...values, [machine.id]: value })} /></label>)}
    <div className="step-actions"><strong>Total: {money(total)}</strong><button className="primary" type="submit">Salvar e continuar</button></div>
  </form>{showForm && <MaquininhaForm unidadeId={unit} onSaved={onMachineSaved} onClose={() => setShowForm(false)} />}</>;
}

function SaidasStep({ data, onSubmit }: { data: Detalhe; onSubmit: (body: object) => void }) {
  const [exits, setExits] = useState<{ valor: number | undefined; motivo: string }[]>(data.saidas.length ? data.saidas : [{ valor: undefined, motivo: '' }]);
  const update = (index: number, change: Partial<(typeof exits)[number]>) => setExits(exits.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  const filled = exits.filter((item) => (item.valor ?? 0) > 0 || item.motivo.trim());
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ saidas: filled.map((item) => ({ valor: item.valor ?? 0, motivo: item.motivo })) }); }}>
    <h3>Saídas de dinheiro</h3>
    <p className="muted">Retiradas do caixa durante o turno. Deixe em branco se não houve saídas.</p>
    {exits.map((exit, index) => <div className="exit-row" key={index}><MoneyInput value={exit.valor} onChange={(valor) => update(index, { valor })} placeholder="Valor" /><input placeholder="Motivo" maxLength={limites.motivoSaida} value={exit.motivo} onChange={(event) => update(index, { motivo: event.target.value })} /></div>)}
    <button type="button" className="ghost" disabled={exits.length >= limites.saidasPorCaixa} onClick={() => setExits([...exits, { valor: undefined, motivo: '' }])}><Icone nome="adicionar" /> Adicionar saída</button>
    <div className="step-actions"><strong>Total: {money(filled.reduce((sum, item) => sum + (item.valor ?? 0), 0))}</strong><button className="primary" type="submit">Salvar e continuar</button></div>
  </form>;
}

function ContagemFinalStep({ data, onSubmit }: { data: Detalhe; onSubmit: (body: object) => void }) {
  const [counts, setCounts] = useState(countsFrom(data, 'fechamento'));
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ contagens: countsPayload(counts) }); }}>
    <CountGrid variant="fechamento" kicker="ETAPA 5" title="Dinheiro no fechamento" description="Conte novamente o dinheiro físico ao final do turno." counts={counts} onChange={setCounts} />
    <div className="step-actions"><span /><button className="primary" type="submit">Salvar e continuar</button></div>
  </form>;
}

function RevisaoStep({ data, config, onFinalize }: { data: Detalhe; config: Configuracoes; onFinalize: () => void }) {
  const close = data.fechamento;
  const warnings = [
    !data.entradas.length && 'As entradas do sistema não foram informadas.',
    !data.maquininhas.length && 'Nenhum relatório de maquininha foi informado.',
    !data.contagens.some((item) => item.etapa === 'fechamento') && 'A contagem final não foi feita: o dinheiro físico será considerado R$ 0,00.'
  ].filter(Boolean) as string[];
  const { confirmar } = useDialogos();
  async function finalizar() {
    const ok = await confirmar({ titulo: 'Finalizar caixa', mensagem: <><p>Depois de finalizado, o caixa vai para a conferência do dono e só pode ser alterado se for reaberto.</p>{warnings.length > 0 && <ul className="dialogo-alertas">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</>, confirmar: warnings.length ? 'Finalizar mesmo assim' : 'Finalizar caixa' });
    if (ok) onFinalize();
  }
  return <div>
    <div className="detail-grid">
      <div><span>Saldo inicial</span><strong>{money(close.saldo_inicial)}</strong></div>
      <div><span>Entradas do sistema</span><strong>{money(close.total_entradas)}</strong></div>
      <div><span>Maquininhas</span><strong>{money(close.total_maquininhas)}</strong></div>
      <div><span>Saídas</span><strong>{money(close.total_saidas)}</strong></div>
      <div><span>Dinheiro físico</span><strong>{money(close.dinheiro_fisico)}</strong></div>
    </div>
    {close.diferenca_dinheiro === undefined
      ? <div className="machine-note">Fechamento cego: a diferença é conferida pelo gestor depois que você finalizar. Confira se as contagens e os valores digitados estão corretos.</div>
      : <>
        <div className="reconcile"><span>Quebra de dinheiro</span><strong className={corDiferenca(close.diferenca_dinheiro)}>{money(close.diferenca_dinheiro)}</strong><small>Dinheiro contado − (saldo inicial + entradas em dinheiro − saídas)</small></div>
        <div className="reconcile"><span>Cartões e Pix</span><strong className={corDiferenca(close.diferenca_cartoes ?? 0)}>{money(close.diferenca_cartoes ?? 0)}</strong><small>Maquininhas − entradas em cartão, Pix e vales</small></div>
        <p className="muted detail-verdict">{descreverQuebra({ status: 'finalizado', ...close }, config)}</p>
      </>}
    {warnings.map((warning) => <div className="alert" key={warning}>{warning}</div>)}
    <div className="step-actions"><span /><button className="primary" type="button" onClick={finalizar}>Finalizar caixa</button></div>
  </div>;
}

type DetalheConsulta = Omit<Detalhe, 'maquininhas' | 'saidas'> & { maquininhas: { id: number; nome: string; numero: string; numero_serie: string; valor: number }[]; saidas: { id: number; valor: number; motivo: string }[] };
export const etapasConsulta = etapas.slice(0, 5);
const nada = () => {};
// na consulta, cédula não contada aparece como 0, não como campo a preencher
const contagemGravada = (data: DetalheConsulta, etapa: Contagem['etapa']) => { const counts = countsFrom(data, etapa); return Object.fromEntries(denominacoes.map((denominacao) => [denominacao, counts[denominacao] ?? 0])) as Counts; };

/** Etapa de um caixa já gravado, só leitura, com o mesmo visual do editor (consulta do fechamento). */
export function EtapaSomenteLeitura({ etapa, data }: { etapa: number; data: DetalheConsulta }) {
  const close = data.fechamento;
  const conteudo = [
    () => <>
      <div className="form-grid"><label>Unidade<input value={close.unidade_nome} readOnly /></label><label>Turno<input value={close.turno} readOnly /></label></div>
      <CountGrid variant="abertura" kicker="ETAPA 1" title="Dinheiro na abertura" description="Dinheiro contado na gaveta ao abrir o caixa." counts={contagemGravada(data, 'abertura')} onChange={nada} />
    </>,
    () => <>
      <h3>Entradas no sistema</h3>
      <p className="muted">Valores do relatório do sistema por forma de pagamento.</p>
      <div className="money-grid">{Object.entries(formasPagamento).map(([forma, label]) => <label key={forma}>{label}<MoneyInput value={data.entradas.find((item) => item.forma_pagamento === forma)?.valor ?? 0} onChange={nada} /></label>)}</div>
      <div className="step-actions"><strong>Total: {money(close.total_entradas)}</strong></div>
    </>,
    () => <>
      <h3>Relatórios das maquininhas</h3>
      {data.maquininhas.length ? data.maquininhas.map((machine) => <label className="machine-row" key={machine.id}><span><strong>{machine.nome}</strong> · nº {machine.numero} · série {machine.numero_serie}</span><MoneyInput value={machine.valor} onChange={nada} /></label>) : <p className="muted">Nenhuma maquininha informada.</p>}
      <div className="step-actions"><strong>Total: {money(close.total_maquininhas)}</strong></div>
    </>,
    () => <>
      <h3>Saídas de dinheiro</h3>
      {data.saidas.length ? data.saidas.map((exit) => <div className="exit-row" key={exit.id}><MoneyInput value={exit.valor} onChange={nada} /><input value={exit.motivo} readOnly /></div>) : <p className="muted">Nenhuma saída registrada.</p>}
      <div className="step-actions"><strong>Total: {money(close.total_saidas)}</strong></div>
    </>,
    () => <CountGrid variant="fechamento" kicker="ETAPA 5" title="Dinheiro no fechamento" description="Dinheiro físico contado ao final do turno." counts={contagemGravada(data, 'fechamento')} onChange={nada} />
  ][etapa];
  return <fieldset className="somente-leitura" disabled>{conteudo()}</fieldset>;
}

export default function CaixaEditor({ id, units, config, onExit, onFinalized }: { id: number | null; units: Unit[]; config: Configuracoes; onExit: () => void; onFinalized: () => void }) {
  const [caixaId, setCaixaId] = useState(id);
  const [data, setData] = useState<Detalhe | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const load = (target: number) => request(`/fechamentos/${target}`).then((result: Detalhe) => { setData(result); return result; });
  useEffect(() => { if (caixaId) load(caixaId).then((result) => { if (caixaId === id) setStep(firstPendingStep(result)); }).catch((err) => setError(err.message)); }, [caixaId]);
  // sem mensagem, quem chamou avisa o resultado (ao finalizar, o toast vem do App)
  async function run(action: () => Promise<void>, message?: string) {
    setError('');
    try { await action(); if (message) toast.success(message); } catch (err) { setError((err as Error).message); }
  }
  const saveStep = (path: string) => (body: object) => run(async () => { await request(`/fechamentos/${caixaId}/${path}`, { method: 'PUT', body: JSON.stringify(body) }); await load(caixaId!); setStep(step + 1); }, 'Etapa salva.');
  const openCaixa = (body: object) => run(async () => { const result = await request('/fechamentos', { method: 'POST', body: JSON.stringify(body) }); setCaixaId(result.id); setStep(1); }, 'Caixa aberto. As próximas etapas podem ser preenchidas agora ou mais tarde.');
  const finalize = () => run(async () => { await request(`/fechamentos/${caixaId}/finalizar`, { method: 'POST' }); onFinalized(); });
  const done = data ? stepsDone(data) : [];
  const ready = !caixaId || data;
  return <section className="panel caixa-editor">
    <div className="panel-heading">
      <div><span className="eyebrow">{data ? `CAIXA #${data.fechamento.id} · ${data.fechamento.turno}` : 'NOVO CAIXA'}</span><h2>{data ? data.fechamento.unidade_nome : 'Abertura de caixa'}</h2></div>
      <button className="ghost" type="button" onClick={onExit}><Icone nome="voltar" /> Voltar</button>
    </div>
    <div className="caixa-steps">{etapas.map((etapa, index) => <button key={etapa} type="button" className={`${index === step ? 'active' : ''} ${done[index] ? 'done' : ''}`} disabled={!caixaId && index > 0} onClick={() => { setStep(index); setError(''); }}>{index + 1}. {etapa}{done[index] && <Icone nome="check" />}</button>)}</div>
    {error && <div className="alert">{error}</div>}
    {!ready && <p className="muted">Carregando caixa...</p>}
    {ready && step === 0 && <AberturaStep key={caixaId ?? 'novo'} data={data} units={units} onSubmit={caixaId ? saveStep('abertura') : openCaixa} />}
    {data && step === 1 && <EntradasStep data={data} onSubmit={saveStep('entradas')} />}
    {data && step === 2 && <MaquininhasStep data={data} onSubmit={saveStep('maquininhas')} />}
    {data && step === 3 && <SaidasStep data={data} onSubmit={saveStep('saidas')} />}
    {data && step === 4 && <ContagemFinalStep data={data} onSubmit={saveStep('contagem-final')} />}
    {data && step === 5 && <RevisaoStep data={data} config={config} onFinalize={finalize} />}
  </section>;
}
