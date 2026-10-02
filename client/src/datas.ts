const BRASILIA_TZ = 'America/Sao_Paulo';
// Brasília sem horário de verão desde 2019; o server também agrupa os dias em UTC-3
const BRASILIA_OFFSET = '-03:00';

const dataFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dataHoraFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// o SQLite grava CURRENT_TIMESTAMP em UTC sem indicar o fuso
const asUtcDate = (value: string | number | Date) => {
  if (typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value.replace(' ', 'T') + 'Z');
  return new Date(value);
};

/** DD/MM/AAAA */
export const formatDate = (value: string | number | Date) => dataFormat.format(asUtcDate(value));
/** DD/MM/AAAA HH:mm, 24 horas */
export const formatDateTime = (value: string | number | Date) => dataHoraFormat.format(asUtcDate(value)).replace(',', '');
/** 'AAAA-MM-DD' (dia já calculado no fuso de Brasília) → DD/MM/AAAA */
export const formatDay = (day: string) => day.split('-').reverse().join('/');
const diaSemanaFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA_TZ, weekday: 'long' });
/** Dia da semana com inicial maiúscula, ex.: 'Sexta-feira' */
export const formatWeekday = (value: Date) => { const dia = diaSemanaFormat.format(value); return dia.charAt(0).toUpperCase() + dia.slice(1); };

/** 'DD/MM/AAAA HH:mm' no horário de Brasília → Date, ou null se a data não existir */
export function parseDateTime(text: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00${BRASILIA_OFFSET}`);
  return !Number.isNaN(date.getTime()) && formatDateTime(date) === text ? date : null;
}
