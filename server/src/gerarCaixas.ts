// Gera caixas fictícios para validar telas e relatórios: npm run server:gerar-caixas -- [--dias 60] [--semente 42] [--limpar]
// Grava direto no banco do server (DATABASE_FILE) com responsáveis e maquininhas próprios, marcados pelo e-mail @gerador.caixa.test
// e pela série GER-. Cada execução apaga o que foi gerado antes e gera de novo; --limpar só apaga. Os caixas de usuários reais não mudam.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, recalcularDiferencas } from './db';

if (process.env.K_SERVICE) throw new Error('O gerador de caixas não roda no Cloud Run.');
const args = process.argv.slice(2);
const opcao = (nome: string, padrao: number, maximo: number) => {
  const i = args.indexOf(`--${nome}`);
  const valor = i >= 0 ? Number(args[i + 1]) : padrao;
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) throw new Error(`--${nome} deve ser um inteiro de 1 a ${maximo}.`);
  return valor;
};
const dias = opcao('dias', 60, 730);
const soLimpar = args.includes('--limpar');
const dominio = '@gerador.caixa.test';
const prefixoSerie = 'GER-';

// mulberry32: a mesma semente gera os mesmos caixas
let estado = opcao('semente', 42, 2 ** 31 - 1);
const aleatorio = () => { estado = (estado + 0x6d2b79f5) | 0; let t = Math.imul(estado ^ (estado >>> 15), 1 | estado); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (min: number, max: number) => min + Math.floor(aleatorio() * (max - min + 1));
const chance = (probabilidade: number) => aleatorio() < probabilidade;
const sortear = <T>(lista: readonly T[]) => lista[Math.floor(aleatorio() * lista.length)];

// todos os valores em centavos inteiros; o banco recebe reais
const reais = (centavos: number) => centavos / 100;
const cedulas = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];
const decompor = (centavos: number) => cedulas.map((cedula) => { const quantidade = Math.floor(centavos / cedula); centavos -= quantidade * cedula; return { cedula, quantidade }; }).filter((item) => item.quantidade > 0);
const trocoInicial = () => [[2000, entre(2, 5)], [1000, entre(3, 8)], [500, entre(4, 10)], [200, entre(5, 12)], [100, entre(5, 15)], [50, entre(4, 10)], [25, entre(4, 10)], [10, entre(5, 12)], [5, entre(0, 8)]].map(([cedula, quantidade]) => ({ cedula, quantidade }));
const somaContagem = (contagem: { cedula: number; quantidade: number }[]) => contagem.reduce((soma, item) => soma + item.cedula * item.quantidade, 0);
// reparte em centavos pelos pesos (com ruído), o resto do arredondamento vai para o primeiro
const repartir = (total: number, pesos: number[]) => {
  const ajustados = pesos.map((peso) => peso * (0.7 + aleatorio() * 0.6));
  const soma = ajustados.reduce((a, b) => a + b, 0);
  const partes = ajustados.map((peso) => Math.floor(total * peso / soma));
  partes[0] += total - partes.reduce((a, b) => a + b, 0);
  return partes;
};

// movimento por unidade em R$ por turno (antes do fator do dia), maquininhas e fatia em dinheiro; folga = dia da semana fechado (0 = domingo)
type Perfil = { almoco: number; jantar: number; maquininhas: number; dinheiro: number; folga?: number };
const perfis: Record<string, Perfil> = {
  'TERRA E MAR': { almoco: 4200, jantar: 6800, maquininhas: 3, dinheiro: 0.1 },
  'RESTAURANTE E PIZZARIA': { almoco: 2600, jantar: 7400, maquininhas: 3, dinheiro: 0.12 },
  'DELIVERY': { almoco: 1500, jantar: 5200, maquininhas: 2, dinheiro: 0.05 },
  'DOCELATTO': { almoco: 1300, jantar: 2100, maquininhas: 2, dinheiro: 0.15, folga: 1 }
};
const perfilPadrao: Perfil = { almoco: 2500, jantar: 4000, maquininhas: 2, dinheiro: 0.1 };
const movimentoDaSemana = [1.3, 0.75, 0.8, 0.9, 1, 1.25, 1.4];
const formasCartao = [['credito', 38], ['debito', 27], ['pix', 25], ['refeicao', 7], ['alimentacao', 3]] as const;
const bandeiras = ['Stone', 'Cielo', 'Rede', 'PagSeguro'];
// erro = chance de o caixa não bater; a pessoa com mais erros se destaca na aba Por colaborador
const equipe = [
  { nome: 'Ana Souza', cargo: 'Caixa', erro: 0.06 }, { nome: 'Bruno Lima', cargo: 'Colaborador', erro: 0.12 },
  { nome: 'Carla Mendes', cargo: 'Caixa', erro: 0.04 }, { nome: 'Diego Rocha', cargo: 'Caixa', erro: 0.35 },
  { nome: 'Elisa Martins', cargo: 'Colaborador', erro: 0.08 }, { nome: 'Felipe Costa', cargo: 'Caixa', erro: 0.15 },
  { nome: 'Gabriela Alves', cargo: 'Caixa', erro: 0.05 }, { nome: 'Henrique Dias', cargo: 'Colaborador', erro: 0.1 }
];
const supervisor = { nome: 'Marina Teixeira', cargo: 'Supervisor Financeiro', erro: 0.05 };
const observacoes: Record<string, string[]> = {
  'Pagamento a fornecedor': ['Hortifruti', 'Peixaria', 'Distribuidora de bebidas'],
  'Compra de mercadoria': ['Gelo', 'Pão', 'Gás', 'Embalagens'],
  'Entrega (motoboy)': ['Taxas de entrega do turno'],
  'Outros': ['Material de limpeza', 'Conserto da porta', 'Estacionamento']
};

