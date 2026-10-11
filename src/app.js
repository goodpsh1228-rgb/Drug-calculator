// 화면 동작: 입력을 읽고 → 계산 로직을 부르고 → 결과를 그린다.
// 계산은 calc.js, 데이터는 data.js + source-csv.js, 계산 과정 문구는 steps.js 가 맡고,
// 이 파일은 화면과의 "연결"만 한다.
import { calcBag, calcSyringe, doseToStd, concToStd, rateToMlHr } from './calc.js';
import { buildCatalog } from './data.js';
import { loadCsvFiles } from './source-csv.js';
import { parseNum, fmt, esc } from './format.js';
import { bagSteps, syringeSteps } from './steps.js';

// 주소 끝 ?preview=1 : 검수 전(N) 샘플 약물도 보이게 함 (경고 띠가 항상 표시됨)
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
const chevron = '<svg class="row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

let catalog = { drugs: [], issues: [], hiddenUnreviewed: 0 };
const state = { species: '개', detailId: '' };
const notices = [];

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
const currentMethod = () => document.querySelector('input[name="method"]:checked').value;
const currentRateUnit = () => document.querySelector('input[name="rateUnit"]:checked').value;
const currentSyrMode = () => document.querySelector('input[name="syrMode"]:checked').value;

// 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 앱은 정상 동작해야 함
function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }

// ---------- 화면 모드 (기기 설정 자동 + 수동) ----------
function setThemeMode(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
}

// ---------- 상단 알림 (미리보기, 데이터 오류, 불러오기 실패) ----------
function addNotice(level, text) {
  notices.push({ level, text });
  $('notice').innerHTML = alertsHtml(notices);
}

// ---------- 탭 ----------
function setTab(name) {
  ['calc', 'drugs', 'info'].forEach((t) => { $(`view-${t}`).hidden = t !== name; });
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  if (name === 'drugs') showDrugList();
  if (name === 'info') renderInfo();
  window.scrollTo(0, 0);
}

// ---------- 종 (계산 탭과 약물 탭의 선택이 서로 연동됨) ----------
function setSpecies(value) {
  state.species = value;
  document.querySelectorAll('input[name="species"], input[name="species2"]').forEach((r) => { r.checked = r.value === value; });
  fillDrugs();
  onDrugChange();
  renderDrugList();
  if (state.detailId) showDrugDetail(state.detailId);
}

// ---------- 약물 목록과 약물 정보 ----------
function emptyMessage() {
  let msg = '표시할 약물이 없습니다. 검수완료(Y)된 약물만 표시됩니다.';
  if (catalog.hiddenUnreviewed > 0) msg += ` (검수 전 ${catalog.hiddenUnreviewed}개 숨김)`;
  return msg;
}

function fillDrugs() {
  const previous = $('drug').value;
  const list = drugsForSpecies();
  $('drug').innerHTML = '<option value="">선택</option>' + list.map((d) => {
    const banned = d.doses[state.species].banned ? ' (사용금지)' : '';
    const unrev = d.reviewed ? '' : ' [미검수]';
    return `<option value="${esc(d.id)}">${esc(d.name)}${banned}${unrev}</option>`;
  }).join('');
  $('drug').value = list.some((d) => d.id === previous) ? previous : '';
  $('drugHint').hidden = list.length > 0;
  $('drugHint').textContent = emptyMessage();
}

const rowsHtml = (list) => list.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

