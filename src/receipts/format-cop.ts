// "95200.00" -> "$95.200"; "95200.50" -> "$95.200,50". Trabaja sobre el texto
// decimal: el dinero nunca pasa por number.
export function formatCop(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = fraction.replace(/0+$/, '');
  return `$${grouped}${cents ? `,${cents.padEnd(2, '0')}` : ''}`;
}

// "0.1900" -> "19 %"; "0.0550" -> "5,5 %".
export function formatRate(rate: string): string {
  const [whole = '0', fraction = ''] = rate.split('.');
  const digits = (whole + fraction.padEnd(4, '0').slice(0, 4)).replace(
    /^0+(?=\d)/,
    '',
  );
  const percent = digits.padStart(3, '0');
  const int = percent.slice(0, -2).replace(/^0+(?=\d)/, '');
  const dec = percent.slice(-2).replace(/0+$/, '');
  return `${int}${dec ? `,${dec}` : ''} %`;
}
