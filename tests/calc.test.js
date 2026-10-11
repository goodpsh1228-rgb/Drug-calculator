// 자동 테스트: 손계산 결과와 비교
// 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doseToStd, concToStd, rateToMlHr, calcBag, calcSyringe, normalizeUnit,
} from '../src/calc.js';

// 소수점 오차를 허용하며 두 숫자가 같은지 비교
function assertClose(actual, expected, msg = '') {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${msg} 기대값 ${expected}, 실제값 ${actual}`,
  );
}

// ---------- 검증 케이스 1: 수액 백 (방식 A) ----------
test('케이스 1: 20kg 개, 펜타닐 3 μg/kg/hr, 원액 50 μg/mL, 500mL 백, 40 mL/hr', () => {
  const rate = rateToMlHr(20, 40, 'mL/hr');
  const r = calcBag({ weight: 20, dose: 3, conc: 50, bagVolume: 500, rate });

  assertClose(r.requiredConc, 1.5, '농도');
  assertClose(r.totalDrug, 750, '총 약물량');
  assertClose(r.drugVolume, 15, '원액 주입량');
  assertClose(r.duration, 12.5, '지속시간');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('케이스 1 (mL/kg/hr 입력): 2 mL/kg/hr × 20kg = 40 mL/hr 로 같은 결과', () => {
  const rate = rateToMlHr(20, 2, 'mL/kg/hr');
  assertClose(rate, 40, '속도 변환');
  const r = calcBag({ weight: 20, dose: 3, conc: 50, bagVolume: 500, rate });
  assertClose(r.requiredConc, 1.5);
  assertClose(r.duration, 12.5);
});

// ---------- 검증 케이스 2: 시린지 펌프 (방식 B1) ----------
test('케이스 2: 10kg 개, 덱스메데토미딘 1 μg/kg/hr, 원액 500 μg/mL, 20mL 시린지, 2 mL/hr', () => {
  const r = calcSyringe({
    weight: 10, dose: 1, conc: 500, syringeVolume: 20, mode: 'rate', rate: 2,
  });

  assertClose(r.syringeConc, 5, '농도');
  assertClose(r.totalDrug, 100, '총 약물량');
  assertClose(r.drugVolume, 0.2, '원액 주입량');
  assertClose(r.diluentVolume, 19.8, '희석액');
  assertClose(r.duration, 10, '지속시간');
  assert.deepEqual(r.errors, []);
});

test('케이스 2 (B2, 목표 농도 5 μg/mL 먼저 입력): 펌프 속도 2 mL/hr 로 같은 결과', () => {
  const r = calcSyringe({
    weight: 10, dose: 1, conc: 500, syringeVolume: 20, mode: 'conc', driveConc: 5,
  });
  assertClose(r.pumpRate, 2, '펌프 속도');
  assertClose(r.totalDrug, 100);
  assertClose(r.diluentVolume, 19.8);
  assertClose(r.duration, 10);
});

// ---------- 검증 케이스 3: 단위 변환 (케타민) ----------
test('케이스 3: 케타민 μg/kg/min 입력은 ×60 으로 μg/kg/hr 가 된다', () => {
  assertClose(doseToStd(2, 'μg/kg/min'), 120);
  assertClose(doseToStd(10, 'μg/kg/min'), 600);
});

test('케이스 3: 다른 용량 단위 변환 (mg/kg/hr ×1000, mg/kg/day ×1000÷24)', () => {
  assertClose(doseToStd(0.5, 'mg/kg/hr'), 500);
  assertClose(doseToStd(1, 'mg/kg/day'), 1000 / 24);
  assertClose(doseToStd(24, 'mg/kg/day'), 1000);
});

test('케이스 3: 농도 mg/mL → μg/mL 변환 (×1000)', () => {
  assertClose(concToStd(100, 'mg/mL'), 100000);
  assertClose(concToStd(50, 'μg/mL'), 50);
});

test('케이스 3 (끝까지): 10kg 케타민 2 μg/kg/min, 원액 100 mg/mL, 20mL 시린지, 2 mL/hr', () => {
  const dose = doseToStd(2, 'μg/kg/min');        // 120 μg/kg/hr
  const conc = concToStd(100, 'mg/mL');          // 100000 μg/mL
  const r = calcSyringe({
    weight: 10, dose, conc, syringeVolume: 20, mode: 'rate', rate: 2,
  });

  assertClose(r.syringeConc, 600, '농도');        // (10×120)÷2
  assertClose(r.totalDrug, 12000, '총 약물량');
  assertClose(r.drugVolume, 0.12, '원액 주입량');
  assertClose(r.diluentVolume, 19.88, '희석액');
  assertClose(r.duration, 10, '지속시간');
  // 0.2 mL 미만이므로 2단계 희석 경고가 나와야 함
  assert.equal(r.warnings[0].code, 'LOW_STOCK_VOLUME');
});

// ---------- 경고와 오류 ----------
test('희석액이 음수면 오류 (원액이 시린지보다 많이 필요)', () => {
  const r = calcSyringe({
    weight: 10, dose: 100, conc: 10, syringeVolume: 5, mode: 'rate', rate: 1,
  });
  assert.ok(r.errors.length > 0);
});

test('용량이 참고 범위 밖이면 경고', () => {
  const r = calcBag({
    weight: 20, dose: 3, conc: 50, bagVolume: 500, rate: 40,
    doseRange: { min: 1, max: 2 },
  });
  assert.equal(r.warnings[0].code, 'DOSE_OUT_OF_RANGE');
});

test('펌프 속도가 장비 범위 밖이면 경고', () => {
  const r = calcSyringe({
    weight: 10, dose: 1, conc: 500, syringeVolume: 20, mode: 'rate', rate: 2,
    pumpRange: { min: 5, max: 100 },
  });
  assert.equal(r.warnings[0].code, 'PUMP_RATE_OUT_OF_RANGE');
});

test('잘못된 입력은 오류를 던짐 (0, 음수, 글자, 모르는 단위)', () => {
  assert.throws(() => doseToStd(0, 'μg/kg/hr'));
  assert.throws(() => doseToStd(-1, 'μg/kg/hr'));
  assert.throws(() => doseToStd('abc', 'μg/kg/hr'));
  assert.throws(() => doseToStd(1, 'g/kg/hr'));
  assert.throws(() => concToStd(1, 'ng/mL'));
  assert.throws(() => rateToMlHr(10, 2, 'L/hr'));
});

// ---------- 추가 검토 테스트 ----------
test('수액 백: 원액 주입량이 백 용량보다 크면 오류', () => {
  const r = calcBag({ weight: 50, dose: 100, conc: 1, bagVolume: 100, rate: 10 });
  assert.ok(r.errors.length > 0);
});

test('수액 백: 원액 주입량 0.2 mL 미만이면 2단계 희석 경고', () => {
  const r = calcBag({ weight: 5, dose: 1, conc: 500, bagVolume: 100, rate: 10 });
  // 농도 0.5 → 총 50 μg → 원액 0.1 mL
  assertClose(r.drugVolume, 0.1);
  assert.ok(r.warnings.some((w) => w.code === 'LOW_STOCK_VOLUME'));
});

test('용량 범위 경계값(최소·최대 정확히 일치)은 경고 없음', () => {
  const base = { weight: 20, conc: 50, bagVolume: 500, rate: 40, doseRange: { min: 1, max: 3 } };
  assert.deepEqual(calcBag({ ...base, dose: 1 }).warnings, []);
  assert.deepEqual(calcBag({ ...base, dose: 3 }).warnings, []);
  assert.equal(calcBag({ ...base, dose: 3.01 }).warnings[0].code, 'DOSE_OUT_OF_RANGE');
});

test('단위 표기: µ(마이크로 기호)와 μ(그리스 문자), 앞뒤 공백을 같게 취급', () => {
  assert.equal(normalizeUnit(' µg/kg/min '), 'μg/kg/min');
  assertClose(doseToStd(2, 'µg/kg/min'), 120);
  assertClose(concToStd(50, 'µg/mL'), 50);
});

test('단위 표기: 객체 내장 이름(toString 등)은 단위로 인정하지 않음', () => {
  assert.throws(() => doseToStd(1, 'toString'));
  assert.throws(() => concToStd(1, 'constructor'));
});

test('시린지: 모르는 계산 방식은 오류', () => {
  assert.throws(() => calcSyringe({
    weight: 10, dose: 1, conc: 500, syringeVolume: 20, mode: 'x', rate: 2,
  }));
});

test('일관성: 무작위 입력 500회에서 수식 항등식이 항상 성립', () => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 500; i++) {
    const weight = rnd(1, 60);
    const dose = rnd(0.1, 50);
    const conc = rnd(10, 100000);
    const rate = rnd(0.5, 200);
    const vol = rnd(5, 1000);

    // 백: 시간당 투여되는 약물량(농도×속도)은 필요량(체중×용량)과 같아야 함
    const bag = calcBag({ weight, dose, conc, bagVolume: vol, rate });
    assertClose(bag.requiredConc * rate / (weight * dose), 1, '백 질량 보존') ;
    assertClose(bag.drugVolume * conc, bag.totalDrug, '백 원액량×농도=총량');

    // 시린지 B1: 원액 + 희석액 = 시린지 용량
    const b1 = calcSyringe({ weight, dose, conc, syringeVolume: vol, mode: 'rate', rate });
    assertClose(b1.drugVolume + b1.diluentVolume, vol, 'B1 부피 합');
    assertClose(b1.syringeConc * b1.pumpRate / (weight * dose), 1, 'B1 질량 보존');

    // B1 의 농도를 B2 에 넣으면 같은 펌프 속도·같은 결과가 나와야 함
    const b2 = calcSyringe({ weight, dose, conc, syringeVolume: vol, mode: 'conc', driveConc: b1.syringeConc });
    assertClose(b2.pumpRate / rate, 1, 'B1↔B2 속도');
    assertClose(b2.totalDrug / b1.totalDrug, 1, 'B1↔B2 총량');
    assertClose(b2.duration / b1.duration, 1, 'B1↔B2 시간');
  }
});
