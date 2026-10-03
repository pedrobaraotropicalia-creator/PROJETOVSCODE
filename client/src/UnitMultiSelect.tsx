import Select, { components, type OptionProps, type StylesConfig } from 'react-select';
import { Icone } from './icones';

type Unit = { id: number; nome: string };
type Opcao = { value: number; label: string };

const OpcaoComCheckbox = (props: OptionProps<Opcao, true>) => <components.Option {...props}><span className="multi-check" aria-hidden="true">{props.isSelected && <Icone nome="check" />}</span>{props.label}</components.Option>;

// mesmo visual do padrão de select em styles.css
const estilos: StylesConfig<Opcao, true> = {
  container: (base) => ({ ...base, minWidth: 260 }),
  control: (base, state) => ({ ...base, minHeight: 44, borderRadius: 3, background: '#fbfcfc', borderColor: state.isFocused ? '#e27b43' : '#dbe3e6', boxShadow: state.isFocused ? '0 0 0 3px #e27b431a' : 'none', cursor: 'pointer', '&:hover': { borderColor: state.isFocused ? '#e27b43' : '#a9bcc3' } }),
  placeholder: (base) => ({ ...base, color: '#70838d', fontWeight: 500 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base) => ({ ...base, color: '#247078', '&:hover': { color: '#247078' } }),
  clearIndicator: (base) => ({ ...base, color: '#8a9aa1', '&:hover': { color: '#b44e38' } }),
  multiValue: (base) => ({ ...base, background: '#e9f3f0', borderRadius: 20 }),
  multiValueLabel: (base) => ({ ...base, color: '#217c68', fontWeight: 600, fontSize: 12, padding: '3px 4px 3px 9px' }),
  multiValueRemove: (base) => ({ ...base, color: '#217c68', borderRadius: '0 20px 20px 0', '&:hover': { background: '#d5e9e3', color: '#b44e38' } }),
  menu: (base) => ({ ...base, borderRadius: 3, boxShadow: '0 8px 24px #0c253b26', border: '1px solid #e3eaec' }),
  menuPortal: (base) => ({ ...base, zIndex: 20 }),
  option: (base, state) => ({ ...base, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', color: '#18324a', fontWeight: state.isSelected ? 600 : 400, background: state.isFocused ? '#f4f8f7' : 'transparent', '&:active': { background: '#e9f3f0' } })
};

/** Seleção de várias unidades; o menu fica aberto enquanto as opções são marcadas. */
export default function UnitMultiSelect({ units, value, onChange, placeholder = 'Todas as unidades', ariaLabel = 'Unidades' }: { units: Unit[]; value: number[]; onChange: (ids: number[]) => void; placeholder?: string; ariaLabel?: string }) {
  const opcoes = units.map((unit) => ({ value: unit.id, label: unit.nome }));
  return <Select<Opcao, true>
    isMulti
    options={opcoes}
    value={opcoes.filter((opcao) => value.includes(opcao.value))}
    onChange={(selecionadas) => onChange(selecionadas.map((opcao) => opcao.value))}
    closeMenuOnSelect={false}
    hideSelectedOptions={false}
    placeholder={placeholder}
    noOptionsMessage={() => 'Nenhuma unidade'}
    aria-label={ariaLabel}
    components={{ Option: OpcaoComCheckbox }}
    menuPortalTarget={document.body}
    styles={estilos}
  />;
}
