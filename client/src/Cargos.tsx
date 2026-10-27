import { useState } from 'react';
import { Icone } from './icones';
import PainelLateral from './PainelLateral';
import { cargoRestringe, cargos, nomesCargos } from '../../server/src/cargos';

/** Valor do filtro de cargo em Usuários para quem não tem cargo. */
export const SEM_CARGO = 'sem-cargo';
export type FiltroUsuarios = { perfil: string; cargo: string; unidades: number[]; situacao: string };

type Usuario = { tipo: string; cargo: string | null; ativo: number };
type Permissao = boolean | string;
const perfis = [
  { tipo: 'funcionario', nome: 'Colaborador', resumo: 'Opera o caixa nas unidades vinculadas.' },
  { tipo: 'admin', nome: 'Admin', resumo: 'Supervisiona caixas, cofre e vouchers das unidades vinculadas.' },
  { tipo: 'dono', nome: 'Dono', resumo: 'Acesso completo à rede.' }
] as const;
// o que cada perfil pode fazer (texto quando depende de algo) e, em comCargoCaixa, o que muda para o Admin com cargo Caixa;
// precisa acompanhar as regras de acesso do server.ts
const permissoes: { acao: string; funcionario: Permissao; admin: Permissao; dono: Permissao; comCargoCaixa?: string }[] = [
  { acao: 'Abrir e preencher caixas', funcionario: 'Nas unidades vinculadas', admin: 'Nas unidades vinculadas', dono: 'Em todas as unidades' },
  { acao: 'Consultar e editar caixas', funcionario: 'Só os próprios', admin: 'De todos, nas unidades vinculadas', dono: 'Todos', comCargoCaixa: 'Com cargo Caixa, só os próprios' },
  { acao: 'Ver a diferença nas unidades com fechamento cego', funcionario: false, admin: true, dono: true, comCargoCaixa: 'Exceto com cargo Caixa' },
  { acao: 'Abrir caixa com outra data', funcionario: 'Só a data de hoje', admin: true, dono: true, comCargoCaixa: 'Exceto com cargo Caixa' },
  { acao: 'Cadastrar maquininhas e motivos de saída', funcionario: true, admin: true, dono: true },
  { acao: 'Editar e excluir maquininhas e motivos de saída', funcionario: false, admin: true, dono: true },
  { acao: 'Cofre: saldo, extrato, lançamentos e transferências', funcionario: false, admin: 'Nas unidades vinculadas', dono: 'Em todas as unidades', comCargoCaixa: 'Exceto com cargo Caixa' },
  { acao: 'Vouchers: cadastrar, editar, cancelar e emitir o PDF', funcionario: false, admin: 'Nas unidades vinculadas', dono: 'Em todas as unidades' },
  { acao: 'Reativar voucher cancelado', funcionario: false, admin: false, dono: true },
  { acao: 'Ver usuários, cargos e perfis', funcionario: false, admin: 'Só consulta', dono: true },
  { acao: 'Cadastrar, editar e inativar usuários', funcionario: false, admin: false, dono: true },
  { acao: 'Conferir e excluir caixas', funcionario: false, admin: false, dono: true },
  { acao: 'Auditoria (o que foi alterado, por quem e quando)', funcionario: false, admin: 'Das unidades vinculadas', dono: true, comCargoCaixa: 'Com cargo Caixa, sem o cofre e só os próprios caixas' },
  { acao: 'Relatórios e faturamento', funcionario: false, admin: false, dono: true },
  { acao: 'Unidades e regras de fechamento (tolerância e fechamento cego)', funcionario: false, admin: false, dono: true }
];

const celula = (permissao: Permissao) => permissao === true ? <span className="permissao-sim" role="img" aria-label="Sim"><Icone nome="check" /></span> : permissao === false ? <span className="permissao-nao" role="img" aria-label="Não">—</span> : permissao;
// o que o cargo Caixa tira de quem tem perfil Admin (cargoRestringe), na aba Cargos
const restricoesCargoCaixa = 'Mesmo com perfil Admin: vê e edita só os próprios caixas, não vê a diferença no fechamento cego, só abre caixa com a data de hoje e não acessa o cofre.';
const quantos = (total: number) => `${total} ${total === 1 ? 'usuário' : 'usuários'}`;

/** Informativo lateral da tela Usuários: o que cada perfil libera e os cargos da lista, com quantos usuários ativos têm cada um.
 * Clicar numa contagem filtra a lista de usuários por aquele perfil ou cargo. */
