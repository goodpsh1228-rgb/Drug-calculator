// 데이터 읽기·검증, 표시 도구, 계산 과정 문구 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, buildCatalog } from '../src/data.js';
import { parseNum, fmt, esc } from '../src/format.js';
import { bagSteps, syringeSteps } from '../src/steps.js';
import { calcBag, calcSyringe, doseToStd, concToStd } from '../src/calc.js';

const DRUG_HEADER = 'id,약물명,원액농도,농도단위,호환희석액,비호환·주의,방식,출처,검수완료,최종수정일';
const DOSE_HEADER = 'id,종,용량최소,용량최대,용량단위,종별주의,사용금지';

// 테스트용으로 CSV 글자에서 바로 카탈로그를 만드는 도구
function catalogFrom(drugLines, doseLines, opts) {
  return buildCatalog(
    parseCsv([DRUG_HEADER, ...drugLines].join('\n')),
    parseCsv([DOSE_HEADER, ...doseLines].join('\n')),
    opts,
  );
}
const OK_DRUG = 'a,약물A,50,μg/mL,"NS,D5W",,둘다,,Y,2026-01-01';
const OK_DOSE = 'a,개,1,3,μg/kg/hr,,N';

// ---------- CSV 읽기 ----------
test('CSV: 따옴표 안 쉼표, BOM, 윈도우 줄바꿈, 빈 줄 처리', () => {
  const rows = parseCsv('﻿id,이름\r\n"a,b","큰""따옴표"\r\n\r\nc,d\r\n');
  assert.deepEqual(rows, [{ id: 'a,b', 이름: '큰"따옴표' }, { id: 'c', 이름: 'd' }]);
});

// ---------- 샘플 파일 ----------
test('샘플 CSV: 약물 4개, 오류 없음, 전부 검수 전이라 기본은 숨김', () => {
  const drugRows = parseCsv(readFileSync(new URL('../data/drugs.csv', import.meta.url), 'utf8'));
  const doseRows = parseCsv(readFileSync(new URL('../data/doses.csv', import.meta.url), 'utf8'));
  assert.equal(drugRows.length, 4);

  const normal = buildCatalog(drugRows, doseRows);
  assert.deepEqual(normal.issues, []);
  assert.equal(normal.drugs.length, 0);
  assert.equal(normal.hiddenUnreviewed, 4);

  const preview = buildCatalog(drugRows, doseRows, { includeUnreviewed: true });
  assert.equal(preview.drugs.length, 4);
  assert.ok(preview.drugs.every((d) => d.source === '' && d.reviewed === false));
  const lido = preview.drugs.find((d) => d.id === 'lidocaine');
  assert.equal(lido.doses['고양이'].banned, true);
});

// ---------- 안전장치 ----------
test('검수완료=Y 만 표시, N 은 숨김', () => {
  const c = catalogFrom(
    [OK_DRUG, 'b,약물B,50,μg/mL,,,둘다,,N,2026-01-01'],
    [OK_DOSE, 'b,개,1,3,μg/kg/hr,,N'],
  );
  assert.deepEqual(c.drugs.map((d) => d.id), ['a']);
  assert.equal(c.hiddenUnreviewed, 1);
});

test('오류: id 중복이면 해당 약물 숨김 + 오류 표시', () => {
  const c = catalogFrom([OK_DRUG, OK_DRUG], [OK_DOSE]);
  assert.equal(c.drugs.length, 0);
  assert.ok(c.issues.some((i) => i.messages.some((m) => m.includes('중복'))));
});

test('오류: 용량 탭 id 가 약물 탭에 없음', () => {
  const c = catalogFrom([OK_DRUG], [OK_DOSE, 'zzz,개,1,3,μg/kg/hr,,N']);
  assert.deepEqual(c.drugs.map((d) => d.id), ['a']); // 정상 약물은 영향 없음
  assert.ok(c.issues.some((i) => i.messages.some((m) => m.includes('약물 탭에 없음'))));
});

test('오류: 숫자 칸에 글자', () => {
  const c1 = catalogFrom([OK_DRUG], ['a,개,abc,3,μg/kg/hr,,N']);
  assert.equal(c1.drugs.length, 0);
  const c2 = catalogFrom(['a,약물A,50mg,μg/mL,,,둘다,,Y,2026-01-01'], [OK_DOSE]);
  assert.equal(c2.drugs.length, 0);
  const c3 = catalogFrom([OK_DRUG], ['a,개,1,1,000,μg/kg/hr,,N']); // 칸이 밀려 단위 칸이 숫자가 됨
  assert.equal(c3.drugs.length, 0);
});

test('오류: 최소 > 최대', () => {
  const c = catalogFrom([OK_DRUG], ['a,개,5,2,μg/kg/hr,,N']);
  assert.equal(c.drugs.length, 0);
  assert.ok(c.issues[0].messages.some((m) => m.includes('최소가 용량최대보다 큼')));
});

