const WATERMARK_STRINGS = ['Sudais Alam', 'AIFuzX', 'Made by', 'Built with'];

export function verifyWatermarkInHtml(html: string): boolean {
  try {
    const checks = [
      html.includes(WATERMARK_STRINGS[0]),
      html.includes(WATERMARK_STRINGS[1]),
      html.includes(WATERMARK_STRINGS[2]),
      html.includes(WATERMARK_STRINGS[3])
    ];
    return checks.every(c => c === true);
  } catch {
    return false;
  }
}

export function getWatermarkHtml(): string {
  return '<div class="webos-watermark" data-credit="Sudais Alam" data-tool="AIFuzX">Made by Sudais Alam · Built with AIFuzX</div>';
}
