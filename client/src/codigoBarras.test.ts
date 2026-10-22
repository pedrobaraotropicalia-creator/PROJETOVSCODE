import { describe, expect, it } from 'vitest';
import { code128, padroes, simbolos } from './codigoBarras';

const binario = (larguras: number[]) => larguras.map((largura, indice) => (indice % 2 === 0 ? '1' : '0').repeat(largura)).join('');
const soma = (padrao: string) => [...padrao].reduce((total, largura) => total + Number(largura), 0);

describe('Code 128', () => {
  it('tem os 107 padrões distintos, de 11 módulos (parada com 13)', () => {
    expect(padroes).toHaveLength(107);
    expect(new Set(padroes).size).toBe(107);
    expect(padroes.slice(0, 106).every((padrao) => padrao.length === 6 && soma(padrao) === 11)).toBe(true);
    expect(soma(padroes[106])).toBe(13);
  });

  it('dígitos em quantidade par vão em pares no subconjunto C', () => {
    // verificador: (105 + 12·1 + 34·2 + 56·3 + 78·4 + 90·5 + 12·6) % 103 = 54
    expect(simbolos('123456789012')).toEqual([105, 12, 34, 56, 78, 90, 12, 54]);
    // conferido com o JsBarcode (CODE128C)
    expect(binario(code128('123456789012'))).toBe('11010011100101100111001000101100011100010110110000101001101111011010110011100111010110001100011101011');
  });

  it('com quantidade ímpar, o último dígito vai no subconjunto B', () => {
    expect(simbolos('4829105537261')).toEqual([105, 48, 29, 10, 55, 37, 26, 100, 17, 93]);
    expect(simbolos('7')).toEqual([104, 23, 24]);
  });

  it('letras e traço vão no subconjunto B', () => {
    expect(simbolos('AB-1')).toEqual([104, 33, 34, 13, 17, 3]);
    expect(code128('AB-1').reduce((total, largura) => total + largura, 0)).toBe(6 * 11 + 13);
  });

  it('recusa caractere fora do ASCII imprimível', () => {
    expect(() => code128('VOUCHÊ')).toThrow();
  });
});