test('오류: 허용 목록 밖 단위 (농도·용량·방식·종)', () => {
  assert.equal(catalogFrom(['a,약물A,50,ng/mL,,,둘다,,Y,'], [OK_DOSE]).drugs.length, 0);
  assert.equal(catalogFrom([OK_DRUG], ['a,개,1,3,mg/kg/day,,N']).drugs.length, 0);
  assert.equal(catalogFrom(['a,약물A,50,μg/mL,,,펌프,,Y,'], [OK_DOSE]).drugs.length, 0);
  assert.equal(catalogFrom([OK_DRUG], ['a,말,1,3,μg/kg/hr,,N']).drugs.length, 0);
});

test('오류: 용량 행이 하나도 없는 약물, 같은 종 용량 행 중복', () => {
  assert.equal(catalogFrom([OK_DRUG], []).drugs.length, 0);
  assert.equal(catalogFrom([OK_DRUG], [OK_DOSE, OK_DOSE]).drugs.length, 0);
});

test('µ(마이크로 기호)로 입력된 단위도 정상 인식', () => {
  const c = catalogFrom(['a,약물A,50,µg/mL,,,둘다,,Y,'], ['a,개,1,3,µg/kg/hr,,N']);
  assert.equal(c.drugs.length, 1);
  assert.equal(c.drugs[0].concUnit, 'μg/mL');
});

test('사용금지=Y 인 종은 용량 칸이 비어 있어도 오류가 아님', () => {
  const c = catalogFrom([OK_DRUG], [OK_DOSE, 'a,고양이,,,μg/kg/hr,금지 사유,Y']);
  assert.equal(c.drugs.length, 1);
  assert.equal(c.drugs[0].doses['고양이'].banned, true);
});

test('사용금지=N 인데 용량 칸이 비어 있으면 오류', () => {
  assert.equal(catalogFrom([OK_DRUG], ['a,개,,,μg/kg/hr,,N']).drugs.length, 0);
});

test('호환희석액은 쉼표로 나뉘어 목록이 됨', () => {
  const c = catalogFrom([OK_DRUG], [OK_DOSE]);
  assert.deepEqual(c.drugs[0].diluents, ['NS', 'D5W']);
});

// ---------- 표시 도구 ----------
test('parseNum: 숫자만 허용', () => {
  assert.equal(parseNum('12.5'), 12.5);
  assert.equal(parseNum(' 3 '), 3);
  assert.equal(parseNum('.5'), 0.5);
  for (const bad of ['', 'abc', '12abc', '1,000', '-3', '1e3', null, undefined]) {
    assert.ok(Number.isNaN(parseNum(bad)), `"${bad}" 는 NaN 이어야 함`);
  }
});

test('fmt: 소수점 3자리까지, 뒤의 0 생략, 천 단위 쉼표', () => {
  assert.equal(fmt(15), '15');
  assert.equal(fmt(19.8), '19.8');
  assert.equal(fmt(0.12), '0.12');
  assert.equal(fmt(1 / 3), '0.333');
  assert.equal(fmt(100000), '100,000');
  assert.equal(fmt(0.00042), '0.00042');
  assert.equal(fmt(NaN), '—');
});

test('esc: HTML 특수문자 변환', () => {
  assert.equal(esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
});

// ---------- 계산 과정 문구 ----------
test('계산 과정: 케이스 1 (수액 백)', () => {
  const p = {
    weight: 20, doseInput: 3, doseUnit: 'μg/kg/hr', dose: 3,
    concInput: 50, concUnit: 'μg/mL', conc: 50, bagVolume: 500, rate: 40,
  };
  p.result = calcBag({ weight: 20, dose: 3, conc: 50, bagVolume: 500, rate: 40 });
  const steps = bagSteps(p);
  assert.deepEqual(steps.map((s) => s.value), ['60', '1.5', '750', '15', '12.5']);
  assert.equal(steps[1].expr, '60 μg/hr ÷ 40 mL/hr');
});

test('계산 과정: 케이스 2 (시린지 B1) 와 케타민 단위 변환 줄', () => {
  const p = {
    weight: 10, doseInput: 1, doseUnit: 'μg/kg/hr', dose: 1,
    concInput: 500, concUnit: 'μg/mL', conc: 500, syringeVolume: 20, mode: 'rate',
  };
  p.result = calcSyringe({ weight: 10, dose: 1, conc: 500, syringeVolume: 20, mode: 'rate', rate: 2 });
  assert.deepEqual(syringeSteps(p).map((s) => s.value), ['10', '5', '100', '0.2', '19.8', '10']);

  const k = {
    weight: 10, doseInput: 2, doseUnit: 'μg/kg/min', dose: doseToStd(2, 'μg/kg/min'),
    concInput: 50, concUnit: 'mg/mL', conc: concToStd(50, 'mg/mL'), syringeVolume: 20, mode: 'rate',
  };
  k.result = calcSyringe({ weight: 10, dose: k.dose, conc: k.conc, syringeVolume: 20, mode: 'rate', rate: 2 });
  const ks = syringeSteps(k);
  assert.equal(ks[0].expr, '2 μg/kg/min × 60');
  assert.equal(ks[0].value, '120');
  assert.equal(ks[1].expr, '50 mg/mL × 1000');
  assert.equal(ks[1].value, '50,000');
});
