// 화면 동작: 입력을 읽고 → 계산 로직을 부르고 → 결과를 그린다.
// 계산은 calc.js, 데이터 검증은 data.js 가 맡고, 이 파일은 "연결"만 한다.
import { calcBag, calcSyringe, doseToStd, concToStd, rateToMlHr } from './calc.js';
import { buildCatalog } from './data.js';
import { loadCsvFiles } from './source-csv.js';
import { parseNum, fmt, esc } from './format.js';
import { bagSteps, syringeSteps } from './steps.js';

// 주소 끝에 ?preview=1 을 붙이면 검수 전(N) 샘플 약물도 보임 (빨간 경고 띠가 항상 표시됨)
const PREVIEW = new URLSearchParams(location.search).get('preview') === '1';

const $ = (id) => document.getElementById(id);
const el = {
  weight: $('weight'), drug: $('drug'), emptyHint: $('emptyHint'), aboutCompact: $('aboutCompact'),
  doseGroup: $('doseGroup'), dose: $('dose'), doseUnit: $('doseUnit'),
  methodGroup: $('methodGroup'), bagForm: $('bagForm'), syrForm: $('syrForm'),
  bagVolume: $('bagVolume'), rate: $('rate'), rateUnitLabel: $('rateUnitLabel'),
  syringeVolume: $('syringeVolume'), syrInput: $('syrInput'), syrInputUnit: $('syrInputUnit'),
  syrInputLabel: $('syrInputLabel'), result: $('result'),
  pumpMin: $('pumpMin'), pumpMax: $('pumpMax'),
};

let catalog = { drugs: [], issues: [], hiddenUnreviewed: 0 };
const state = { species: '개', method: '', rateUnit: 'mL/hr', syrMode: 'rate', tab: 'calc', detailId: '' };
let resultShown = false;

// ---------- 아이콘 (작은 선 그림) ----------
const ICONS = {
  drop: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flask: '<path d="M8 3h8M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
  syringe: '<path d="m18 2 4 4M17 7l3-3M19 9l-8.7 8.7a2.1 2.1 0 0 1-3 0l-1-1a2.1 2.1 0 0 1 0-3L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- 도우미 ----------
const currentDrug = () => catalog.drugs.find((d) => d.id === el.drug.value);
const plain = (x) => String(Number(x.toFixed(4))); // 입력칸에 넣는 숫자 (쉼표 없음)

// 지속시간 보조 표시: "12시간 30분"
function durationText(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 앱은 정상 동작해야 함
function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* 무시 */ } }

// ---------- 화면 모드(라이트/다크) ----------
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme'); // 자동: 기기 설정을 따름
}

// ---------- 탭 ----------
function setTab(name) {
  state.tab = name;
  ['calc', 'drugs', 'info'].forEach((t) => { $(`view-${t}`).hidden = t !== name; });
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  if (name === 'drugs') { showDrugList(); }
  if (name === 'info') renderInfo();
  window.scrollTo(0, 0);
}

// ---------- 종 ----------
function setSpecies(value) {
  state.species = value;
  document.querySelectorAll('input[name="species"], input[name="species2"]').forEach((r) => { r.checked = r.value === value; });
  fillDrugSelect();
  onDrugChange();
  renderDrugList();
  if (state.detailId) showDrugDetail(state.detailId);
}

