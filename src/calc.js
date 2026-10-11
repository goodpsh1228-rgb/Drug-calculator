// 계산 로직 (화면을 모르는 순수 계산 코드)
// 내부 단위: 용량 μg/kg/hr, 원액·농도 μg/mL, 속도 mL/hr, 양 μg, 부피 mL, 시간 hr

// ---------- 1. 단위 변환 ----------

// 용량 단위 → μg/kg/hr 로 바꾸는 배수표
const DOSE_TO_STD = {
  'μg/kg/hr': 1,
  'μg/kg/min': 60,
  'mg/kg/hr': 1000,
  'mg/kg/day': 1000 / 24,
};

// 원액 농도 단위 → μg/mL 로 바꾸는 배수표
const CONC_TO_STD = {
  'μg/mL': 1,
  'mg/mL': 1000,
};

// 숫자인지, 0보다 큰지 검사 (잘못된 입력은 계산 전에 막음)
function requirePositive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}은(는) 0보다 큰 숫자여야 합니다.`);
  }
}

// 용량을 μg/kg/hr 로 변환. 예) 20 μg/kg/min → 1200 μg/kg/hr
export function doseToStd(value, unit) {
  if (!(unit in DOSE_TO_STD)) throw new Error(`알 수 없는 용량 단위: ${unit}`);
  requirePositive(value, '용량');
  return value * DOSE_TO_STD[unit];
}

// 원액 농도를 μg/mL 로 변환. 예) 100 mg/mL → 100000 μg/mL
export function concToStd(value, unit) {
  if (!(unit in CONC_TO_STD)) throw new Error(`알 수 없는 농도 단위: ${unit}`);
  requirePositive(value, '원액 농도');
  return value * CONC_TO_STD[unit];
}

// 수액 속도를 mL/hr 로 변환. mL/kg/hr 이면 체중을 곱함. 예) 2 mL/kg/hr × 20 kg = 40 mL/hr
export function rateToMlHr(weight, value, unit) {
  requirePositive(weight, '체중');
  requirePositive(value, '속도');
  if (unit === 'mL/hr') return value;
  if (unit === 'mL/kg/hr') return weight * value;
  throw new Error(`알 수 없는 속도 단위: ${unit}`);
}

// ---------- 2. 공통 계산 ----------

// 시간당 필요량(μg/hr) = 체중 × 목표 용량
export function hourlyNeed(weight, doseStd) {
  return weight * doseStd;
}

// 용량 범위 밖이면 경고 문구를 돌려줌 (범위가 없으면 경고 없음)
function doseWarnings(doseStd, doseRange) {
  if (!doseRange) return [];
  const warnings = [];
  if (doseStd < doseRange.min || doseStd > doseRange.max) {
    warnings.push({
      code: 'DOSE_OUT_OF_RANGE',
      message: `용량 ${doseStd.toFixed(3)} μg/kg/hr 이(가) 참고 범위(${doseRange.min}~${doseRange.max}) 밖입니다.`,
    });
  }
  return warnings;
}

// 원액 주입량이 너무 작으면 경고 (정확히 주입하기 어려움)
function lowVolumeWarning(drugVolume) {
  if (drugVolume < 0.2 - 1e-9) {
    return [{
      code: 'LOW_STOCK_VOLUME',
      message: `원액 주입량 ${drugVolume.toFixed(3)} mL 는 0.2 mL 미만입니다. 2단계 희석을 권장합니다.`,
    }];
  }
  return [];
}

// ---------- 3. 방식 A: 수액 백 ----------
// 입력: weight(kg), dose(μg/kg/hr), conc(μg/mL), bagVolume(mL), rate(mL/hr)
export function calcBag({ weight, dose, conc, bagVolume, rate, doseRange }) {
  requirePositive(weight, '체중');
  requirePositive(dose, '용량');
  requirePositive(conc, '원액 농도');
  requirePositive(bagVolume, '백 용량');
  requirePositive(rate, '수액 속도');

  const errors = [];
  const warnings = [...doseWarnings(dose, doseRange)];

  // ① 백 필요 농도 = (W × D) ÷ R
  const requiredConc = hourlyNeed(weight, dose) / rate;
  // ② 총 약물량 = ① × V
  const totalDrug = requiredConc * bagVolume;
  // ③ 원액 주입량 = ② ÷ C
  const drugVolume = totalDrug / conc;
  // ④ 지속시간 = V ÷ R
  const duration = bagVolume / rate;

  if (drugVolume > bagVolume) {
    errors.push('원액 주입량이 백 용량보다 큽니다. 농도나 속도를 확인하세요.');
  }
  warnings.push(...lowVolumeWarning(drugVolume));

  return {
    requiredConc,
    totalDrug,
    drugVolume,
    duration,
    removeFromBag: drugVolume, // 백에서 먼저 빼낼 부피
    notes: [
      `백에서 약물 부피 ${drugVolume.toFixed(3)} mL 를 먼저 빼고 원액을 넣으세요.`,
      '수액 속도를 바꾸면 반드시 다시 계산하세요.',
    ],
    errors,
    warnings,
  };
}

// ---------- 4. 방식 B: 시린지 펌프 ----------
// 입력:
//   weight, dose(μg/kg/hr), conc(μg/mL), syringeVolume(mL)
//   mode: 'rate' (B1, 펌프 속도 먼저) 또는 'conc' (B2, 목표 농도 먼저)
//   rate(mL/hr) 또는 driveConc(μg/mL, 목표 농도)
//   pumpRange: { min, max } 펌프 속도 범위 (선택)
export function calcSyringe({
  weight, dose, conc, syringeVolume, mode,
  rate, driveConc, pumpRange, doseRange,
}) {
  requirePositive(weight, '체중');
  requirePositive(dose, '용량');
  requirePositive(conc, '원액 농도');
  requirePositive(syringeVolume, '시린지 용량');

  const errors = [];
  const warnings = [...doseWarnings(dose, doseRange)];

  let pumpRate;   // Rs: 펌프 속도 (mL/hr)
  let syringeConc; // 시린지 안 약물 농도 (μg/mL)

  if (mode === 'rate') {
    // B1: 펌프 속도를 먼저 정함 → ① 농도 = (W × D) ÷ Rs
    requirePositive(rate, '펌프 속도');
    pumpRate = rate;
    syringeConc = hourlyNeed(weight, dose) / pumpRate;
  } else if (mode === 'conc') {
    // B2: 목표 농도를 먼저 정함 → Rs = (W × D) ÷ Cd
    requirePositive(driveConc, '목표 농도');
    syringeConc = driveConc;
    pumpRate = hourlyNeed(weight, dose) / syringeConc;
  } else {
    throw new Error(`알 수 없는 시린지 계산 방식: ${mode}`);
  }

  // ② 총량 = ① × Vs
  const totalDrug = syringeConc * syringeVolume;
  // ③ 원액 주입량 = ② ÷ C
  const drugVolume = totalDrug / conc;
  // ④ 희석액 = Vs − ③
  const diluentVolume = syringeVolume - drugVolume;
  // ⑤ 지속시간 = Vs ÷ Rs
  const duration = syringeVolume / pumpRate;

  if (diluentVolume < 0) {
    errors.push('희석액이 음수입니다. 원액이 시린지 용량보다 많이 필요합니다. 농도나 속도를 확인하세요.');
  }
  warnings.push(...lowVolumeWarning(drugVolume));
  if (pumpRange && (pumpRate < pumpRange.min || pumpRate > pumpRange.max)) {
    warnings.push({
      code: 'PUMP_RATE_OUT_OF_RANGE',
      message: `펌프 속도 ${pumpRate.toFixed(3)} mL/hr 가 장비 범위(${pumpRange.min}~${pumpRange.max}) 밖입니다.`,
    });
  }

  return {
    pumpRate,
    syringeConc,
    totalDrug,
    drugVolume,
    diluentVolume,
    duration,
    errors,
    warnings,
  };
}
