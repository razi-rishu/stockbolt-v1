/**
 * amountInWords — spell a money amount for payment vouchers/receipts.
 * Moved into the print engine (Phase 15) so it survives the removal of the
 * legacy bolt-v4 template.
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  else if (r) parts.push(ONES[r]);
  return parts.join(' ');
}

/** Currency code → spoken major/minor unit names. */
const UNIT_NAMES: Record<string, { major: string; minor: string }> = {
  AED: { major: 'UAE Dirhams', minor: 'Fils' },
  INR: { major: 'Indian Rupees', minor: 'Paise' },
  SAR: { major: 'Saudi Riyals', minor: 'Halalas' },
  QAR: { major: 'Qatari Riyals', minor: 'Dirhams' },
  KWD: { major: 'Kuwaiti Dinars', minor: 'Fils' },
  BHD: { major: 'Bahraini Dinars', minor: 'Fils' },
  OMR: { major: 'Omani Rials', minor: 'Baisa' },
};

export function amountInWords(n: number, currency: string): string {
  const whole = Math.floor(Math.abs(n));
  const cents = Math.round((Math.abs(n) - whole) * 100);
  if (whole === 0 && cents === 0) return 'Zero';
  const groups: Array<[number, string]> = [
    [1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1_000, 'Thousand'], [1, ''],
  ];
  let rest = whole;
  const parts: string[] = [];
  for (const [div, label] of groups) {
    const q = Math.floor(rest / div);
    if (q) { parts.push(`${threeDigits(q)}${label ? ` ${label}` : ''}`); rest %= div; }
  }
  const names = UNIT_NAMES[(currency || '').toUpperCase()] ?? { major: currency, minor: 'Cents' };
  let out = `${parts.join(' ')} ${names.major}`;
  if (cents) out += ` and ${threeDigits(cents)} ${names.minor}`;
  return `${out} Only`;
}
