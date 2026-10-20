import { describe, expect, it } from 'vitest';
import { mesDoDia, trechoDoMesAnterior } from './datas';

describe('mesDoDia', () => {
  it('vai do dia 1 ao último dia do mês', () => {
    expect(mesDoDia('2026-08-14')).toEqual({ de: '2026-08-01', ate: '2026-08-31' });
    expect(mesDoDia('2026-09-30')).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
  });
  it('considera fevereiro de ano bissexto', () => {
    expect(mesDoDia('2028-02-03')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
    expect(mesDoDia('2026-02-03')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
});

describe('trechoDoMesAnterior', () => {
  it('vai do dia 1 do mês anterior até o mesmo dia', () => {
    expect(trechoDoMesAnterior('2026-10-04')).toEqual({ de: '2026-09-01', ate: '2026-09-04' });
  });
  it('para no fim do mês anterior quando ele é mais curto', () => {
    expect(trechoDoMesAnterior('2026-03-31')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
  it('volta para dezembro do ano anterior em janeiro', () => {
    expect(trechoDoMesAnterior('2027-01-15')).toEqual({ de: '2026-12-01', ate: '2026-12-15' });
  });
});
