// 브랜드 자산(아이콘·로고)과 홈 화면 바로가기 설정 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const file = (p) => new URL(`../${p}`, import.meta.url);
const PNG_SIGNATURE = '89504e470d0a1a0a';

// PNG 머리 부분에서 가로·세로·색 형식을 읽음 (색 형식 2 = RGB, 6 = 투명도 있는 RGBA)
function pngInfo(p) {
  const b = readFileSync(file(p));
  assert.equal(b.subarray(0, 8).toString('hex'), PNG_SIGNATURE, `${p} 는 PNG 가 아님`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

test('앱 아이콘 PNG 크기: 180(iOS), 192·512(PWA), 512 마스크용', () => {
  for (const [name, size] of [['icon-180', 180], ['icon-192', 192], ['icon-512', 512], ['icon-512-maskable', 512]]) {
    const { width, height } = pngInfo(`assets/brand/${name}.png`);
    assert.deepEqual([width, height], [size, size], name);
  }
});

test('앱 아이콘은 투명 영역이 없는 RGB (iOS 가 투명 부분을 검게 채우는 문제 방지)', () => {
  for (const name of ['icon-180', 'icon-192', 'icon-512', 'icon-512-maskable']) {
    assert.equal(pngInfo(`assets/brand/${name}.png`).colorType, 2, `${name} 에 투명도가 있음`);
  }
});

test('가로 로고 PNG: 밝은/어두운 배경용, 가로가 세로보다 훨씬 긺', () => {
  for (const name of ['logo-light', 'logo-dark']) {
    const { width, height } = pngInfo(`assets/brand/${name}.png`);
    assert.ok(width / height > 3, `${name} 비율`);
  }
});

test('SVG 파일: 마크 2종과 파비콘이 유효한 svg 이고 글꼴에 의존하지 않음', () => {
  for (const name of ['mark', 'mark-dark', 'favicon']) {
    const text = readFileSync(file(`assets/brand/${name}.svg`), 'utf8');
    assert.ok(text.includes('<svg') && text.includes('</svg>'), `${name}.svg`);
    assert.ok(!/font-family|<text/.test(text), `${name}.svg 가 글꼴에 의존함`);
  }
});

for (const page of ['index.html', 'calm.html']) {
  test(`${page}: 파비콘, 홈 화면 아이콘, 홈 화면 이름이 연결되어 있고 파일이 존재함`, () => {
    const html = readFileSync(file(page), 'utf8');
    assert.match(html, /<link rel="icon" href="assets\/brand\/favicon\.svg"/);
    assert.match(html, /<link rel="apple-touch-icon" href="assets\/brand\/icon-180\.png"/);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="약물 계산기">/);
    assert.ok(existsSync(file('assets/brand/favicon.svg')) && existsSync(file('assets/brand/icon-180.png')));
  });
}

test('사이트 제목은 새 이름 "수의학 약물 계산기"', () => {
  assert.match(readFileSync(file('index.html'), 'utf8'), /<title>수의학 약물 계산기<\/title>/);
});
