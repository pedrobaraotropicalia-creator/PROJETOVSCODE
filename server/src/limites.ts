// Limites dos dados digitados pelo usuário. O server valida com eles e o client usa os mesmos valores
// nos inputs (maxLength / valor máximo), então este arquivo não pode depender de nada do server.
export const limites = {
  nomeUsuario: 80,
  email: 254, // RFC 5321
  senhaBytes: 72, // o bcrypt ignora o que passa de 72 bytes
  nomeUnidade: 50,
  nomeMaquininha: 40,
  numeroMaquininha: 20,
  serieMaquininha: 40,
  motivoSaida: 200,
  saidasPorCaixa: 50,
  valor: 1_000_000,
  tolerancia: 1_000,
  quantidade: 10_000
} as const;
