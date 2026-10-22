// Code 128: cada símbolo são 6 larguras alternadas (barra, espaço, barra...) que somam 11 módulos; o de parada tem 7 e soma 13.
// O índice é o valor do símbolo. No subconjunto B o valor é o código ASCII - 32; no C, um par de dígitos (00 a 99).
export const padroes = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];
const CODE_B = 100, START_B = 104, START_C = 105, STOP = 106;

/** Valores dos símbolos (início, dados e verificador, sem a parada). Texto só de dígitos vai em pares no subconjunto C
 * (com quantidade ímpar, o último dígito vai no B); o resto, no B. */
export function simbolos(texto: string) {
  if (!/^[\x20-\x7e]+$/.test(texto)) throw new Error('O código de barras aceita só letras, números e símbolos comuns.');
  const valorB = (caractere: string) => caractere.charCodeAt(0) - 32;
  const pares = (digitos: string) => (digitos.match(/../g) ?? []).map(Number);
  const dados = !/^\d+$/.test(texto) ? [START_B, ...[...texto].map(valorB)]
    : texto.length % 2 === 0 ? [START_C, ...pares(texto)]
    : texto.length === 1 ? [START_B, valorB(texto)]
    : [START_C, ...pares(texto.slice(0, -1)), CODE_B, valorB(texto.slice(-1))];
  const verificador = dados.reduce((soma, valor, posicao) => soma + valor * Math.max(posicao, 1), 0) % 103;
  return [...dados, verificador];
}

/** Larguras das barras e espaços do texto em Code 128, em módulos, começando por uma barra. */
export const code128 = (texto: string) => [...simbolos(texto), STOP].flatMap((valor) => [...padroes[valor]].map(Number));
