// 데이터 읽기·검증 (계산 로직과 완전히 분리됨)
// 구글 시트든 CSV 파일이든, "약물 탭"과 "용량 탭"의 행(row) 목록만 넘겨주면 된다.
// 나중에 옵시디언/노션으로 바꿔도 행 목록을 만들어 buildCatalog 에 넘기기만 하면 된다.
import { normalizeUnit } from './calc.js';

const SPECIES = ['개', '고양이'];
const CONC_UNITS = ['μg/mL', 'mg/mL'];
const DOSE_UNITS = ['μg/kg/hr', 'μg/kg/min', 'mg/kg/hr'];
const METHODS = ['백', '시린지', '둘다'];

// ---------- CSV 읽기 ----------
// CSV 글자 → [{헤더: 값, ...}, ...]. 따옴표 안의 쉼표·줄바꿈, BOM, 윈도우 줄바꿈 처리
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } // "" → 따옴표 글자 하나
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }

  // 완전히 빈 줄 제거
  const filled = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (filled.length === 0) return [];
  const headers = filled[0].map((h) => h.trim());
  return filled.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}

// ---------- 검사 도구 ----------
const clean = (v) => String(v ?? '').trim();

// 엄격한 숫자 검사: "12abc", "1,000", 빈칸은 모두 NaN
function strictNumber(v) {
  const t = clean(v);
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

const yn = (v) => clean(v).toUpperCase();

// ---------- 카탈로그 만들기 ----------
// 반환: { drugs: 화면에 표시할 약물, issues: 데이터 오류 목록, hiddenUnreviewed: 검수 전이라 숨긴 개수 }
export function buildCatalog(drugRows, doseRows, { includeUnreviewed = false } = {}) {
  const issues = new Map(); // 키 → { id, name, messages: Set }
  const addIssue = (key, id, name, message) => {
    if (!issues.has(key)) issues.set(key, { id, name, messages: new Set() });
    issues.get(key).messages.add(message);
  };

  // 약물 탭의 id 개수 (중복 검사용)
  const idCount = {};
  for (const row of drugRows) {
    const id = clean(row.id);
    if (id) idCount[id] = (idCount[id] || 0) + 1;
  }
  const drugIds = new Set(Object.keys(idCount));

  // 용량 탭: id별로 묶어서 검사
  const dosesById = {};   // id → { 종: {...} }
  const doseMsgs = {};    // id → [메시지]
  doseRows.forEach((row, idx) => {
    const id = clean(row.id);
    const line = idx + 2; // 시트에서 보이는 줄 번호 (1번 줄은 헤더)
    if (!id) {
      addIssue(`dose-line-${line}`, '(용량 탭)', `${line}번 줄`, 'id가 비어 있음');
      return;
    }
    if (!drugIds.has(id)) {
      addIssue(`dose-orphan-${id}`, id, '(용량 탭)', `용량 탭의 id "${id}" 가 약물 탭에 없음`);
      return;
    }
    const msgs = (doseMsgs[id] ||= []);
    const species = clean(row['종']);
    const tag = `용량(${species || '종 없음'})`;

    if (!SPECIES.includes(species)) { msgs.push(`${tag}: 종은 개/고양이만 가능`); return; }
    dosesById[id] ||= {};
    if (dosesById[id][species]) { msgs.push(`${tag}: 같은 종의 용량 행이 중복됨`); return; }

    const banned = yn(row['사용금지']);
    if (banned !== 'Y' && banned !== 'N') msgs.push(`${tag}: 사용금지는 Y/N만 가능`);

    const unit = normalizeUnit(row['용량단위']);
    if (!DOSE_UNITS.includes(unit)) msgs.push(`${tag}: 허용 목록 밖 용량단위 "${clean(row['용량단위'])}"`);

    const min = strictNumber(row['용량최소']);
    const max = strictNumber(row['용량최대']);
    const isBanned = banned === 'Y';
    const hasAny = clean(row['용량최소']) !== '' || clean(row['용량최대']) !== '';
    if (!isBanned || hasAny) {
      if (!(min > 0)) msgs.push(`${tag}: 용량최소는 0보다 큰 숫자여야 함 ("${clean(row['용량최소'])}")`);
      if (!(max > 0)) msgs.push(`${tag}: 용량최대는 0보다 큰 숫자여야 함 ("${clean(row['용량최대'])}")`);
      if (min > 0 && max > 0 && min > max) msgs.push(`${tag}: 용량최소가 용량최대보다 큼`);
    }

    dosesById[id][species] = {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      unit,
      speciesNote: clean(row['종별주의']),
      banned: isBanned,
    };
  });

  // 약물 탭 검사
  const drugs = [];
  let hiddenUnreviewed = 0;
  drugRows.forEach((row, idx) => {
    const id = clean(row.id);
    const name = clean(row['약물명']);
    const key = id || `drug-line-${idx + 2}`;
    const msgs = [];

    if (!id) msgs.push('id가 비어 있음');
    else if (idCount[id] > 1) msgs.push(`id "${id}" 가 중복됨`);
    if (!name) msgs.push('약물명이 비어 있음');

    const conc = strictNumber(row['원액농도']);
    if (!(conc > 0)) msgs.push(`원액농도는 0보다 큰 숫자여야 함 ("${clean(row['원액농도'])}")`);
    const concUnit = normalizeUnit(row['농도단위']);
    if (!CONC_UNITS.includes(concUnit)) msgs.push(`허용 목록 밖 농도단위 "${clean(row['농도단위'])}"`);
    const method = clean(row['방식']);
    if (!METHODS.includes(method)) msgs.push(`방식은 백/시린지/둘다만 가능 ("${method}")`);
    const reviewed = yn(row['검수완료']);
    if (reviewed !== 'Y' && reviewed !== 'N') msgs.push('검수완료는 Y/N만 가능');

    if (id) {
      msgs.push(...(doseMsgs[id] || []));
      if (!dosesById[id] || Object.keys(dosesById[id]).length === 0) msgs.push('용량 탭에 이 약물의 용량이 없음');
    }

    if (msgs.length > 0) {
      msgs.forEach((m) => addIssue(key, id, name, m));
      return; // 오류가 있으면 목록에서 숨김
    }

    if (reviewed !== 'Y' && !includeUnreviewed) { hiddenUnreviewed++; return; }

    drugs.push({
      id,
      name,
      conc,
      concUnit,
      diluents: clean(row['호환희석액']).split(',').map((s) => s.trim()).filter(Boolean),
      caution: clean(row['비호환·주의']),
      method,
      source: clean(row['출처']),
      reviewed: reviewed === 'Y',
      updated: clean(row['최종수정일']),
      doses: dosesById[id],
    });
  });

  return {
    drugs,
    issues: [...issues.values()].map((i) => ({ id: i.id, name: i.name, messages: [...i.messages] })),
    hiddenUnreviewed,
  };
}