// ---------- 약물 목록 ----------
function drugsForSpecies() {
  return catalog.drugs
    .filter((d) => d.doses[state.species])
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function emptyMessage() {
  let msg = '표시할 약물이 없습니다. 검수완료(Y)된 약물만 표시됩니다.';
  if (catalog.hiddenUnreviewed > 0) {
    msg += ` (검수 전 약물 ${catalog.hiddenUnreviewed}개 숨김 · 샘플 확인: 주소 끝에 ?preview=1)`;
  }
  return msg;
}

function fillDrugSelect() {
  const previous = el.drug.value;
  const list = drugsForSpecies();
  el.drug.innerHTML = '<option value="">선택</option>' + list.map((d) => {
    const banned = d.doses[state.species].banned ? ' (사용금지)' : '';
    const unrev = d.reviewed ? '' : ' [미검수]';
    return `<option value="${esc(d.id)}">${esc(d.name)}${banned}${unrev}</option>`;
  }).join('');
  el.drug.value = list.some((d) => d.id === previous) ? previous : '';
  el.emptyHint.textContent = emptyMessage();
  el.emptyHint.hidden = list.length > 0;
}

// "About" 영역 스타일의 약물 정보. full=true 면 약물 탭 상세, false 면 계산 탭 요약
function aboutHtml(d, entry, full) {
  const kv = (k, v) => `<div class="row"><span class="row-label">${k}</span><span class="row-value">${v}</span></div>`;
  let h = '';
  if (entry.banned) {
    h += `<div class="alert danger">이 종(${esc(state.species)})에서는 사용 금지 약물입니다.${entry.speciesNote ? ' ' + esc(entry.speciesNote) : ''}</div>`;
  }
  const rows = [];
  if (!entry.banned) {
    rows.push(kv('참고 용량', `<span class="strong">${fmt(entry.min)} – ${fmt(entry.max)}</span><span class="unit">${esc(entry.unit)}</span>`));
  }
  rows.push(kv('원액 농도', `<span class="strong">${fmt(d.conc)}</span><span class="unit">${esc(d.concUnit)}</span>`));
  if (full) {
    rows.push(kv('가능한 방식', esc(d.method)));
    if (d.diluents.length) rows.push(kv('호환 희석액', d.diluents.map(esc).join(', ')));
  }
  h += `<div class="list" style="margin-top:12px">${rows.join('')}</div>`;

  const notes = [];
  if (!entry.banned && entry.speciesNote) notes.push(`종별 주의: ${entry.speciesNote}`);
  if (d.caution) notes.push(`비호환·주의: ${d.caution}`);
  if (notes.length) {
    if (full) h += '<h2 class="section-title">주의사항</h2>';
    h += notes.map((n) => `<div class="alert warn">${esc(n)}</div>`).join('');
  }

  if (full) {
    h += '<h2 class="section-title">출처</h2><div class="list">'
      + kv('출처', d.source ? esc(d.source) : '<span class="badge warn">미기재</span>')
      + kv('최종 수정일', esc(d.updated || '미기재'))
      + kv('검수', d.reviewed ? '완료' : '<span class="badge warn">미검수</span>')
      + '</div>';
  } else {
    h += `<p class="footnote">출처: ${d.source ? esc(d.source) : '미기재'} · 최종 수정일: ${esc(d.updated || '미기재')}`
      + `${d.reviewed ? '' : ' · 검수되지 않은 데이터'}</p>`;
  }
  return h;
}

// 약물 탭: 목록
function renderDrugList() {
  const list = drugsForSpecies();
  $('drugList').innerHTML = list.map((d) => {
    const e = d.doses[state.species];
    const sub = e.banned ? '사용금지' : `${fmt(e.min)} – ${fmt(e.max)} ${esc(e.unit)}`;
    const tags = (e.banned ? ' <span class="badge danger">사용금지</span>' : '')
      + (d.reviewed ? '' : ' <span class="badge warn">미검수</span>');
    return `<button type="button" class="row" data-id="${esc(d.id)}">`
      + `<span class="row-label">${esc(d.name)}${tags}<small>${sub} · ${esc(d.method)}</small></span>`
      + `${icon('chevron', 'chev')}</button>`;
  }).join('');
  $('drugListEmpty').textContent = emptyMessage();
  $('drugListEmpty').hidden = list.length > 0;
}

function showDrugList() {
  state.detailId = '';
  $('drugListView').hidden = false;
  $('drugDetailView').hidden = true;
  $('drugsTitle').textContent = '약물';
  renderDrugList();
}

function showDrugDetail(id) {
  const d = catalog.drugs.find((x) => x.id === id);
  if (!d || !d.doses[state.species]) { showDrugList(); return; }
  state.detailId = id;
  $('drugListView').hidden = true;
  $('drugDetailView').hidden = false;
  $('drugsTitle').textContent = d.name;
  $('drugDetail').innerHTML = aboutHtml(d, d.doses[state.species], true);
  $('useDrugBtn').hidden = d.doses[state.species].banned;
}

// ---------- 정보·출처 탭 ----------
function renderInfo() {
  const kv = (k, v) => `<div class="row"><span class="row-label">${k}</span><span class="row-value">${v}</span></div>`;
  $('dataStatus').innerHTML = kv('표시 중인 약물', `<span class="strong">${catalog.drugs.length}</span><span class="unit">개</span>`)
    + kv('검수 전이라 숨김', `${catalog.hiddenUnreviewed}<span class="unit">개</span>`)
    + kv('데이터 오류', catalog.issues.length
      ? `<span class="badge danger">${catalog.issues.length}건</span>` : '없음');
  $('issuesList').innerHTML = catalog.issues.map((i) =>
    `<div class="alert danger">${esc(i.name || i.id)}: ${i.messages.map(esc).join(' / ')}</div>`).join('');
  $('sourceList').innerHTML = catalog.drugs.length
    ? catalog.drugs.map((d) => `<div class="row"><span class="row-label">${esc(d.name)}<small>최종 수정일 ${esc(d.updated || '미기재')}</small></span>`
      + `<span class="row-value">${d.source ? esc(d.source) : '<span class="badge warn">출처 미기재</span>'}</span></div>`).join('')
    : `<div class="row"><span class="row-label">${esc(emptyMessage())}</span></div>`;
}

// ---------- 약물 선택 시 ----------
function onDrugChange() {
  const d = currentDrug();
  const entry = d?.doses[state.species];
  clearResult();

  el.aboutCompact.innerHTML = d ? aboutHtml(d, entry, false) : '';
  el.doseGroup.hidden = !d || entry.banned;
  el.methodGroup.hidden = !d || entry.banned;
  if (!d || entry.banned) return;

  // 목표 용량 기본값 = 참고 범위의 중간값 (약물 시트에 적힌 단위 그대로)
  el.dose.value = plain((entry.min + entry.max) / 2);
  el.doseUnit.textContent = entry.unit;

  // 방식: 시트의 "방식" 칸에 따라 선택 가능한 버튼 제한
  const allowed = d.method === '둘다' ? ['백', '시린지'] : [d.method];
  $('m-bag').disabled = !allowed.includes('백');
  $('m-syr').disabled = !allowed.includes('시린지');
  if (!allowed.includes(state.method)) state.method = allowed[0];
  $('m-bag').checked = state.method === '백';
  $('m-syr').checked = state.method === '시린지';
  renderMethodForms();
}

// ---------- 방식별 입력칸 ----------
function renderMethodForms() {
  el.bagForm.hidden = state.method !== '백';
  el.syrForm.hidden = state.method !== '시린지';
  el.rateUnitLabel.textContent = state.rateUnit;
  const isRate = state.syrMode === 'rate';
  el.syrInputUnit.textContent = isRate ? 'mL/hr' : 'μg/mL';
  el.syrInputLabel.textContent = isRate ? '펌프 속도' : '시린지 농도';
  syncChips();
}

function syncChips() {
  document.querySelectorAll('.chips').forEach((box) => {
    const input = $(box.dataset.target);
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === input.value.trim()));
  });
}

