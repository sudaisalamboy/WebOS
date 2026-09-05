'use client'

const _0x4f2a = ['Sudais Alam', 'AIFuzX', 'Made by', 'Built with'];
const _0x7b1c = (a: string, b: string) => a.includes(b);

export function verifyWatermark(): boolean {
  try {
    const body = document.body.innerHTML;
    const checks = [
      _0x7b1c(body, _0x4f2a[0]),
      _0x7b1c(body, _0x4f2a[1]),
      _0x7b1c(body, _0x4f2a[2]),
      _0x7b1c(body, _0x4f2a[3])
    ];
    return checks.every(c => c === true);
  } catch {
    return false;
  }
}

export function enforceWatermark(): void {
  if (!verifyWatermark()) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:999999;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff;font-family:sans-serif;';
    div.innerHTML = '<h1 style="font-size:24px;margin-bottom:10px;">WebOS</h1><p style="font-size:14px;">Made by Sudais Alam</p><p style="font-size:12px;color:#888;">Built with AIFuzX</p>';
    document.body.appendChild(div);
    document.body.style.overflow = 'hidden';
  }
}

let _0x3d8f: number;
export function startWatermarkCheck(): void {
  if (_0x3d8f) clearInterval(_0x3d8f);
  _0x3d8f = window.setInterval(enforceWatermark, 3000);
}
