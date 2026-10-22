// Padrões do voucher (vale consumo), usados pelo server e pelo client (como limites.ts, não pode depender de nada do server).

/** Validade padrão: o voucher vale até a emissão + estes dias. */
export const VALIDADE_VOUCHER_DIAS = 7;

/** Regras de uso de uma unidade nova (uma por linha), as do vale do Terra & Mar. A validade fica de fora: o PDF calcula a de cada voucher. */
export const regrasVoucherPadrao = ['Utilização para todos os dias.', 'Horário de atendimento das 11h às 23h.', 'Não será devolvido troco em caso de não utilização total do voucher.', 'Consumação única.'].join('\n');
