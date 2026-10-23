// "95200.00" -> "NOVENTA Y CINCO MIL DOSCIENTOS PESOS M/CTE". Es el «valor en letras»
// que llevan los comprobantes en Colombia. Trabaja sobre el texto decimal.

const UNITS = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
];
const TEENS = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const TWENTIES = [
  'VEINTE',
  'VEINTIÚN',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];
const TENS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const HUNDREDS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

// 1 a 999, con «UN» (no «UNO») porque siempre va delante de «MIL» o «MILLÓN».
function below1000(n: number): string {
  if (n === 100) return 'CIEN';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const words: string[] = [];
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else if (rest >= 20 && rest < 30) words.push(TWENTIES[rest - 20]);
  else if (rest >= 30) {
    const unit = rest % 10;
    words.push(
      unit
        ? `${TENS[Math.floor(rest / 10)]} Y ${UNITS[unit]}`
        : TENS[rest / 10],
    );
  } else if (rest > 0) words.push(UNITS[rest]);
  return words.join(' ');
}

function integerInWords(value: bigint): string {
  if (value === 0n) return 'CERO';
  const millions = Number(value / 1_000_000n);
  const thousands = Number((value / 1000n) % 1000n);
  const units = Number(value % 1000n);
  const words: string[] = [];

  if (millions) {
    // Más allá de mil millones se vuelve a aplicar la regla por grupos.
    const prefix = millions === 1 ? 'UN' : integerInWords(BigInt(millions));
    words.push(`${prefix} ${millions === 1 ? 'MILLÓN' : 'MILLONES'}`);
  }
  if (thousands)
    words.push(thousands === 1 ? 'MIL' : `${below1000(thousands)} MIL`);
  // «UN PESO», «CIENTO UN PESOS»: delante de un sustantivo se dice «un», no «uno».
  if (units) words.push(below1000(units));
  return words.join(' ');
}

export function amountInWords(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  const pesos = BigInt(whole || '0');
  const cents = fraction.padEnd(2, '0').slice(0, 2);

  const body = integerInWords(pesos);
  // «DOCE MILLONES DE PESOS», pero «DOCE MIL PESOS».
  const needsDe = pesos !== 0n && pesos % 1_000_000n === 0n;
  const unit = pesos === 1n ? 'PESO' : needsDe ? 'DE PESOS' : 'PESOS';
  const text = `${body} ${unit}`;
  return cents === '00' ? `${text} M/CTE` : `${text} CON ${cents}/100 M/CTE`;
}
