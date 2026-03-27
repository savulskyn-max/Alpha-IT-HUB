const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ARS_DECIMAL = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('es-AR');

const PCT = new Intl.NumberFormat('es-AR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return ARS.format(value);
}

export function formatMoneyDecimal(value: number): string {
  return ARS_DECIMAL.format(value);
}

export function formatNumber(value: number): string {
  return NUM.format(value);
}

export function formatPercent(value: number): string {
  return PCT.format(value / 100);
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}
