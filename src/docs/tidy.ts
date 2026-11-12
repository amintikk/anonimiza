// The tidying every extracted text gets (see extract.ts), done on characters that remember where they came from:
// returns the indices of the characters that stay.
export function tidyIndices(chars: string[]): number[] {
  const keep = new Uint8Array(chars.length).fill(1);
  // No spaces or tabs right before a line break.
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\n') continue;
    for (let j = i - 1; j >= 0 && /[ \t ]/.test(chars[j]!); j--) keep[j] = 0;
  }
  // At most three line breaks in a row.
  let run = 0;
  for (let i = 0; i < chars.length; i++) {
    if (!keep[i]) continue;
    run = chars[i] === '\n' ? run + 1 : 0;
    if (run > 3) keep[i] = 0;
  }
  // No blank start or end.
  let a = 0, b = chars.length;
  while (a < b && (!keep[a] || /\s/.test(chars[a]!))) a++;
  while (b > a && (!keep[b - 1] || /\s/.test(chars[b - 1]!))) b--;
  const out: number[] = [];
  for (let i = a; i < b; i++) if (keep[i]) out.push(i);
  return out;
}
