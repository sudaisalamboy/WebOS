const _0x9a2b = ['Sudais Alam', 'AIFuzX', 'Made by', 'Built with'];
const _0x4c7d = (a: string, b: string) => a.includes(b);

export function verifyWatermarkInHtml(html: string): boolean {
  try {
    const checks = [
      _0x4c7d(html, _0x9a2b[0]),
      _0x4c7d(html, _0x9a2b[1]),
      _0x4c7d(html, _0x9a2b[2]),
      _0x4c7d(html, _0x9a2b[3])
    ];
    return checks.every(c => c === true);
  } catch {
    return false;
  }
}

export function getWatermarkHtml(): string {
  return '<div class="webos-watermark" data-credit="Sudais Alam" data-tool="AIFuzX">Made by Sudais Alam · Built with AIFuzX</div>';
}
