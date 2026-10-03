import { useState } from 'react';
import { money, request } from './api';
import { useDialogos } from './dialogos';
import { MoneyInput } from './inputs';
import type { Configuracoes as Config } from './quebra';

export default function Configuracoes({ config, onSaved }: { config: Config; onSaved: (config: Config) => void }) {
  const [tolerancia, setTolerancia] = useState<number | undefined>(config.tolerancia_dinheiro);
  const [cego, setCego] = useState(config.fechamento_cego);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { confirmar } = useDialogos();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage(''); setError('');
    // as duas regras valem na leitura, então a mudança alcança também os caixas antigos
    const mudancas = [];
    if ((tolerancia ?? 0) !== config.tolerancia_dinheiro) mudancas.push(<li key="tolerancia">Tolerância de {money(config.tolerancia_dinheiro)} para {money(tolerancia ?? 0)}. Vale para <strong>todos os caixas, inclusive os já finalizados</strong>: a situação (bateu ou não), as diferenças pendentes e o relatório por operador são recalculados.</li>);
    if (cego !== config.fechamento_cego) mudancas.push(cego
      ? <li key="cego">Fechamento cego ligado: funcionários e quem tem cargo Caixa deixam de ver o valor esperado e a diferença, inclusive dos caixas anteriores.</li>
      : <li key="cego">Fechamento cego desligado: funcionários e quem tem cargo Caixa passam a ver o valor esperado e a diferença de todos os caixas deles, inclusive os anteriores.</li>);
    if (!mudancas.length) { setMessage('Nenhuma alteração para salvar.'); return; }
    if (!await confirmar({ titulo: 'Salvar regras de fechamento', mensagem: <ul className="dialogo-alertas">{mudancas}</ul>, confirmar: 'Salvar' })) return;
    try { onSaved(await request('/configuracoes', { method: 'PUT', body: JSON.stringify({ tolerancia_dinheiro: tolerancia ?? 0, fechamento_cego: cego }) })); setMessage('Configurações salvas.'); } catch (err) { setError((err as Error).message); }
  }
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><span className="eyebrow">CONFERÊNCIA</span><h2>Regras de fechamento</h2></div></div>
    <form onSubmit={submit}>
      <label>Tolerância de quebra de dinheiro por caixa<MoneyInput value={tolerancia} onChange={setTolerancia} /><small className="muted">Diferenças de dinheiro até esse valor (para mais ou para menos) contam como "bateu" e não ficam pendentes. Cartões e Pix continuam exigindo valor exato.</small></label>
      <label className="toggle-row"><input type="checkbox" checked={cego} onChange={(event) => setCego(event.target.checked)} /><span><strong>Fechamento cego</strong><small className="muted">Quem opera o caixa (funcionário e admin com cargo Caixa) não vê o valor esperado nem a diferença; só o dono e os admins conferem.</small></span></label>
      {message && <div className="machine-note">{message}</div>}
      {error && <div className="alert">{error}</div>}
      <div className="step-actions"><span /><button className="primary" type="submit">Salvar configurações</button></div>
    </form>
  </section>;
}
