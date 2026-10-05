import { Icone } from './icones';

export const POR_PAGINA = 20;

/** Página válida para o total atual: a lista pode encolher (filtro, exclusão) com o usuário numa página que deixou de existir. */
export const paginaValida = (pagina: number, total: number) => Math.min(Math.max(pagina, 1), Math.max(Math.ceil(total / POR_PAGINA), 1));

export const paginar = <T,>(itens: T[], pagina: number) => itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

export default function Paginacao({ total, pagina, onChange }: { total: number; pagina: number; onChange: (pagina: number) => void }) {
  const paginas = Math.ceil(total / POR_PAGINA);
  if (paginas <= 1) return null;
  return <nav className="paginacao" aria-label="Paginação">
    <button type="button" className="ghost" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}><Icone nome="voltar" /> Anterior</button>
    <span>Página <strong>{pagina}</strong> de {paginas}</span>
    <button type="button" className="ghost" disabled={pagina >= paginas} onClick={() => onChange(pagina + 1)}>Próxima <Icone nome="avancar" /></button>
  </nav>;
}
