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
  weight: $('weight'), drug: $('drug'), emptyHint: $('emptyHint'), drugInfo: $('drugInfo'),
  issuesBox: $('issuesBox'), issuesSummary: $('issuesSummary'), issuesList: $('issuesList'),
  doseCard: $('doseCard'), dose: $('dose'), doseUnit: $('doseUnit'),
  methodCard: $('methodCard'), bagForm: $('bagForm'), syrForm: $('syrForm'),
  bagVolume: $('bagVolume'), rate: $('rate'), rateUnitLabel: $('rateUnitLabel'),
  syringeVolume: $('syringeVolume'), syrInput: $('syrInput'), syrInputUnit: $('syrInputUnit'),
  resultCard: $('resultCard'), result: $('result'),
  pumpMin: $('pumpMin'), pumpMax: $('pumpMax'),
};

let catalog = { drugs: [], issues: [], hiddenUnreviewed: 0 };
const state = { species: '개', method: '', rateUnit: 'mL/hr', syrMode: 'rate' };

// ---------- 도우미 ----------
const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const currentDrug = () => catalog.drugs.find((d) => d.id === el.drug.value);
const plain = (x) => String(Number(x.toFixed(4))); // 입력칸에 넣는 숫자 (쉼표 없음)

// 지속시간을 "12.5 시간 (12시간 30분)" 처럼 보조 표시
function durationText(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 장비 설정(펌프 범위)은 이 기기에만 저장. 저장소를 못 쓰는 환경에서도 앱은 정상 동작해야 함
function loadSettings() {
  try {
    el.pumpMin.value = localStorage.getItem('pumpMin') ?? '';
    el.pumpMax.value = localStorage.getItem('pumpMax') ?? '';
  } catch { /* 무시 */ }
}
function saveSettings() {
  try {
    localStorage.setItem('pumpMin', el.pumpMin.value);
    localStorage.setItem('pumpMax', el.pumpMax.value);
  } catch { /* 무시 */ }
}

// ---------- 약물 목록 ----------
function drugsForSpecies() {
  return catalog.drugs
    .filter((d) => d.doses[state.species])
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function fillDrugSelect() {
  const previous = el.drug.value;
  const list = drugsForSpecies();
  el.drug.innerHTML = '<option value="">약물을 선택하세요</option>' + list.map((d) => {
    const banned = d.doses[state.species].banned ? ' (사용금지)' : '';
    const unrev = d.reviewed ? '' : ' [미검수]';
    return `<option value="${esc(d.id)}">${esc(d.name)}${banned}${unrev}</option>`;
  }).join('');
  el.drug.value = list.some((d) => d.id === previous) ? previous : '';

  if (list.length === 0) {
    let msg = '표시할 약물이 없습니다. 검수완료(Y)된 약물만 표시됩니다.';
    if (catalog.hiddenUnreviewed > 0) {
      msg += ` (검수 전 약물 ${catalog.hiddenUnreviewed}개 숨김 · 샘플 확인: 주소 끝에 ?preview=1)`;
    }
    el.emptyHint.textContent = msg;
    el.emptyHint.hidden = false;
  } else {
    el.emptyHint.hidden = true;
  }
}

function renderIssues() {
  if (catalog.issues.length === 0) { el.issuesBox.hidden = true; return; }
  el.issuesBox.hidden = false;
  el.issuesSummary.textContent = `데이터 오류 ${catalog.issues.length}건 (해당 약물은 숨김 처리됨)`;
  el.issuesList.innerHTML = catalog.issues.map((i) =>
    `<li><strong>${esc(i.name || i.id)}</strong>: ${i.messages.map(esc).join(' / ')}</li>`).join('');
}

// ---------- 약물 선택 시 ----------
function onDrugChange() {
  const d = currentDrug();
  const entry = d?.doses[state.species];

  el.drugInfo.hidden = !d;
  el.doseCard.hidden = !d || entry.banned;
  el.methodCard.hidden = !d || entry.banned;
  if (!d) { renderResult(); return; }

  renderDrugInfo(d, entry);

  if (!entry.banned) {
    // 목표 용량 기본값 = 참고 범위의 중간값 (약물 시트에 적힌 단위 그대로)
    el.dose.value = plain((entry.min + entry.max) / 2);
    el.doseUnit.textContent = entry.unit;
  }

  // 방식: 시트의 "방식" 칸에 따라 선택 가능한 버튼 제한
  const allowed = d.method === '둘다' ? ['백', '시린지'] : [d.method];
  $('m-bag').disabled = !allowed.includes('백');
  $('m-syr').disabled = !allowed.includes('시린지');
  if (!allowed.includes(state.method)) state.method = allowed[0];
  $('m-bag').checked = state.method === '백';
  $('m-syr').checked = state.method === '시린지';
  renderMethodForms();
  renderResult();
}

function renderDrugInfo(d, entry) {
  const row = (k, v, cls = '') => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const parts = [];
  if (entry.banned) {
    parts.push(`<div class="box danger">이 종(${esc(state.species)})에서는 사용 금지 약물입니다.${entry.speciesNote ? ' ' + esc(entry.speciesNote) : ''}</div>`);
  } else {
    parts.push(row('참고 용량', `${fmt(entry.min)} – ${fmt(entry.max)} ${esc(entry.unit)}`, 'big'));
    if (entry.speciesNote) parts.push(`<div class="box warn">종별 주의: ${esc(entry.speciesNote)}</div>`);
  }
  parts.push(row('원액 농도', `${fmt(d.conc)} ${esc(d.concUnit)}`));
  if (d.caution) parts.push(`<div class="box warn">비호환·주의: ${esc(d.caution)}</div>`);
  if (d.diluents.length) parts.push(row('호환 희석액', d.diluents.map(esc).join(', ')));
  parts.push(row('가능한 방식', esc(d.method)));
  parts.push(d.source
    ? row('출처', esc(d.source))
    : `<div class="box danger">출처 미기재</div>`);
  parts.push(row('최종 수정일', esc(d.updated || '미기재')));
  if (!d.reviewed) parts.push('<div class="box danger">검수되지 않은 데이터입니다.</div>');
  el.drugInfo.innerHTML = parts.join('');
}

// ---------- 방식별 입력칸 ----------
function renderMethodForms() {
  el.bagForm.hidden = state.method !== '백';
  el.syrForm.hidden = state.method !== '시린지';
  el.rateUnitLabel.textContent = state.rateUnit;
  const isRate = state.syrMode === 'rate';
  el.syrInputUnit.textContent = isRate ? 'mL/hr' : 'μg/mL';
  el.syrInput.placeholder = isRate ? '펌프 속도 입력' : '시린지 농도 입력';
  syncChips();
}

function syncChips() {
  document.querySelectorAll('.chips').forEach((box) => {
    const input = $(box.dataset.target);
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === input.value.trim()));
  });
}

