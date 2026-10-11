// 계산 과정(단계별 수식) 문구 만들기
// 각 줄: { title: 이름, expr: 숫자를 넣은 수식, value: 결과 숫자, unit: 단위 }
import { fmt } from './format.js';

const DOSE_FACTOR_TEXT = {
  'μg/kg/min': '× 60',
  'mg/kg/hr': '× 1000',
  'mg/kg/day': '× 1000 ÷ 24',
};
const CONC_FACTOR_TEXT = { 'mg/mL': '× 1000' };

// 단위 변환 줄 (이미 μg 단위면 줄이 없음)
function conversionSteps(p) {
  const lines = [];
  if (p.doseUnit !== 'μg/kg/hr') {
    lines.push({
      title: '용량 단위 변환',
      expr: `${fmt(p.doseInput)} ${p.doseUnit} ${DOSE_FACTOR_TEXT[p.doseUnit]}`,
      value: fmt(p.dose),
      unit: 'μg/kg/hr',
    });
  }
  if (p.concUnit !== 'μg/mL') {
    lines.push({
      title: '원액 농도 단위 변환',
      expr: `${fmt(p.concInput)} ${p.concUnit} ${CONC_FACTOR_TEXT[p.concUnit]}`,
      value: fmt(p.conc),
      unit: 'μg/mL',
    });
  }
  lines.push({
    title: '시간당 필요량 = 체중 × 목표 용량',
    expr: `${fmt(p.weight)} kg × ${fmt(p.dose)} μg/kg/hr`,
    value: fmt(p.weight * p.dose),
    unit: 'μg/hr',
  });
  return lines;
}

// 방식 A: 수액 백
export function bagSteps(p) {
  const r = p.result;
  const need = fmt(p.weight * p.dose);
  return [
    ...conversionSteps(p),
    {
      title: '① 백 필요 농도 = (W × D) ÷ R',
      expr: `${need} μg/hr ÷ ${fmt(p.rate)} mL/hr`,
      value: fmt(r.requiredConc),
      unit: 'μg/mL',
    },
    {
      title: '② 총 약물량 = ① × V',
      expr: `${fmt(r.requiredConc)} μg/mL × ${fmt(p.bagVolume)} mL`,
      value: fmt(r.totalDrug),
      unit: 'μg',
    },
    {
      title: '③ 원액 주입량 = ② ÷ C',
      expr: `${fmt(r.totalDrug)} μg ÷ ${fmt(p.conc)} μg/mL`,
      value: fmt(r.drugVolume),
      unit: 'mL',
    },
    {
      title: '④ 지속시간 = V ÷ R',
      expr: `${fmt(p.bagVolume)} mL ÷ ${fmt(p.rate)} mL/hr`,
      value: fmt(r.duration),
      unit: '시간',
    },
  ];
}

// 방식 B: 시린지 펌프 (mode 'rate' = B1, 'conc' = B2)
export function syringeSteps(p) {
  const r = p.result;
  const need = fmt(p.weight * p.dose);
  const head = p.mode === 'rate'
    ? {
      title: '① 시린지 농도 = (W × D) ÷ Rs',
      expr: `${need} μg/hr ÷ ${fmt(r.pumpRate)} mL/hr`,
      value: fmt(r.syringeConc),
      unit: 'μg/mL',
    }
    : {
      title: '펌프 속도 Rs = (W × D) ÷ Cd',
      expr: `${need} μg/hr ÷ ${fmt(r.syringeConc)} μg/mL`,
      value: fmt(r.pumpRate),
      unit: 'mL/hr',
    };
  return [
    ...conversionSteps(p),
    head,
    {
      title: '② 총량 = 농도 × Vs',
      expr: `${fmt(r.syringeConc)} μg/mL × ${fmt(p.syringeVolume)} mL`,
      value: fmt(r.totalDrug),
      unit: 'μg',
    },
    {
      title: '③ 원액 주입량 = ② ÷ C',
      expr: `${fmt(r.totalDrug)} μg ÷ ${fmt(p.conc)} μg/mL`,
      value: fmt(r.drugVolume),
      unit: 'mL',
    },
    {
      title: '④ 희석액 = Vs − ③',
      expr: `${fmt(p.syringeVolume)} mL − ${fmt(r.drugVolume)} mL`,
      value: fmt(r.diluentVolume),
      unit: 'mL',
    },
    {
      title: '⑤ 지속시간 = Vs ÷ Rs',
      expr: `${fmt(p.syringeVolume)} mL ÷ ${fmt(r.pumpRate)} mL/hr`,
      value: fmt(r.duration),
      unit: '시간',
    },
  ];
}