const usuariosGerados = `SELECT id FROM usuarios WHERE email LIKE '%${dominio}'`;
const limpar = db.transaction(() => {
  const caixas = db.prepare(`DELETE FROM fechamentos WHERE usuario_id IN (${usuariosGerados})`).run().changes;
  // o que ainda estiver em uso por caixa ou lançamento de outra pessoa fica só desativado
  db.prepare(`DELETE FROM maquininhas WHERE numero_serie LIKE '${prefixoSerie}%' AND id NOT IN (SELECT maquininha_id FROM detalhes_maquininha)`).run();
  db.prepare(`UPDATE maquininhas SET ativo=0 WHERE numero_serie LIKE '${prefixoSerie}%'`).run();
  db.prepare(`DELETE FROM usuario_unidades WHERE usuario_id IN (${usuariosGerados})`).run();
  db.prepare(`DELETE FROM usuarios WHERE id IN (${usuariosGerados}) AND id NOT IN (SELECT usuario_id FROM fechamentos UNION SELECT conferido_por FROM fechamentos WHERE conferido_por IS NOT NULL UNION SELECT usuario_id FROM cofre_movimentacoes UNION SELECT excluido_por FROM cofre_movimentacoes WHERE excluido_por IS NOT NULL UNION SELECT usuario_id FROM auditoria)`).run();
  db.prepare(`UPDATE usuarios SET ativo=0 WHERE email LIKE '%${dominio}'`).run();
  return caixas;
});

const removidos = limpar();
console.log(`${removidos} caixa(s) gerado(s) antes foram apagados.`);
if (soLimpar) process.exit(0);

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const dono = (db.prepare('SELECT id FROM usuarios WHERE email=? AND ativo=1').get(adminEmail) ?? db.prepare("SELECT id FROM usuarios WHERE tipo='dono' AND ativo=1").get()) as { id: number } | undefined;
if (!dono) throw new Error('Nenhum dono cadastrado. Rode npm run server:seed antes.');
const unidades = db.prepare('SELECT id, nome, troco_continua FROM unidades WHERE ativo=1 ORDER BY id').all() as { id: number; nome: string; troco_continua: number }[];
const motivos = db.prepare('SELECT id, nome FROM motivos_saida WHERE ativo=1').all() as { id: number; nome: string }[];

// senha aleatória que ninguém conhece: para entrar como um deles, o dono troca a senha na tela Usuários
const senhaHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);
const salvarUsuario = db.prepare("INSERT INTO usuarios (nome,email,senha_hash,tipo,cargo) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET nome=excluded.nome, senha_hash=excluded.senha_hash, tipo=excluded.tipo, cargo=excluded.cargo, ativo=1 RETURNING id");
const vincular = db.prepare('INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) VALUES (?,?)');
const salvarMaquininha = db.prepare('INSERT INTO maquininhas (unidade_id,nome,numero,numero_serie) VALUES (?,?,?,?) ON CONFLICT(unidade_id, numero_serie) DO UPDATE SET nome=excluded.nome, numero=excluded.numero, ativo=1 RETURNING id');
const caixaReal = db.prepare('SELECT 1 FROM fechamentos WHERE unidade_id=? AND data_caixa=? AND turno=?');
const inserirCaixa = db.prepare(`INSERT INTO fechamentos (unidade_id,usuario_id,turno,data_caixa,saldo_inicial,dinheiro_fisico,total_entradas,total_maquininhas,total_saidas,status,problema_resolvido,conferido_por,criado_em,atualizado_em,finalizado_em,movimenta_cofre,troco_continua)
  VALUES (@unidade_id,@usuario_id,@turno,@data_caixa,@saldo_inicial,@dinheiro_fisico,@total_entradas,@total_maquininhas,@total_saidas,@status,@problema_resolvido,@conferido_por,@criado_em,@atualizado_em,@finalizado_em,@movimenta_cofre,@troco_continua)`);