// ---------- 결과 ----------
// 입력이 바뀌면 이전 결과는 즉시 지운다 (바뀐 입력과 맞지 않는 숫자가 화면에 남는 것을 막음)
function clearResult() {
  if (!resultShown) return;
  resultShown = false;
  el.result.innerHTML = '<div class="card"><span class="stat-sub">입력이 변경되었습니다. 다시 계산하세요.</span></div>';
}

function hint(msg) {
  resultShown = false;
  el.result.innerHTML = `<div class="card"><span class="stat-sub">${esc(msg)}</span></div>`;
}

function statCard(iconName, label, value, unit, sub = '', cls = '', top = '') {
  return `<section class="card ${cls}">`
    + `<div class="stat-top">${icon(iconName)}<span>${esc(top || label)}</span></div>`
    + (top ? `<div class="stat-label">${esc(label)}</div>` : '')
    + `<div class="num"><span class="n">${esc(value)}</span><span class="u">${esc(unit)}</span></div>`
    + (sub ? `<div class="stat-sub">${sub}</div>` : '') + '</section>';
}

function stepsHtml(steps) {
  return '<h2 class="section-title">계산 과정</h2><div class="list steps">' + steps.map((s) =>
    `<div class="row"><div class="st">${esc(s.title)}</div>`
    + `<div class="se">${esc(s.expr)}</div>`
    + `<div class="sv">= ${esc(s.value)} <span class="u">${esc(s.unit)}</span></div></div>`).join('') + '</div>';
}

