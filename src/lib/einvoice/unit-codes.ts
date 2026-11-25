/**
 * Official unit codes for a line written in a pack (phase155). Government
 * formats accept only their own lists, never a company's own words: India
 * takes the GST UQC list, PINT-AE takes UN/ECE Rec 20/21. A pack that matches
 * nothing ("200 g") is a package / "others" — the quantity and price are per
 * pack, so a weight code would be wrong.
 */
const CODES: [RegExp, string, string][] = [
  // label,                           GST UQC, UN/ECE
  [/^(box|boxes|bx)\b/i,          'BOX', 'XBX'],
  [/^(ctn|carton|cartons)\b/i,    'CTN', 'XCT'],
  [/^(pkt|pack|packs|packet|packets|pk)\b/i, 'PAC', 'XPK'],
  [/^(doz|dzn|dozen|dozens)\b/i,        'DOZ', 'DZN'],
  [/^(bag|bags)\b/i,                    'BAG', 'XBG'],
  [/^(btl|bottle|bottles)\b/i,          'BTL', 'XBO'],
  [/^(drum|drums)\b/i,                  'DRM', 'XDR'],
  [/^(roll|rolls)\b/i,                  'ROL', 'XRO'],
  [/^(set|sets)\b/i,                    'SET', 'SET'],
  [/^(pair|pairs|prs|pr)\b/i,           'PRS', 'PR'],
  [/^(bundle|bundles|bdl)\b/i,          'BDL', 'XBE'],
  [/^(can|cans)\b/i,                    'CAN', 'XCA'],
  [/^(tube|tubes)\b/i,                  'TUB', 'XTU'],
];

export function packUnitCode(label: string, isIndia: boolean): string {
  const hit = CODES.find(([re]) => re.test(label.trim()));
  if (hit) return isIndia ? hit[1] : hit[2];
  return isIndia ? 'OTH' : 'XPK';
}
