// 시안 화면(calm.css / calm.html / calm.js) 디자인 규칙 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const css = read('calm.css');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 토큰 블록에서 --이름: #색 을 읽음
function tokensAfter(marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `${marker} 블록이 없음`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
const light = tokensAfter(':root {');
const darkAuto = tokensAfter(':root:not([data-theme="light"])');
const darkManual = tokensAfter(':root[data-theme="dark"]');

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [글자·아이콘 색, 바탕색, 최소 대비]
// 글자는 4.5:1 (WCAG AA), 아이콘·테두리 같은 비글자 요소는 3:1
const PAIRS = [
  ['text', 'card', 4.5], ['text', 'bg', 4.5], ['text2', 'card', 4.5],
  ['text', 'seg', 4.5], ['on-ink', 'ink', 4.5],
  ['accent', 'panel', 4.5],
  ['panel-text', 'panel', 4.5], ['panel-text2', 'panel', 4.5],
  ['amber', 'card', 3], ['red', 'card', 3],
  ['amber', 'panel', 3], ['red', 'panel', 3],
];

for (const [name, tokens] of [['라이트', light], ['다크(수동)', darkManual]]) {
  test(`${name}: 대비 기준 충족`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const r = contrast(tokens[fg], tokens[bg]);
      assert.ok(r >= min, `${name}: ${fg} ${tokens[fg]} / ${bg} ${tokens[bg]} = ${r.toFixed(2)} (기준 ${min})`);
    }
  });
}

test('다크: 기기 설정 자동과 수동 선택의 색이 같음', () => {
  assert.deepEqual(darkAuto, darkManual);
});

test('결과 패널 숫자 색(포인트)은 패널 안에서만 사용', () => {
  for (const chunk of cssNoComments.split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open < 0) continue;
    const selector = chunk.slice(0, open).trim();
    if (selector.includes(':root')) continue;
    if (/var\(--accent\)/.test(chunk.slice(open + 1))) {
      assert.ok(/panel|big/.test(selector), `포인트 색이 패널 밖에 쓰임: ${selector}`);
    }
  }
});

test('색은 토큰에서만 정의: 토큰 줄 밖에 16진수 색이 없음', () => {
  for (const line of cssNoComments.split('\n')) {
    if (/#[0-9a-fA-F]{6}\b/.test(line)) {
      assert.ok(line.trim().startsWith('--'), `토큰 밖의 색: ${line.trim()}`);
    }
  }
});

test('그라데이션·그림자·이모지 없음', () => {
  for (const f of ['calm.css', 'calm.html', 'src/calm.js']) {
    const text = read(f);
    assert.ok(!/gradient/i.test(text), `${f} 에 그라데이션`);
    assert.ok(!/box-shadow/i.test(text) || f === 'calm.css' && /box-shadow:\s*none/.test(text), `${f} 에 그림자`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${f} 에 이모지`);
  }
});

test('모서리는 12px 이하', () => {
  for (const m of cssNoComments.matchAll(/border-radius:\s*(\d+)px/g)) {
    assert.ok(Number(m[1]) <= 12, `모서리 ${m[1]}px`);
  }
});

test('화면 파일에 하드코딩된 색 없음', () => {
  for (const f of ['calm.html', 'src/calm.js']) {
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(read(f)), `${f} 에 색 하드코딩`);
  }
});