// ---------- 결과 ----------
function hint(msg) {
  el.result.innerHTML = `<p class="muted">${esc(msg)}</p>`;
}

function statHtml(title, value, unit, sub = '', cls = '') {
  return `<div class="stat ${cls}"><div class="t">${esc(title)}</div>`
    + `<div><span class="n">${esc(value)}</span><span class="u">${esc(unit)}</span></div>`
    + (sub ? `<div class="sub2">${sub}</div>` : '') + '</div>';
}

function stepsHtml(steps) {
  return '<ol class="steps">' + steps.map((s) =>
    `<li><div class="st">${esc(s.title)}</div>`
    + `<div class="se">${esc(s.expr)}</div>`
    + `<div class="sv">= ${esc(s.value)} ${esc(s.unit)}</div></li>`).join('') + '</ol>';
}

function renderResult() {
  const d = currentDrug();
  el.resultCard.hidden = !d;
  if (!d) return;
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

    let resultHtml;
    let calc;
    if (state.method === '백') {
      const bagVolume = parseNum(el.bagVolume.value);
      if (!(bagVolume > 0)) { hint('백 용량을 입력하세요.'); return; }
      const rateVal = parseNum(el.rate.value);
      if (!(rateVal > 0)) { hint('수액 속도를 입력하세요.'); return; }
      const rate = rateToMlHr(weight, rateVal, state.rateUnit);
      calc = calcBag({ weight, dose, conc, bagVolume, rate, doseRange });
      if (calc.errors.length === 0) {
        resultHtml = `<div class="big-grid">`
          + statHtml('원액 주입량', fmt(calc.drugVolume), 'mL', '백에서 같은 부피를 먼저 빼고 넣기', 'main')
          + statHtml('백 필요 농도', fmt(calc.requiredConc), 'μg/mL')
          + statHtml('총 약물량', fmt(calc.totalDrug), 'μg')
          + statHtml('지속시간', fmt(calc.duration), '시간', esc(durationText(calc.duration)))
          + statHtml('수액 속도', fmt(rate), 'mL/hr', `= ${esc(fmt(rate / weight))} mL/kg/hr`)
          + `</div>`
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
        resultHtml = `<div class="big-grid">`
          + statHtml('원액 주입량', fmt(calc.drugVolume), 'mL', '', 'main')
          + statHtml('희석액', fmt(calc.diluentVolume), 'mL')
          + statHtml('시린지 농도', fmt(calc.syringeConc), 'μg/mL')
          + statHtml('총 약물량', fmt(calc.totalDrug), 'μg')
          + statHtml('펌프 속도', fmt(calc.pumpRate), 'mL/hr', `= ${esc(fmt(calc.pumpRate / weight))} mL/kg/hr`)
          + statHtml('지속시간', fmt(calc.duration), '시간', esc(durationText(calc.duration)))
          + `</div>`
          + stepsHtml(syringeSteps({ ...base, syringeVolume, mode: state.syrMode, result: calc }));
      }
    }

    // 오류가 있으면 숫자는 보여주지 않고 오류만 표시
    if (calc.errors.length > 0) {
      el.result.innerHTML = calc.errors.map((e) => `<div class="box danger">오류: ${esc(e)}</div>`).join('');
      return;
    }

    // 경고 모으기: 계산 경고 + 종별 주의 + 체중 확인 + 미검수
    const warnings = calc.warnings.map((w) => w.message);
    if (entry.speciesNote) warnings.push(`종별 주의: ${entry.speciesNote}`);
    if (weight < 0.2 || weight > 100 || (state.species === '고양이' && weight > 10)) {
      warnings.push(`입력한 체중 ${fmt(weight)} kg 이(가) 이 종의 일반 범위를 벗어났습니다. 단위와 소수점을 확인하세요.`);
    }
    if (!d.reviewed) warnings.push('검수되지 않은 데이터입니다.');

    const warnHtml = warnings.map((w) => `<div class="box warn">경고: ${esc(w)}</div>`).join('');
    const meta = `<p class="meta">출처: ${esc(d.source || '미기재')} · 최종 수정일: ${esc(d.updated || '미기재')}<br>`
      + `<strong>최종 확인은 처방자 책임입니다.</strong></p>`;
    el.result.innerHTML = warnHtml + resultHtml + meta;
  } catch (e) {
    el.result.innerHTML = `<div class="box danger">오류: ${esc(e.message)}</div>`;
  }
}

