// 시안 화면 동작: 약물 선택 → 입력 → 결과 패널
// 계산은 calc.js, 데이터는 data.js + source-csv.js, 과정 문구는 steps.js 를 그대로 쓴다.
// 이 파일은 화면과 연결만 담당한다.
import { calcBag, calcSyringe, doseToStd, concToStd, rateToMlHr } from './calc.js';
import { buildCatalog } from './data.js';
import { loadCsvFiles } from './source-csv.js';
import { parseNum, fmt, esc } from './format.js';
import { bagSteps, syringeSteps } from './steps.js';

// 주소 끝 ?preview=1 : 검수 전(N) 샘플 약물도 보이게 함
const PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
const $ = (id) => document.getElementById(id);

// 선 아이콘 (Lucide 스타일 경로를 직접 적음). 색은 CSS 가 정한다
const ICON = {
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
};
const svgIcon = (level) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[level === 'error' ? 'error' : 'alert']}</svg>`;
const alertsHtml = (list) => list
  .map((a) => `<div class="alert ${a.level}">${svgIcon(a.level)}<span>${esc(a.text)}</span></div>`)
  .join('');

let catalog = { drugs: [], issues: [], hiddenUnreviewed: 0 };
const state = { species: '개' };

const currentDrug = () => catalog.drugs.find((d) => d.id === $('drug').value);
const drugsForSpecies = () => catalog.drugs
  .filter((d) => d.doses[state.species])
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const plain = (x) => String(Number(x.toFixed(4)));
const durationText = (h) => {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh > 0 ? `${hh}시간 ${mm}분` : `${mm}분`;
};

// ---------- 화면 모드 (기기 설정 자동 + 수동) ----------
function setThemeMode(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
}
function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }

// ---------- 상단 알림 (미리보기, 데이터 오류, 불러오기 실패) ----------
function showNotice(level, text) {
  const box = $('notice');
  box.hidden = false;
  box.innerHTML = alertsHtml([{ level, text }]);
}

// ---------- 약물 목록과 약물 정보 ----------
function fillDrugs() {
  const previous = $('drug').value;
  const list = drugsForSpecies();
  $('drug').innerHTML = '<option value="">선택</option>' + list.map((d) => {
    const banned = d.doses[state.species].banned ? ' (사용금지)' : '';
    const unrev = d.reviewed ? '' : ' [미검수]';
    return `<option value="${esc(d.id)}">${esc(d.name)}${banned}${unrev}</option>`;
  }).join('');
  $('drug').value = list.some((d) => d.id === previous) ? previous : '';

  const hint = $('drugHint');
  hint.hidden = list.length > 0;
  let msg = '이 종에 표시할 약물이 없습니다. 검수완료(Y)된 약물만 표시됩니다.';
  if (catalog.hiddenUnreviewed > 0) msg += ` (검수 전 ${catalog.hiddenUnreviewed}개 숨김)`;
  hint.textContent = msg;
}

function setFacts(d) {
  const entry = d?.doses[state.species];
  if (!d) { $('facts').innerHTML = ''; $('drugAlerts').innerHTML = ''; return; }
  const rows = [];
  if (entry.banned) {
    rows.push(['참고 용량', '사용 금지']);
  } else {
    rows.push(['참고 용량', `${fmt(entry.min)} – ${fmt(entry.max)} ${entry.unit}`]);
  }
  rows.push(['원액 농도', `${fmt(d.conc)} ${d.concUnit}`]);
  rows.push(['가능한 방식', d.method]);
  rows.push(['출처', d.source || '미기재']);
  rows.push(['최종 수정일', d.updated || '미기재']);
  $('facts').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  const alerts = [];
  if (entry.banned) alerts.push({ level: 'error', text: `이 종(${state.species})에서는 사용 금지 약물입니다.${entry.speciesNote ? ' ' + entry.speciesNote : ''}` });
  else if (entry.speciesNote) alerts.push({ level: 'warn', text: `종별 주의: ${entry.speciesNote}` });
  if (d.caution) alerts.push({ level: 'warn', text: `비호환·주의: ${d.caution}` });
  if (!d.reviewed) alerts.push({ level: 'warn', text: '검수되지 않은 데이터입니다.' });
  $('drugAlerts').innerHTML = alertsHtml(alerts);
}

function onDrugChange() {
  const d = currentDrug();
  setFacts(d);
  const entry = d?.doses[state.species];
  $('doseUnit').textContent = d && !entry.banned ? entry.unit : '';
  if (d && !entry.banned) $('dose').value = plain((entry.min + entry.max) / 2); // 기본값 = 참고 범위 중간
  // 방식: 시트의 "방식" 칸에 따라 선택 제한
  const allowed = d ? (d.method === '둘다' ? ['백', '시린지'] : [d.method]) : ['백', '시린지'];
  $('m-bag').disabled = !allowed.includes('백');
  $('m-syr').disabled = !allowed.includes('시린지');
  if (d && !allowed.includes(currentMethod())) {
    (allowed[0] === '백' ? $('m-bag') : $('m-syr')).checked = true;
  }
  syncMethodForms();
  update();
}

const currentMethod = () => document.querySelector('input[name="method"]:checked').value;
const currentRateUnit = () => document.querySelector('input[name="rateUnit"]:checked').value;
const currentSyrMode = () => document.querySelector('input[name="syrMode"]:checked').value;

function syncMethodForms() {
  const bag = currentMethod() === '백';
  $('bagForm').hidden = !bag;
  $('syrForm').hidden = bag;
  $('rateUnit').textContent = currentRateUnit();
  const byRate = currentSyrMode() === 'rate';
  $('syrLabel').textContent = byRate ? '펌프 속도' : '시린지 농도';
  $('syrUnit').textContent = byRate ? 'mL/hr' : 'μg/mL';
}

// ---------- 결과 패널 ----------
function panelEmpty(drugName, text, alerts = []) {
  $('panelDrug').textContent = drugName || '약물을 선택하세요';
  $('panelSub').textContent = '';
  $('mainVal').textContent = '—';
  $('mainUnit').textContent = 'mL';
  $('mainLabel').textContent = text;
  $('kv').innerHTML = '';
  $('panelAlerts').innerHTML = alertsHtml(alerts);
  $('meta').textContent = '';
  $('steps').innerHTML = '';
}

function panelResult({ drug, sub, main, kv, alerts, meta, steps, mainNote }) {
  $('panelDrug').textContent = drug;
  $('panelSub').textContent = sub;
  $('mainVal').textContent = main;
  $('mainUnit').textContent = 'mL';
  $('mainLabel').textContent = mainNote;
  $('kv').innerHTML = kv.map((x) =>
    `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}<small>${esc(x.u)}</small></dd></div>`).join('');
  $('panelAlerts').innerHTML = alertsHtml(alerts);
  $('meta').textContent = meta;
  $('steps').innerHTML = steps.map((s) =>
    `<li><div class="st">${esc(s.title)}</div><div class="se">${esc(s.expr)}</div>`
    + `<div class="sv">= ${esc(s.value)}<small>${esc(s.unit)}</small></div></li>`).join('');
}

// ---------- 계산 ----------
function update() {
  const d = currentDrug();
  if (!d) return panelEmpty('', '약물을 고르면 결과가 나옵니다');
  const entry = d.doses[state.species];
  if (entry.banned) return panelEmpty(d.name, '사용 금지 약물이라 계산하지 않습니다');

  const weight = parseNum($('weight').value);
  if (!(weight > 0)) return panelEmpty(d.name, '체중을 입력하세요');
  const doseInput = parseNum($('dose').value);
  if (!(doseInput > 0)) return panelEmpty(d.name, '목표 용량을 입력하세요');

  try {
    const dose = doseToStd(doseInput, entry.unit);
    const conc = concToStd(d.conc, d.concUnit);
    const doseRange = { min: doseToStd(entry.min, entry.unit), max: doseToStd(entry.max, entry.unit) };
    const base = { weight, doseInput, doseUnit: entry.unit, dose, concInput: d.conc, concUnit: d.concUnit, conc };
    const sub = `${state.species} · ${fmt(weight)} kg`;
    const meta = `출처 ${d.source || '미기재'} · 최종 수정 ${d.updated || '미기재'}`;

    let calc;
    if (currentMethod() === '백') {
      const bagVolume = parseNum($('bagVolume').value);
      if (!(bagVolume > 0)) return panelEmpty(d.name, '백 용량을 입력하세요');
      const rateVal = parseNum($('rate').value);
      if (!(rateVal > 0)) return panelEmpty(d.name, '수액 속도를 입력하세요');
      const rate = rateToMlHr(weight, rateVal, currentRateUnit());
      calc = calcBag({ weight, dose, conc, bagVolume, rate, doseRange });
      if (calc.errors.length) return panelEmpty(d.name, '계산할 수 없는 입력입니다', calc.errors.map((e) => ({ level: 'error', text: e })));
      return panelResult({
        drug: `${d.name} · 수액 백`, sub, main: fmt(calc.drugVolume),
        mainNote: '원액 주입량 · 백에서 같은 부피를 먼저 빼고 넣기',
        kv: [
          { k: '백 필요 농도', v: fmt(calc.requiredConc), u: 'μg/mL' },
          { k: '총 약물량', v: fmt(calc.totalDrug), u: 'μg' },
          { k: '지속시간', v: fmt(calc.duration), u: `시간 (${durationText(calc.duration)})` },
          { k: '수액 속도', v: fmt(rate), u: `mL/hr · ${fmt(rate / weight)} mL/kg/hr` },
        ],
        alerts: warningsOf(calc, entry, d),
        meta, steps: bagSteps({ ...base, bagVolume, rate, result: calc }),
      });
    }

    const syringeVolume = parseNum($('syringeVolume').value);
    if (!(syringeVolume > 0)) return panelEmpty(d.name, '시린지 용량을 입력하세요');
    const v = parseNum($('syrInput').value);
    const byRate = currentSyrMode() === 'rate';
    if (!(v > 0)) return panelEmpty(d.name, byRate ? '펌프 속도를 입력하세요' : '시린지 농도를 입력하세요');
    calc = calcSyringe({
      weight, dose, conc, syringeVolume, mode: currentSyrMode(),
      rate: v, driveConc: v, doseRange,
    });
    if (calc.errors.length) return panelEmpty(d.name, '계산할 수 없는 입력입니다', calc.errors.map((e) => ({ level: 'error', text: e })));
    return panelResult({
      drug: `${d.name} · 시린지 펌프`, sub, main: fmt(calc.drugVolume),
      mainNote: '원액 주입량',
      kv: [
        { k: '희석액', v: fmt(calc.diluentVolume), u: 'mL' },
        { k: '시린지 농도', v: fmt(calc.syringeConc), u: 'μg/mL' },
        { k: '총 약물량', v: fmt(calc.totalDrug), u: 'μg' },
        { k: '펌프 속도', v: fmt(calc.pumpRate), u: `mL/hr · ${fmt(calc.pumpRate / weight)} mL/kg/hr` },
        { k: '지속시간', v: fmt(calc.duration), u: `시간 (${durationText(calc.duration)})` },
      ],
      alerts: warningsOf(calc, entry, d),
      meta, steps: syringeSteps({ ...base, syringeVolume, mode: currentSyrMode(), result: calc }),
    });
  } catch (e) {
    panelEmpty(d.name, '입력을 확인하세요', [{ level: 'error', text: e.message }]);
  }
}

// 계산 경고 + 종별 주의 + 체중 확인 + 미검수 (색만이 아니라 아이콘과 문구로 전달)
function warningsOf(calc, entry, d) {
  const list = calc.warnings.map((w) => ({ level: 'warn', text: w.message }));
  if (entry.speciesNote) list.push({ level: 'warn', text: `종별 주의: ${entry.speciesNote}` });
  if (!d.reviewed) list.push({ level: 'warn', text: '검수되지 않은 데이터입니다.' });
  return list;
}

// ---------- 연결과 시작 ----------
function wire() {
  document.querySelectorAll('input[name="themeMode"]').forEach((r) => r.addEventListener('change', () => {
    storeSet('theme', r.value);
    setThemeMode(r.value);
  }));
  document.querySelectorAll('input[name="species"]').forEach((r) => r.addEventListener('change', () => {
    state.species = r.value;
    fillDrugs();
    onDrugChange();
  }));
  $('drug').addEventListener('change', onDrugChange);
  document.querySelectorAll('input[name="method"], input[name="rateUnit"], input[name="syrMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (r.name === 'syrMode') $('syrInput').value = ''; // 단위가 바뀌므로 이전 값 지움
      syncMethodForms();
      update();
    }));
  ['weight', 'dose', 'bagVolume', 'rate', 'syringeVolume', 'syrInput'].forEach((id) =>
    $(id).addEventListener('input', update));
}

async function init() {
  const saved = storeGet('theme');
  const mode = saved === 'light' || saved === 'dark' ? saved : 'auto';
  setThemeMode(mode);
  $(`tm-${mode}`).checked = true;
  wire();

  try {
    const raw = await loadCsvFiles('data');
    catalog = buildCatalog(raw.drugRows, raw.doseRows, { includeUnreviewed: PREVIEW });
  } catch (e) {
    showNotice('error', `데이터를 불러오지 못했습니다. ${e.message}`);
  }
  if (PREVIEW) showNotice('warn', '미리보기: 검수되지 않은 샘플 데이터입니다. 임상에 사용하지 마세요.');
  if (catalog.issues.length) {
    showNotice('error', `데이터 오류 ${catalog.issues.length}건: 해당 약물은 숨김 처리되었습니다.`);
  }
  fillDrugs();
  onDrugChange();
}

init();
