import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Opcoes = { titulo: string; mensagem: ReactNode; confirmar?: string; cancelar?: string; perigo?: boolean };
type OpcoesTexto = Opcoes & { rotulo: string; valor?: string; maxLength?: number };
type Pedido =
  | { tipo: 'confirmar'; opcoes: Opcoes; responder: (confirmado: boolean) => void }
  | { tipo: 'aviso'; opcoes: Opcoes; responder: () => void }
  | { tipo: 'texto'; opcoes: OpcoesTexto; responder: (valor: string | null) => void };

type Dialogos = {
  /** true se confirmar; Cancelar, Esc ou clique fora resolvem false. */
  confirmar: (opcoes: Opcoes) => Promise<boolean>;
  avisar: (opcoes: Opcoes) => Promise<void>;
  /** Texto digitado sem espaços nas pontas, ou null se cancelar. */
  pedirTexto: (opcoes: OpcoesTexto) => Promise<string | null>;
};

const Contexto = createContext<Dialogos | null>(null);

export function useDialogos() {
  const dialogos = useContext(Contexto);
  if (!dialogos) throw new Error('useDialogos precisa estar dentro de DialogosProvider.');
  return dialogos;
}

/** Substitui confirm/alert/prompt do navegador por modais no padrão do app. */
export function DialogosProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<(Pedido & { id: number }) | null>(null);
  const dialogos = useMemo<Dialogos>(() => {
    let proximoId = 0;
    const abrir = (novo: Pedido) => setPedido({ ...novo, id: ++proximoId });
    return {
      confirmar: (opcoes) => new Promise((responder) => abrir({ tipo: 'confirmar', opcoes, responder })),
      avisar: (opcoes) => new Promise((responder) => abrir({ tipo: 'aviso', opcoes, responder })),
      pedirTexto: (opcoes) => new Promise((responder) => abrir({ tipo: 'texto', opcoes, responder }))
    };
  }, []);
  return <Contexto.Provider value={dialogos}>{children}{pedido && <Dialogo key={pedido.id} pedido={pedido} fechar={() => setPedido(null)} />}</Contexto.Provider>;
}

function Dialogo({ pedido, fechar }: { pedido: Pedido; fechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [texto, setTexto] = useState(pedido.tipo === 'texto' ? pedido.opcoes.valor ?? '' : '');
  useEffect(() => { ref.current?.showModal(); }, []);
  function responder(confirmado: boolean) {
    fechar();
    if (pedido.tipo === 'confirmar') pedido.responder(confirmado);
    else if (pedido.tipo === 'aviso') pedido.responder();
    else pedido.responder(confirmado ? texto.trim() : null);
  }
  const { titulo, mensagem, confirmar, cancelar = 'Cancelar', perigo } = pedido.opcoes;
  const rotuloConfirmar = confirmar ?? (pedido.tipo === 'aviso' ? 'Entendi' : 'Confirmar');
  // em ação destrutiva o foco começa em Cancelar, para Enter não excluir por engano
  return <dialog ref={ref} className="modal dialogo" aria-labelledby="dialogo-titulo" onCancel={(event) => { event.preventDefault(); responder(false); }} onClick={(event) => { if (event.target === event.currentTarget) responder(false); }}>
    <form onSubmit={(event) => { event.preventDefault(); responder(true); }}>
      <h2 id="dialogo-titulo">{titulo}</h2>
      <div className="dialogo-mensagem">{mensagem}</div>
      {pedido.tipo === 'texto' && <label>{pedido.opcoes.rotulo}<input autoFocus required maxLength={pedido.opcoes.maxLength} value={texto} onChange={(event) => setTexto(event.target.value)} /></label>}
      <div className="modal-footer">
        {pedido.tipo !== 'aviso' && <button type="button" className="ghost" autoFocus={perigo} onClick={() => responder(false)}>{cancelar}</button>}
        <button type="submit" className={perigo ? 'danger' : 'primary'} autoFocus={!perigo && pedido.tipo !== 'texto'}>{rotuloConfirmar}</button>
      </div>
    </form>
  </dialog>;
}