// ---------- 이벤트 연결 ----------
function wire() {
  document.querySelectorAll('input[name="species"]').forEach((r) => r.addEventListener('change', () => {
    state.species = r.value;
    fillDrugSelect();
    onDrugChange();
  }));
  el.drug.addEventListener('change', onDrugChange);

  document.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', () => {
    state.method = r.value;
    renderMethodForms();
    renderResult();
  }));
  document.querySelectorAll('input[name="rateUnit"]').forEach((r) => r.addEventListener('change', () => {
    state.rateUnit = r.value;
    renderMethodForms();
    renderResult();
  }));
  document.querySelectorAll('input[name="syrMode"]').forEach((r) => r.addEventListener('change', () => {
    state.syrMode = r.value;
    el.syrInput.value = ''; // 단위가 바뀌므로 이전 값은 지움 (단위 혼동 방지)
    renderMethodForms();
    renderResult();
  }));

  ['weight', 'dose', 'bagVolume', 'rate', 'syringeVolume', 'syrInput'].forEach((id) =>
    el[id].addEventListener('input', () => { syncChips(); renderResult(); }));
  ['pumpMin', 'pumpMax'].forEach((id) =>
    el[id].addEventListener('input', () => { saveSettings(); renderResult(); }));

  document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => {
    $(b.parentElement.dataset.target).value = b.dataset.v;
    syncChips();
    renderResult();
  }));
}

// ---------- 시작 ----------
async function init() {
  $('previewBanner').hidden = !PREVIEW;
  loadSettings();
  wire();
  try {
    const raw = await loadCsvFiles('data');
    catalog = buildCatalog(raw.drugRows, raw.doseRows, { includeUnreviewed: PREVIEW });
  } catch (e) {
    $('loadError').hidden = false;
    $('loadError').textContent = `데이터를 불러오지 못했습니다. ${e.message} (파일을 직접 열지 말고 배포된 주소로 접속하세요.)`;
  }
  fillDrugSelect();
  renderIssues();
  onDrugChange();
}

init();
