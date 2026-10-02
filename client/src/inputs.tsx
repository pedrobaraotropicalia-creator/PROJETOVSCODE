import { NumericFormat } from 'react-number-format';

export function MoneyInput({ value, onChange, placeholder = 'R$ 0,00' }: { value: number | undefined; onChange: (value: number | undefined) => void; placeholder?: string }) {
  return <NumericFormat value={value ?? ''} onValueChange={(values) => onChange(values.floatValue)} prefix="R$ " thousandSeparator="." decimalSeparator="," decimalScale={2} fixedDecimalScale allowNegative={false} inputMode="decimal" placeholder={placeholder} />;
}

export function QuantityInput({ value, onChange }: { value: number | undefined; onChange: (value: number | undefined) => void }) {
  return <NumericFormat value={value ?? ''} onValueChange={(values) => onChange(values.floatValue)} thousandSeparator="." decimalSeparator="," decimalScale={0} allowNegative={false} inputMode="numeric" placeholder="Quantidade" />;
}