function calculate() {
  const d = currentDrug();
  if (!d) { hint('약물을 선택하세요.'); return; }
  const entry = d.doses[state.species];
  if (entry.banned) { hint('이 종에서는 사용 금지 약물이라 계산하지 않습니다.'); return; }

  const weight = parseNum(el.weight.value);
  if (!(weight > 0)) { hint('체중을 입력하세요. (숫자만, 0보다 큼)'); return; }
  const doseInput = parseNum(el.dose.value);
  if (!(doseInput > 0)) { hint('목표 용량을 입력하세요. (숫자만, 0보다 큼)'); return; }

  try {
    const dose = doseToStd(doseInput, entry.unit);
    const conc = concToStd(d.conc, d.concUnit);
    const doseRange = { min: doseToStd(entry.min, entry.unit), max: doseToStd(entry.max, entry.unit) };
    const base = {
      weight, doseInput, doseUnit: entry.unit, dose, concInput: d.conc, concUnit: d.concUnit, conc,
    };

    let resultHtml = '';
    let calc;
    if (state.method === '백') {
      const bagVolume = parseNum(el.bagVolume.value);
      if (!(bagVolume > 0)) { hint('백 용량을 입력하세요.'); return; }
      const rateVal = parseNum(el.rate.value);
      if (!(rateVal > 0)) { hint('수액 속도를 입력하세요.'); return; }
      const rate = rateToMlHr(weight, rateVal, state.rateUnit);
      calc = calcBag({ weight, dose, conc, bagVolume, rate, doseRange });
      if (calc.errors.length === 0) {
        resultHtml = statCard('drop', '원액 주입량', fmt(calc.drugVolume), 'mL',
          '백에서 같은 부피를 먼저 빼고 넣기', 'main', `${d.name} · 수액 백`)
          + '<div class="grid">'
          + statCard('flask', '백 필요 농도', fmt(calc.requiredConc), 'μg/mL')
          + statCard('flask', '총 약물량', fmt(calc.totalDrug), 'μg')
          + statCard('clock', '지속시간', fmt(calc.duration), '시간', esc(durationText(calc.duration)))
          + statCard('gauge', '수액 속도', fmt(rate), 'mL/hr', `= ${esc(fmt(rate / weight))} mL/kg/hr`)
          + '</div>'
          + `<ul class="notes">${calc.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
          + stepsHtml(bagSteps({ ...base, bagVolume, rate, result: calc }));
      }
    } else {
      const syringeVolume = parseNum(el.syringeVolume.value);
      if (!(syringeVolume > 0)) { hint('시린지 용량을 입력하세요.'); return; }
      const v = parseNum(el.syrInput.value);
      if (!(v > 0)) { hint(state.syrMode === 'rate' ? '펌프 속도를 입력하세요.' : '시린지 농도를 입력하세요.'); return; }
      const pm = parseNum(el.pumpMin.value);
      const pM = parseNum(el.pumpMax.value);
      const pumpRange = (Number.isFinite(pm) || Number.isFinite(pM))
        ? { min: Number.isFinite(pm) ? pm : 0, max: Number.isFinite(pM) ? pM : Infinity }
        : undefined;
      calc = calcSyringe({
        weight, dose, conc, syringeVolume, mode: state.syrMode,
        rate: v, driveConc: v, pumpRange, doseRange,
      });
      if (calc.errors.length === 0) {
        resultHtml = statCard('syringe', '원액 주입량', fmt(calc.drugVolume), 'mL', '', 'main', `${d.name} · 시린지 펌프`)
          + '<div class="grid">'
          + statCard('drop', '희석액', fmt(calc.diluentVolume), 'mL')
          + statCard('flask', '시린지 농도', fmt(calc.syringeConc), 'μg/mL')
          + statCard('flask', '총 약물량', fmt(calc.totalDrug), 'μg')
          + statCard('gauge', '펌프 속도', fmt(calc.pumpRate), 'mL/hr', `= ${esc(fmt(calc.pumpRate / weight))} mL/kg/hr`)
          + statCard('clock', '지속시간', fmt(calc.duration), '시간', esc(durationText(calc.duration)))
          + '</div>'
          + stepsHtml(syringeSteps({ ...base, syringeVolume, mode: state.syrMode, result: calc }));
      }
    }

    resultShown = true;
    // 오류가 있으면 숫자는 보여주지 않고 오류만 표시
    if (calc.errors.length > 0) {
      el.result.innerHTML = '<h2 class="section-title">결과</h2>'
        + calc.errors.map((e) => `<div class="alert danger">오류: ${esc(e)}</div>`).join('');
      return;
    }

    // 경고 모으기: 계산 경고 + 종별 주의 + 체중 확인 + 미검수
    const warnings = calc.warnings.map((w) => w.message);
    if (entry.speciesNote) warnings.push(`종별 주의: ${entry.speciesNote}`);
    if (weight < 0.2 || weight > 100 || (state.species === '고양이' && weight > 10)) {
      warnings.push(`입력한 체중 ${fmt(weight)} kg 이(가) 이 종의 일반 범위를 벗어났습니다. 단위와 소수점을 확인하세요.`);
    }
    if (!d.reviewed) warnings.push('검수되지 않은 데이터입니다.');

    const warnHtml = warnings.map((w) => `<div class="alert warn">경고: ${esc(w)}</div>`).join('');
    const meta = `<p class="footnote">출처: ${esc(d.source || '미기재')} · 최종 수정일: ${esc(d.updated || '미기재')}<br>`
      + `<strong>최종 확인은 처방자 책임입니다.</strong></p>`;
    el.result.innerHTML = '<h2 class="section-title">결과</h2>' + warnHtml + resultHtml + meta;
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    resultShown = true;
    el.result.innerHTML = `<div class="alert danger">오류: ${esc(e.message)}</div>`;
  }
}

// ---------- 이벤트 연결 ----------
function wire() {
  // 탭
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // 종 (계산 탭과 약물 탭의 선택이 서로 연동됨)
  document.querySelectorAll('input[name="species"], input[name="species2"]').forEach((r) =>
    r.addEventListener('change', () => setSpecies(r.value)));
  el.drug.addEventListener('change', onDrugChange);

  document.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', () => {
    state.method = r.value; renderMethodForms(); clearResult();
  }));
  document.querySelectorAll('input[name="rateUnit"]').forEach((r) => r.addEventListener('change', () => {
    state.rateUnit = r.value; renderMethodForms(); clearResult();
  }));
  document.querySelectorAll('input[name="syrMode"]').forEach((r) => r.addEventListener('change', () => {
    state.syrMode = r.value;
    el.syrInput.value = ''; // 단위가 바뀌므로 이전 값은 지움 (단위 혼동 방지)
    renderMethodForms(); clearResult();
  }));

  // 입력 변경 → 이전 결과 지움. Enter(키패드의 완료)는 계산 실행
  ['weight', 'dose', 'bagVolume', 'rate', 'syringeVolume', 'syrInput'].forEach((id) => {
    el[id].addEventListener('input', () => { syncChips(); clearResult(); });
    el[id].addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); el[id].blur(); calculate(); }
    });
  });
  ['pumpMin', 'pumpMax'].forEach((id) =>
    el[id].addEventListener('input', () => { storeSet(id, el[id].value); clearResult(); }));

  document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => {
    $(b.parentElement.dataset.target).value = b.dataset.v;
    syncChips(); clearResult();
  }));

  $('calcBtn').addEventListener('click', calculate);

  // 약물 탭
  $('drugList').addEventListener('click', (ev) => {
    const row = ev.target.closest('button[data-id]');
    if (row) { showDrugDetail(row.dataset.id); window.scrollTo(0, 0); }
  });
  $('drugBack').addEventListener('click', showDrugList);
  $('useDrugBtn').addEventListener('click', () => {
    el.drug.value = state.detailId;
    onDrugChange();
    setTab('calc');
  });

  // 화면 모드
  document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => {
    storeSet('theme', r.value);
    applyTheme(r.value);
  }));
}

// ---------- 시작 ----------
async function init() {
  $('previewBanner').hidden = !PREVIEW;
  el.pumpMin.value = storeGet('pumpMin') ?? '';
  el.pumpMax.value = storeGet('pumpMax') ?? '';
  const savedTheme = storeGet('theme');
  const themeMode = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'auto';
  $(`th-${themeMode}`).checked = true;
  wire();
  try {
    const raw = await loadCsvFiles('data');
    catalog = buildCatalog(raw.drugRows, raw.doseRows, { includeUnreviewed: PREVIEW });
  } catch (e) {
    $('loadError').hidden = false;
    $('loadError').textContent = `데이터를 불러오지 못했습니다. ${e.message} (파일을 직접 열지 말고 배포된 주소로 접속하세요.)`;
  }
  if (catalog.issues.length > 0) {
    $('issuesAlert').hidden = false;
    $('issuesAlert').textContent = `데이터 오류 ${catalog.issues.length}건: 해당 약물은 숨겼습니다. (정보·출처 탭에서 확인)`;
  }
  fillDrugSelect();
  onDrugChange();
  renderDrugList();
}

init();
