import DatePicker, { registerLocale } from 'react-datepicker';
import { ptBR } from 'date-fns/locale/pt-BR';
import { PatternFormat } from 'react-number-format';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('pt-BR', ptBR);

// O calendário usa Date no fuso do navegador; aqui só trocamos dia/mês/ano/hora como texto,
// e quem interpreta o texto no horário de Brasília continua sendo datas.ts (parseDate/parseDateTime).
const paraData = (texto: string) => {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(texto);
  if (!partes) return null;
  const [, dia, mes, ano, hora = '0', minuto = '0'] = partes;
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto));
  return data.getDate() === Number(dia) && data.getMonth() === Number(mes) - 1 ? data : null;
};
const doisDigitos = (numero: number) => String(numero).padStart(2, '0');
const paraTexto = (data: Date, comHora: boolean) => {
  const dia = `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}`;
  return comHora ? `${dia} ${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}` : dia;
};

/** Campo de data (DD/MM/AAAA) ou data e hora (DD/MM/AAAA HH:mm, 24h) com calendário em pt-BR; aceita digitar. */
export default function DataInput({ value, onChange, label, comHora = false }: { value: string; onChange: (value: string) => void; label: string; comHora?: boolean }) {
  return <DatePicker
    selected={paraData(value)}
    onChange={(data: Date | null) => onChange(data ? paraTexto(data, comHora) : '')}
    locale="pt-BR"
    dateFormat={comHora ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'}
    showTimeSelect={comHora}
    timeFormat="HH:mm"
    timeIntervals={30}
    timeCaption="Hora"
    placeholderText={comHora ? 'DD/MM/AAAA HH:mm' : 'DD/MM/AAAA'}
    customInput={<PatternFormat format={comHora ? '##/##/#### ##:##' : '##/##/####'} mask="_" inputMode="numeric" aria-label={label} />}
    wrapperClassName="data-input"
    popperPlacement="bottom-start"
    portalId="calendario-portal"
    previousMonthAriaLabel="Mês anterior"
    nextMonthAriaLabel="Próximo mês"
    chooseDayAriaLabelPrefix="Escolher"
    disabledDayAriaLabelPrefix="Indisponível:"
    weekAriaLabelPrefix="Semana"
    monthAriaLabelPrefix="Mês"
  />;
}