// 계산 탭의 약물 정보: 핵심 2줄 + 접이식 3줄, 주의는 한 줄씩 (아이콘 + 문구)
function setFacts(d) {
  const entry = d?.doses[state.species];
  if (!d) {
    $('facts').innerHTML = ''; $('factsExtra').innerHTML = ''; $('factsMore').hidden = true; $('drugAlerts').innerHTML = '';
    return;
  }
  $('facts').innerHTML = rowsHtml([
    ['참고 용량', entry.banned ? '사용 금지' : `${fmt(entry.min)} – ${fmt(entry.max)} ${entry.unit}`],
    ['원액 농도', `${fmt(d.conc)} ${d.concUnit}`],
  ]);
  $('factsExtra').innerHTML = rowsHtml([
    ['가능한 방식', d.method],
    ['출처', d.source || '미기재'],
    ['최종 수정일', d.updated || '미기재'],
  ]);
  $('factsMore').hidden = false;

  const alerts = [];
  if (entry.banned) alerts.push({ level: 'error', text: `이 종(${state.species})에서는 사용 금지 약물입니다.${entry.speciesNote ? ' ' + entry.speciesNote : ''}` });
  else if (entry.speciesNote) alerts.push({ level: 'warn', text: `종별 주의: ${entry.speciesNote}` });
  if (d.caution) alerts.push({ level: 'warn', text: `비호환·주의: ${d.caution}` });
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

function syncMethodForms() {
  const bag = currentMethod() === '백';
  $('bagForm').hidden = !bag;
  $('syrForm').hidden = bag;
  $('rateUnit').textContent = currentRateUnit();
  const byRate = currentSyrMode() === 'rate';
  $('syrLabel').textContent = byRate ? '펌프 속도' : '시린지 농도';
  $('syrUnit').textContent = byRate ? 'mL/hr' : 'μg/mL';
}

// ---------- 약물 탭: 목록 → 상세 (About 스타일) ----------
function renderDrugList() {
  const list = drugsForSpecies();
  $('drugList').innerHTML = list.map((d) => {
    const e = d.doses[state.species];
    const sub = e.banned ? '사용금지' : `${fmt(e.min)} – ${fmt(e.max)} ${esc(e.unit)}`;
    const tags = (e.banned ? '<span class="badge error">사용금지</span>' : '')
      + (d.reviewed ? '' : '<span class="badge warn">미검수</span>');
    return `<button type="button" class="row" data-id="${esc(d.id)}">`
      + `<span class="row-label">${esc(d.name)}${tags}<small>${sub} · ${esc(d.method)}</small></span>${chevron}</button>`;
  }).join('');
  $('drugListEmpty').hidden = list.length > 0;
  $('drugListEmpty').textContent = emptyMessage();
}

function showDrugList() {
  state.detailId = '';
  $('drugListView').hidden = false;
  $('drugDetailView').hidden = true;
  $('drugBack').hidden = true;
  $('drugsTitle').textContent = '약물';
  renderDrugList();
}

function aboutHtml(d, entry) {
  const kv = (list) => `<section class="card"><dl class="facts">${rowsHtml(list)}</dl></section>`;
  const dose = [];
  if (!entry.banned) dose.push(['참고 용량', `${fmt(entry.min)} – ${fmt(entry.max)} ${entry.unit}`]);
  dose.push(['원액 농도', `${fmt(d.conc)} ${d.concUnit}`], ['가능한 방식', d.method]);
  if (d.diluents.length) dose.push(['호환 희석액', d.diluents.join(', ')]);

  const notes = [];
  if (entry.banned) notes.push({ level: 'error', text: `이 종(${state.species})에서는 사용 금지 약물입니다.${entry.speciesNote ? ' ' + entry.speciesNote : ''}` });
  else if (entry.speciesNote) notes.push({ level: 'warn', text: `종별 주의: ${entry.speciesNote}` });
  if (d.caution) notes.push({ level: 'warn', text: `비호환·주의: ${d.caution}` });

  return `<div class="group"><h2 class="sec">용량과 농도</h2>${kv(dose)}</div>`
    + (notes.length ? `<div class="group"><h2 class="sec">주의사항</h2><section class="card"><div class="alerts" style="border:0">${alertsHtml(notes)}</div></section></div>` : '')
    + `<div class="group"><h2 class="sec">출처</h2>${kv([
      ['출처', d.source || '미기재'],
      ['최종 수정일', d.updated || '미기재'],
      ['검수', d.reviewed ? '완료' : '검수되지 않음'],
    ])}</div>`;
}

function showDrugDetail(id) {
  const d = catalog.drugs.find((x) => x.id === id);
  if (!d || !d.doses[state.species]) { showDrugList(); return; }
  state.detailId = id;
  $('drugListView').hidden = true;
  $('drugDetailView').hidden = false;
  $('drugBack').hidden = false;
  $('drugsTitle').textContent = d.name;
  $('drugDetail').innerHTML = aboutHtml(d, d.doses[state.species]);
  $('useDrugBtn').hidden = d.doses[state.species].banned;
}

// ---------- 정보·출처 탭 ----------
function renderInfo() {
  const row = (k, v) => `<div class="row"><span class="label">${esc(k)}</span><span class="row-value">${v}</span></div>`;
  $('dataStatus').innerHTML = row('표시 중인 약물', `${catalog.drugs.length}개`)
    + row('검수 전이라 숨김', `${catalog.hiddenUnreviewed}개`)
    + row('데이터 오류', catalog.issues.length ? `<span class="badge error">${catalog.issues.length}건</span>` : '없음');
  $('issuesList').innerHTML = alertsHtml(catalog.issues.map((i) => ({
    level: 'error', text: `${i.name || i.id}: ${i.messages.join(' / ')}`,
  })));
  $('sourceList').innerHTML = catalog.drugs.length
    ? catalog.drugs.map((d) => `<div class="row"><span class="row-label">${esc(d.name)}<small>최종 수정일 ${esc(d.updated || '미기재')}</small></span>`
      + `<span class="row-value">${d.source ? esc(d.source) : '<span class="badge warn">출처 미기재</span>'}</span></div>`).join('')
    : `<div class="row"><span class="label">${esc(emptyMessage())}</span></div>`;
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

// 계산 경고 + 종별 주의 + 체중 확인 + 미검수 (색만이 아니라 아이콘과 문구로 전달)
function warningsOf(calc, entry, d, weight) {
  const list = calc.warnings.map((w) => ({ level: 'warn', text: w.message }));
  if (entry.speciesNote) list.push({ level: 'warn', text: `종별 주의: ${entry.speciesNote}` });
  if (weight < 0.2 || weight > 100 || (state.species === '고양이' && weight > 10)) {
    list.push({ level: 'warn', text: `입력한 체중 ${fmt(weight)} kg 이(가) 이 종의 일반 범위를 벗어났습니다. 단위와 소수점을 확인하세요.` });
  }
  if (!d.reviewed) list.push({ level: 'warn', text: '검수되지 않은 데이터입니다.' });
  return list;
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
    const errorsOf = (calc) => calc.errors.map((e) => ({ level: 'error', text: e }));

    if (currentMethod() === '백') {
      const bagVolume = parseNum($('bagVolume').value);
      if (!(bagVolume > 0)) return panelEmpty(d.name, '백 용량을 입력하세요');
      const rateVal = parseNum($('rate').value);
      if (!(rateVal > 0)) return panelEmpty(d.name, '수액 속도를 입력하세요');
      const rate = rateToMlHr(weight, rateVal, currentRateUnit());
      const calc = calcBag({ weight, dose, conc, bagVolume, rate, doseRange });
      if (calc.errors.length) return panelEmpty(d.name, '계산할 수 없는 입력입니다', errorsOf(calc));
      return panelResult({
        drug: `${d.name} · 수액 백`, sub, main: fmt(calc.drugVolume),
        mainNote: '원액 주입량 · 백에서 같은 부피를 먼저 빼고 넣기',
        kv: [
          { k: '백 필요 농도', v: fmt(calc.requiredConc), u: 'μg/mL' },
          { k: '총 약물량', v: fmt(calc.totalDrug), u: 'μg' },
          { k: `지속시간 · ${durationText(calc.duration)}`, v: fmt(calc.duration), u: '시간' },
          { k: '수액 속도', v: fmt(rate), u: `mL/hr · ${fmt(rate / weight)} mL/kg/hr` },
        ],
        alerts: warningsOf(calc, entry, d, weight),
        meta, steps: bagSteps({ ...base, bagVolume, rate, result: calc }),
      });
    }

    const syringeVolume = parseNum($('syringeVolume').value);
    if (!(syringeVolume > 0)) return panelEmpty(d.name, '시린지 용량을 입력하세요');
    const v = parseNum($('syrInput').value);
    const byRate = currentSyrMode() === 'rate';
    if (!(v > 0)) return panelEmpty(d.name, byRate ? '펌프 속도를 입력하세요' : '시린지 농도를 입력하세요');
    // 장비 설정(정보·출처 탭)의 펌프 속도 범위. 비워 두면 범위 경고는 없음
    const pm = parseNum($('pumpMin').value);
    const pM = parseNum($('pumpMax').value);
    const pumpRange = (Number.isFinite(pm) || Number.isFinite(pM))
      ? { min: Number.isFinite(pm) ? pm : 0, max: Number.isFinite(pM) ? pM : Infinity }
      : undefined;
    const calc = calcSyringe({
      weight, dose, conc, syringeVolume, mode: currentSyrMode(),
      rate: v, driveConc: v, pumpRange, doseRange,
    });
    if (calc.errors.length) return panelEmpty(d.name, '계산할 수 없는 입력입니다', errorsOf(calc));
    return panelResult({
      drug: `${d.name} · 시린지 펌프`, sub, main: fmt(calc.drugVolume),
      mainNote: '원액 주입량',
      kv: [
        { k: '희석액', v: fmt(calc.diluentVolume), u: 'mL' },
        { k: '시린지 농도', v: fmt(calc.syringeConc), u: 'μg/mL' },
        { k: '총 약물량', v: fmt(calc.totalDrug), u: 'μg' },
        { k: '펌프 속도', v: fmt(calc.pumpRate), u: `mL/hr · ${fmt(calc.pumpRate / weight)} mL/kg/hr` },
        { k: `지속시간 · ${durationText(calc.duration)}`, v: fmt(calc.duration), u: '시간' },
      ],
      alerts: warningsOf(calc, entry, d, weight),
      meta, steps: syringeSteps({ ...base, syringeVolume, mode: currentSyrMode(), result: calc }),
    });
  } catch (e) {
    return panelEmpty(d.name, '입력을 확인하세요', [{ level: 'error', text: e.message }]);
  }
}

// ---------- 연결과 시작 ----------
function wire() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.querySelectorAll('input[name="species"], input[name="species2"]').forEach((r) =>
    r.addEventListener('change', () => setSpecies(r.value)));
  $('drug').addEventListener('change', onDrugChange);

  document.querySelectorAll('input[name="method"], input[name="rateUnit"], input[name="syrMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (r.name === 'syrMode') $('syrInput').value = ''; // 단위가 바뀌므로 이전 값 지움
      syncMethodForms();
      update();
    }));
  ['weight', 'dose', 'bagVolume', 'rate', 'syringeVolume', 'syrInput'].forEach((id) =>
    $(id).addEventListener('input', update));
  ['pumpMin', 'pumpMax'].forEach((id) =>
    $(id).addEventListener('input', () => { storeSet(id, $(id).value); update(); }));

  // 약물 탭
  $('drugList').addEventListener('click', (ev) => {
    const row = ev.target.closest('button[data-id]');
    if (row) { showDrugDetail(row.dataset.id); window.scrollTo(0, 0); }
  });
  $('drugBack').addEventListener('click', showDrugList);
  $('useDrugBtn').addEventListener('click', () => {
    $('drug').value = state.detailId;
    onDrugChange();
    setTab('calc');
  });

  // 화면 모드
  document.querySelectorAll('input[name="themeMode"]').forEach((r) => r.addEventListener('change', () => {
    storeSet('theme', r.value);
    setThemeMode(r.value);
  }));
}

async function init() {
  const saved = storeGet('theme');
  const mode = saved === 'light' || saved === 'dark' ? saved : 'auto';
  setThemeMode(mode);
  $(`tm-${mode}`).checked = true;
  $('pumpMin').value = storeGet('pumpMin') ?? '';
  $('pumpMax').value = storeGet('pumpMax') ?? '';
  wire();

  try {
    const raw = await loadCsvFiles('data');
    catalog = buildCatalog(raw.drugRows, raw.doseRows, { includeUnreviewed: PREVIEW });
  } catch (e) {
    addNotice('error', `데이터를 불러오지 못했습니다. ${e.message} (파일을 직접 열지 말고 배포된 주소로 접속하세요.)`);
  }
  if (PREVIEW) addNotice('warn', '미리보기: 검수되지 않은 샘플 데이터입니다. 임상에 사용하지 마세요.');
  if (catalog.issues.length) {
    addNotice('error', `데이터 오류 ${catalog.issues.length}건: 해당 약물은 숨김 처리되었습니다. (정보·출처 탭에서 확인)`);
  }
  fillDrugs();
  onDrugChange();
  renderDrugList();
}

init();
