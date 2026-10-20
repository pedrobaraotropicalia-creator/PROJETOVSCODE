import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Nome que se renomeia no lugar: clique (ou Enter/Espaço com foco) vira campo; Enter ou sair do campo salva, Esc cancela.
 * Se `onSalvar` falhar, o erro vira toast e o campo continua aberto.
 */
export default function NomeEditavel({ nome, rotulo, maxLength, onSalvar }: { nome: string; rotulo: string; maxLength: number; onSalvar: (nome: string) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(nome);
  const [salvando, setSalvando] = useState(false);
  const abrir = () => { setTexto(nome); setEditando(true); };
  async function salvar() {
    if (salvando) return;
    const novo = texto.trim();
    if (!novo || novo === nome) { setEditando(false); return; }
    setSalvando(true);
    try { await onSalvar(novo); setEditando(false); } catch (err) { toast.error((err as Error).message); } finally { setSalvando(false); }
  }
  if (!editando) return <button type="button" className="nome-editavel texto-livre" title={`Clique para renomear ${rotulo}`} aria-label={`Renomear ${rotulo} ${nome}`} onClick={(event) => { event.stopPropagation(); abrir(); }}>{nome}</button>;
  return <input className="nome-editavel-campo" autoFocus aria-label={`Novo nome de ${rotulo}`} maxLength={maxLength} value={texto} disabled={salvando}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => setTexto(event.target.value)}
    onBlur={salvar}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); salvar(); } else if (event.key === 'Escape') { event.preventDefault(); setEditando(false); } }} />;
}
