// Cargos da lista fixa e o que cada um representa. O server valida o cargo com esta lista e o client usa a mesma no select
// de Usuários e na tela Cargos e perfis, então este arquivo não pode depender de nada do server (como limites.ts).
// O cargo descreve a função na equipe; quem libera ou bloqueia ações é o perfil. A exceção é o Caixa (cargoRestringe).
export const cargos = [
  { nome: 'Colaborador', descricao: 'Equipe da unidade: atendimento, salão, cozinha ou entrega.' },
  { nome: 'Caixa', descricao: 'Opera o caixa da unidade: abre, preenche e finaliza os fechamentos.' },
  { nome: 'Assistente Financeiro', descricao: 'Apoio às rotinas financeiras: lançamentos, comprovantes e conferências simples.' },
  { nome: 'Analista Financeiro', descricao: 'Analisa os fechamentos, as quebras e as divergências de cartões e acompanha os relatórios.' },
  { nome: 'Supervisor Financeiro', descricao: 'Acompanha a operação de caixa das unidades e orienta a equipe.' },
  { nome: 'Gerente Financeiro', descricao: 'Responde pelo financeiro de uma ou mais unidades.' },
  { nome: 'Diretor Financeiro', descricao: 'Responde pelo financeiro da rede.' }
];

export const nomesCargos = cargos.map((cargo) => cargo.nome);

/** Cargo Caixa (sem diferenciar maiúsculas, para valer também em cargos antigos): fora o dono, só vê os próprios caixas, mesmo com perfil admin. */
export const cargoRestringe = (cargo: string | null | undefined) => String(cargo || '').trim().toLowerCase() === 'caixa';