const inserirContagem = db.prepare('INSERT INTO contagens_dinheiro (fechamento_id,etapa,denominacao,quantidade,total) VALUES (?,?,?,?,?)');
const inserirEntrada = db.prepare('INSERT INTO entradas (fechamento_id,forma_pagamento,valor) VALUES (?,?,?)');
const inserirMaquininha = db.prepare('INSERT INTO detalhes_maquininha (fechamento_id,maquininha_id,valor) VALUES (?,?,?)');
const inserirSaida = db.prepare("INSERT INTO saidas (fechamento_id,valor,motivo,motivo_id,observacao) VALUES (?,?,'',?,?)");

const email = (nome: string) => `${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.')}${dominio}`;
const agora = Date.now();
const horario = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
// hora de Brasília (UTC-3, sem horário de verão) no dia do caixa, em ms UTC
const emBrasilia = (dia: string, minutos: number) => Date.parse(`${dia}T00:00:00Z`) + (minutos + 180) * 60_000;
const hoje = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);

const gerar = db.transaction(() => {
  const supervisorId = (salvarUsuario.get(supervisor.nome, email(supervisor.nome), senhaHash, 'admin', supervisor.cargo) as { id: number }).id;
  // duas pessoas por unidade; com mais unidades que nomes, a mesma pessoa atende mais de uma
  const operadores = unidades.map((unidade, i) => {
    vincular.run(supervisorId, unidade.id);
    return [equipe[(2 * i) % equipe.length], equipe[(2 * i + 1) % equipe.length]].map((pessoa) => {
      const id = (salvarUsuario.get(pessoa.nome, email(pessoa.nome), senhaHash, 'funcionario', pessoa.cargo) as { id: number }).id;
      vincular.run(id, unidade.id);
      return { id, erro: pessoa.erro };
    });
  });
  const maquininhas = unidades.map((unidade) => Array.from({ length: (perfis[unidade.nome] ?? perfilPadrao).maquininhas }, (_, k) =>
    (salvarMaquininha.get(unidade.id, bandeiras[k % bandeiras.length], String(k + 1), `${prefixoSerie}${unidade.id}-${k + 1}`) as { id: number }).id));

  let gerados = 0;
  for (let n = dias - 1; n >= 0; n--) {
    const dia = new Date(Date.parse(`${hoje}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const diaDaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    unidades.forEach((unidade, u) => {
      const perfil = perfis[unidade.nome] ?? perfilPadrao;
      if (perfil.folga === diaDaSemana || chance(0.02)) return; // folga ou unidade fechada no dia
      for (const turno of ['ALMOÇO', 'JANTAR'] as const) {
        if (caixaReal.get(unidade.id, dia, turno)) continue;
        const almoco = turno === 'ALMOÇO';
        const abertura = emBrasilia(dia, (almoco ? 600 : 1050) + entre(0, 60));
        const fechamento = emBrasilia(dia, (almoco ? 900 : 1380) + entre(0, 90));
        if (abertura > agora) continue;
        const emAndamento = fechamento > agora;
        const responsavel = chance(0.1) ? { id: supervisorId, erro: supervisor.erro } : sortear(operadores[u]);

        const troco = trocoInicial();
        const saldoInicial = somaContagem(troco);
        const total = Math.round((almoco ? perfil.almoco : perfil.jantar) * movimentoDaSemana[diaDaSemana] * (0.8 + aleatorio() * 0.4) * 100);
        const dinheiro = Math.round(total * perfil.dinheiro * (0.6 + aleatorio() * 0.8) / 5) * 5; // dinheiro sempre em múltiplos de 5 centavos
        const cartoes = repartir(total - dinheiro, formasCartao.map(([, peso]) => peso));
        const naMaquininha = repartir(total - dinheiro, maquininhas[u].map(() => 1));
        const saidas = chance(0.3) ? Array.from({ length: chance(0.25) ? 2 : 1 }, () => {
          const motivo = sortear(motivos);
          return { valor: Math.min(entre(30, 360) * 50, Math.floor((saldoInicial + dinheiro) * 0.3 / 5) * 5), motivo_id: motivo.id, observacao: observacoes[motivo.nome] && chance(0.7) ? sortear(observacoes[motivo.nome]) : null };
        }).filter((saida) => saida.valor > 0) : [];
        const totalSaidas = saidas.reduce((soma, saida) => soma + saida.valor, 0);

        // quebra de dinheiro e divergência de cartões conforme a chance de erro de quem fechou
        const sorteio = aleatorio();
        const quebra = sorteio < responsavel.erro * 0.5 ? -entre(1, 100) * 5 : sorteio < responsavel.erro * 0.75 ? entre(1, 60) * 5 : sorteio < responsavel.erro ? -entre(200, 1600) * 5 : 0;
        if (chance(responsavel.erro * 0.4)) { const maior = naMaquininha.indexOf(Math.max(...naMaquininha)); naMaquininha[maior] = Math.max(0, naMaquininha[maior] + (chance(0.5) ? 1 : -1) * (chance(0.5) ? entre(1, 99) : entre(1, 50) * 100)); }
        const contado = Math.max(0, saldoInicial + dinheiro - totalSaidas + quebra);

        // em andamento: abertura sempre, as outras etapas conforme o caixa avançou; sem contagem final
        const temEntradas = !emAndamento || chance(0.7);
        const temMaquininhas = !emAndamento || (temEntradas && chance(0.5));
        const temSaidas = !emAndamento || chance(0.5);
        const reaberto = !emAndamento && chance(0.02);
        const conferencia = fechamento + entre(18, 72) * 3_600_000;
        const conferido = !emAndamento && !reaberto && conferencia <= agora && chance(0.9);
        const bateu = quebra === 0 && naMaquininha.reduce((a, b) => a + b, 0) === total - dinheiro;
        const decisao = !conferido ? null : bateu ? (chance(0.7) ? 1 : null) : sortear([0, 0, 0, 0, 1, 1, 1, null, null, 0, 1]);

        const id = Number(inserirCaixa.run({
          unidade_id: unidade.id, usuario_id: responsavel.id, turno, data_caixa: dia,
          saldo_inicial: reais(saldoInicial), dinheiro_fisico: emAndamento ? 0 : reais(contado),
          total_entradas: temEntradas ? reais(total) : 0, total_maquininhas: temMaquininhas ? reais(naMaquininha.reduce((a, b) => a + b, 0)) : 0, total_saidas: temSaidas ? reais(totalSaidas) : 0,
          status: emAndamento || reaberto ? 'aberto' : conferido ? 'conferido' : 'finalizado', problema_resolvido: decisao, conferido_por: conferido ? dono.id : null,
          criado_em: horario(abertura), atualizado_em: horario(emAndamento ? Math.min(agora, abertura + entre(5, 120) * 60_000) : conferido ? conferencia : fechamento),
          finalizado_em: emAndamento ? null : horario(fechamento), movimenta_cofre: emAndamento ? null : 1, troco_continua: emAndamento ? null : unidade.troco_continua
        }).lastInsertRowid);
        troco.filter((item) => item.quantidade > 0).forEach((item) => inserirContagem.run(id, 'abertura', reais(item.cedula), item.quantidade, reais(item.cedula * item.quantidade)));
        if (temEntradas) [...formasCartao.map(([forma], i) => [forma, cartoes[i]] as const), ['dinheiro', dinheiro] as const].forEach(([forma, valor]) => inserirEntrada.run(id, forma, reais(valor)));
        if (temMaquininhas) maquininhas[u].forEach((maquininhaId, i) => inserirMaquininha.run(id, maquininhaId, reais(naMaquininha[i])));
        if (temSaidas) saidas.forEach((saida) => inserirSaida.run(id, reais(saida.valor), saida.motivo_id, saida.observacao));
        if (!emAndamento) decompor(contado).forEach((item) => inserirContagem.run(id, 'fechamento', reais(item.cedula), item.quantidade, reais(item.cedula * item.quantidade)));
        recalcularDiferencas(id);
        gerados++;
      }
    });
  }
  return gerados;
});

const gerados = gerar();
const resumo = db.prepare(`SELECT status, COUNT(*) caixas, SUM(status<>'aberto' AND (diferenca_dinheiro<>0 OR diferenca_cartoes<>0)) nao_bateram FROM fechamentos WHERE usuario_id IN (${usuariosGerados}) GROUP BY status`).all();
console.log(`${gerados} caixa(s) gerado(s) de ${new Date(Date.parse(`${hoje}T00:00:00Z`) - (dias - 1) * 86_400_000).toISOString().slice(0, 10)} a ${hoje}.`);
console.table(resumo);
console.log(`Responsáveis com e-mail ${dominio} e senha desconhecida: para entrar como um deles, troque a senha na tela Usuários.`);
