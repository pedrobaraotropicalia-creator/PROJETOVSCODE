import { NumericFormat } from 'react-number-format';
import { limites } from '../../server/src/limites';

export function MoneyInput({ value, onChange, placeholder = 'R$ 0,00' }: { value: number | undefined; onChange: (value: number | undefined) => void; placeholder?: string }) {
  return <NumericFormat value={value ?? ''} onValueChange={(values) => onChange(values.floatValue)} prefix="R$ " thousandSeparator="." decimalSeparator="," decimalScale={2} fixedDecimalScale allowNegative={false} isAllowed={({ floatValue }) => floatValue === undefined || floatValue <= limites.valor} inputMode="decimal" placeholder={placeholder} />;
}

export function QuantityInput({ value, onChange }: { value: number | undefined; onChange: (value: number | undefined) => void }) {
  return <NumericFormat value={value ?? ''} onValueChange={(values) => onChange(values.floatValue)} thousandSeparator="." decimalSeparator="," decimalScale={0} allowNegative={false} isAllowed={({ floatValue }) => floatValue === undefined || floatValue <= limites.quantidade} inputMode="numeric" placeholder="Quantidade" />;
}
