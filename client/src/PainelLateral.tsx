import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icone } from './icones';

/** Painel lateral (aside) encostado à direita, por cima da tela com o fundo escuro: <dialog> modal que fecha pelo X, pelo Esc
 * ou clicando no fundo. Usado em Cargos e perfis (Usuários) e nas cédulas do saldo do Cofre. */
export default function PainelLateral({ eyebrow, titulo, onClose, children }: { eyebrow: string; titulo: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  // o StrictMode roda o efeito duas vezes; fechar é sempre desmontar (onClose), sem depender do evento close nativo,
  // que não chega quando o Esc fecha um dialog aberto duas vezes (o mesmo padrão de dialogos.tsx)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  // o clique no fundo escuro chega no próprio dialog; o conteúdo ocupa o dialog inteiro, então clique dentro dele nunca fecha
  return <dialog ref={ref} className="painel-lateral" aria-labelledby={tituloId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="painel-lateral-conteudo">
      <div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2 id={tituloId}>{titulo}</h2></div><button type="button" className="close" aria-label="Fechar" title="Fechar" onClick={onClose}><Icone nome="fechar" /></button></div>
      {children}
    </div>
  </dialog>;
}