export default function CargosEPerfis({ usuarios, onFiltrar, onClose }: { usuarios: Usuario[]; onFiltrar: (filtro: Partial<FiltroUsuarios>) => void; onClose: () => void }) {
  const [aba, setAba] = useState<'perfis' | 'cargos'>('perfis');
  const ativos = usuarios.filter((usuario) => usuario.ativo);
  // cargos antigos fora da lista continuam válidos para quem já os tem, então também aparecem aqui
  const antigos = [...new Set(ativos.map((usuario) => usuario.cargo).filter((cargo): cargo is string => !!cargo && !nomesCargos.includes(cargo)))].sort();
  const linhas = [...cargos.map((cargo) => ({ ...cargo, filtro: cargo.nome, antigo: false })), ...antigos.map((nome) => ({ nome, descricao: 'Cargo antigo, fora da lista atual. Continua valendo para quem já o tem, mas não é oferecido a novos usuários.', filtro: nome, antigo: true })), { nome: 'Sem cargo', descricao: 'Usuário sem cargo definido.', filtro: SEM_CARGO, antigo: false }];
  const contar = (filtro: string) => ativos.filter((usuario) => filtro === SEM_CARGO ? !usuario.cargo : usuario.cargo === filtro).length;
  const verUsuarios = (total: number, filtro: Partial<FiltroUsuarios>, rotulo: string) => total ? <button type="button" className="ghost" title={`Filtrar a lista: ${rotulo}`} onClick={() => onFiltrar(filtro)}>{quantos(total)}</button> : <span className="muted">{quantos(0)}</span>;
  return <PainelLateral eyebrow="INFORMATIVO" titulo="Cargos e perfis" onClose={onClose}>
    <p className="muted">O perfil define o que a pessoa pode fazer no sistema e as unidades vinculadas definem onde. O cargo só descreve a função na equipe, com uma exceção: o Caixa. Clique numa contagem para filtrar a lista.</p>
    <div className="abas" role="tablist"><button type="button" role="tab" aria-selected={aba === 'perfis'} className={aba === 'perfis' ? 'active' : ''} onClick={() => setAba('perfis')}>Perfis de acesso</button><button type="button" role="tab" aria-selected={aba === 'cargos'} className={aba === 'cargos' ? 'active' : ''} onClick={() => setAba('cargos')}>Cargos</button></div>
    {aba === 'perfis' ? <>
      <div className="table-wrap"><table className="permissoes">
        <thead><tr><th>Ação</th>{perfis.map((perfil) => <th key={perfil.tipo}><strong>{perfil.nome}</strong><small>{perfil.resumo}</small>{verUsuarios(ativos.filter((usuario) => usuario.tipo === perfil.tipo).length, { perfil: perfil.tipo }, `perfil ${perfil.nome}`)}</th>)}</tr></thead>
        <tbody>{permissoes.map((linha) => <tr key={linha.acao}><td><strong>{linha.acao}</strong></td>{perfis.map((perfil) => <td key={perfil.tipo}>{celula(linha[perfil.tipo])}{perfil.tipo === 'admin' && linha.comCargoCaixa && <small className="permissao-cargo-caixa">{linha.comCargoCaixa}</small>}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="aviso-cargo"><Icone nome="cargos" /><p><strong>Cargo Caixa:</strong> com esse cargo, até um Admin passa a funcionar como Colaborador nos caixas. Vê e edita só os próprios caixas, não vê a diferença no fechamento cego, só abre caixa com a data de hoje e não acessa o cofre; na auditoria, vê só os caixas que ele mesmo alterou. Os outros cargos não mudam o acesso.</p></div>
    </> : <div className="table-wrap"><table className="tabela-cargos">
      <thead><tr><th>Cargo</th><th>O que representa</th><th>Ativos</th></tr></thead>
      <tbody>{linhas.map((linha) => <tr key={linha.filtro}><td><div className="usuario-nome"><strong className="texto-livre">{linha.nome}</strong>{linha.antigo && <span className="status inativo">Fora da lista</span>}{cargoRestringe(linha.filtro) && <span className="status aguardando" title="Fora o dono, só vê os próprios caixas e não acessa o cofre, mesmo com perfil Admin">Restringe o acesso</span>}</div></td><td>{linha.descricao}{cargoRestringe(linha.filtro) && <small className="permissao-cargo-caixa">{restricoesCargoCaixa}</small>}</td><td>{verUsuarios(contar(linha.filtro), { cargo: linha.filtro }, `cargo ${linha.nome}`)}</td></tr>)}</tbody>
    </table></div>}
  </PainelLateral>;
}
