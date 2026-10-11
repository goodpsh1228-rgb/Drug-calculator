// 화면용 글자·숫자 도구

// 입력칸 글자 → 숫자. "12abc", "1,000", 빈칸은 NaN (잘못 읽어서 틀린 값으로 계산하는 일을 막음)
export function parseNum(text) {
  const t = String(text ?? '').trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

// 표시용 숫자: 소수점 3자리까지 (뒤의 0은 생략). 아주 작은 수는 유효숫자 2자리
export function fmt(x) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  if (Math.abs(x) < 0.001) return String(Number(x.toPrecision(2)));
  return Number(x.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

// HTML 에 글자를 넣기 전에 특수문자를 안전하게 바꿈 (시트 내용이 화면 코드로 해석되는 것을 막음)
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
