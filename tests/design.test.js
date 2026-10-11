// 디자인 규칙 자동 검사: 글자 대비(WCAG AA), 다크 모드 토큰 일치, 경고색 용도 제한
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// "{ ... }" 블록 안의 --이름: #색 목록을 읽음 (rgba 같은 색은 건너뜀)
function tokensAfter(marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `${marker} 블록이 없음`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

const light = tokensAfter(':root {');
const darkAuto = tokensAfter(':root:not([data-theme="light"])');
const darkManual = tokensAfter(':root[data-theme="dark"]');

// WCAG 상대 휘도와 대비 계산
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

// [글자색, 바탕색] 쌍: 실제 화면에서 겹쳐 쓰이는 조합
const PAIRS = [
  ['text', 'card'], ['text', 'bg'], ['text', 'hdr'],
  ['text2', 'card'], ['text2', 'bg'], ['text2', 'hdr'],
  ['accent', 'card'], ['accent', 'bg'], ['accent', 'seg'],
  ['on-accent', 'accent'], ['text', 'seg'],
  ['warn', 'warn-bg'], ['danger', 'danger-bg'],
];

for (const [name, tokens] of [['라이트', light], ['다크', darkManual]]) {
  test(`${name} 모드: 글자 대비 WCAG AA(4.5:1) 이상`, () => {
    for (const [fg, bg] of PAIRS) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(ratio >= 4.5, `${name}: ${fg} ${tokens[fg]} / ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}`);
    }
  });
}

test('다크 모드: 기기 설정 자동(media)과 수동 선택의 색이 같음', () => {
  assert.deepEqual(darkAuto, darkManual);
});

test('다크 모드: 배경은 거의 검정, 카드는 한 단계 밝음', () => {
  assert.ok(luminance(darkManual.bg) < 0.01);
  assert.ok(luminance(darkManual.card) > luminance(darkManual.bg));
  assert.ok(luminance(darkManual.card) < 0.05);
});

test('주황·빨강(경고·오류색)은 .alert / .badge 에서만 사용', () => {
  const chunks = css.split('}');
  for (const chunk of chunks) {
    const open = chunk.lastIndexOf('{');
    if (open < 0) continue;
    const selector = chunk.slice(0, open).trim();
    const body = chunk.slice(open + 1);
    if (selector.includes(':root')) continue; // 색 토큰 정의
    if (/var\(--(warn|danger)(-bg)?\)/.test(body)) {
      assert.ok(/alert|badge/.test(selector), `경고색이 장식에 쓰임: ${selector}`);
    }
  }
});

test('색은 CSS 토큰에서만 정의: app.js 와 index.html 에 하드코딩된 색 없음', () => {
  for (const f of ['../src/app.js', '../index.html']) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8');
    // 아이콘 주소 안의 %23 같은 것은 제외하고 #RRGGBB 형태만 검사 (theme-color 메타는 예외)
    const withoutMeta = text.replace(/<meta name="theme-color"[^>]*>/g, '');
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(withoutMeta), `${f} 에 하드코딩된 색이 있음`);
  }
});
