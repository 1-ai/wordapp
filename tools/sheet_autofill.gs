/**
 * 단어장 시트 자동 채우기 (Google Apps Script)
 *
 * 하는 일
 *  - 단어(E열)만 적어도 ID, 날짜, 언어, 수정일시, 기본값(암기여부=FALSE, 횟수=0 …)을 채웁니다.
 *  - 뜻(F열)이 비어 있으면 구글 번역으로 한국어 뜻을 채우고, 메모에 "자동번역"이라고 표시합니다.
 *  - 시트에서 직접 입력하면 바로(onEdit) 정리하고, 뜻 자동번역은 마지막 입력 후 TRANSLATE_DELAY_MIN분(기본 3분)이 지나야 합니다.
 *    앱에서 추가한 단어도 같은 규칙으로 1분마다 점검합니다.
 *
 * 설치: 시트 → 확장 프로그램 → Apps Script → 이 코드를 붙여넣고 저장 → 함수 목록에서 setup 선택 → ▶ 실행
 *       (권한 허용 1회: "고급 → 이동" 경고가 나오면 계속). 끝.
 */
var SHEET_NAME = '단어';
var AUTO_NOTE = '자동번역';
var TRANSLATE_DELAY_MIN = 3;               // 마지막으로 입력한 뒤 이 시간(분)이 지나야 자동번역 (그 안에 뜻을 직접 적을 시간)
var MAX_PER_RUN = 40;                       // 한 번에 번역할 최대 개수 (실행 시간/할당량 보호)
var LANG_CODE = { '영어': 'en', '스페인어': 'es', '일본어': 'ja', '중국어': 'zh-CN', '프랑스어': 'fr', '독일어': 'de' };

// 열 번호(1부터): ID, 날짜, 언어, 출처, 단어, 뜻, 암기여부, 암기일, 복습, 정답, 오답, 마지막복습, 중요, 메모, 수정일시, 삭제
var C = { id: 0, date: 1, lang: 2, src: 3, word: 4, meaning: 5, done: 6, doneDate: 7, rev: 8, right: 9, wrong: 10, last: 11, star: 12, memo: 13, upd: 14, del: 15 };

function setup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('fillAll').timeBased().everyMinutes(1).create();
  fillAll();
  SpreadsheetApp.getActive().toast('자동 채우기를 설치했어요. 이제 단어만 적어도 됩니다.', '단어장', 6);
}

// 시트에서 직접 편집했을 때 (설치형 트리거)
function handleEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME) return;
  var from = Math.max(2, e.range.getRow()), to = e.range.getLastRow();
  if (to < from || to - from > 200) return;               // 대량 붙여넣기는 시간 트리거가 처리
  fillRows_(sh, from, to, true);                          // 편집 중에는 번역하지 않고, 대기 시간만 새로 시작
}

// 1분마다: 앱에서 추가된 행 등 비어 있는 행을 전부 점검
function fillAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) return;
    fillRows_(sh, 2, sh.getLastRow());
  } finally { lock.releaseLock(); }
}

function fillRows_(sh, from, to, editMode) {
  var n = to - from + 1;
  var rows = sh.getRange(from, 1, n, 16).getValues();
  var srcLang = {};                                          // 같은 출처의 다른 행에서 언어 추정
  sh.getRange(2, 3, Math.max(1, sh.getLastRow() - 1), 2).getValues().forEach(function (r) { if (r[0] && r[1]) srcLang[String(r[1])] = String(r[0]); });
  var translated = 0;
  for (var i = 0; i < n; i++) {
    var v = rows[i];
    if (!String(v[C.word]).trim()) continue;                // 단어 없는 행은 건드리지 않음
    var r = fillOne_(v, translated < MAX_PER_RUN, srcLang, editMode);
    if (r.translated) translated++;
    if (r.changed) {
      if (r.bumpOnly) { var c = sh.getRange(from + i, C.upd + 1); c.setValue(v[C.upd]); c.setNumberFormat('yyyy-mm-dd hh:mm'); }   // 입력 중에는 수정일시 한 칸만 갱신
      else writeRow_(sh, from + i, v);
    }
  }
}

// v(16칸 배열)를 제자리에서 채우고 {changed, translated} 반환
function fillOne_(v, canTranslate, srcLang, editMode) {
  var changed = false, translated = false, now = new Date();
  var updMs = v[C.upd] instanceof Date ? v[C.upd].getTime() : (v[C.upd] ? Date.parse(v[C.upd]) : 0);
  var idle = updMs > 0 && (now.getTime() - updMs >= TRANSLATE_DELAY_MIN * 60000);   // 수정일시가 없으면 방금 입력한 것으로 봄
  var word = String(v[C.word]).trim(), rejected = '';
  // 단어·뜻이 한 칸에 같이 있거나 서로 바뀐 경우 자동 정리 (분리할 수 없으면 건드리지 않고 메모로 알림)
  var hint = String(v[C.lang] || '').trim() || (srcLang || {})[String(v[C.src])] || '';
  var sp = splitMixed_(word, String(v[C.meaning]).trim(), hint || '영어', !!hint);
  if (sp.reject) { rejected = sp.reject; }
  else if (sp.changed) {
    v[C.word] = sp.word; v[C.meaning] = sp.meaning; word = sp.word; changed = true;
    if (!v[C.memo]) v[C.memo] = sp.note;
  }
  if (rejected && v[C.memo] !== '확인필요: ' + rejected) { v[C.memo] = '확인필요: ' + rejected; changed = true; }
  if (!v[C.id]) { v[C.id] = 'G' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); changed = true; }
  if (!v[C.date]) { v[C.date] = new Date(now.getFullYear(), now.getMonth(), now.getDate()); changed = true; }
  if (!v[C.lang]) { v[C.lang] = guessLang_(word, (srcLang || {})[String(v[C.src])]); changed = true; }
  if (v[C.done] === '') { v[C.done] = false; changed = true; }
  [C.rev, C.right, C.wrong, C.star].forEach(function (k) { if (v[k] === '') { v[k] = 0; changed = true; } });
  if (v[C.del] === '') { v[C.del] = false; changed = true; }
  if (!rejected && !editMode && idle && !String(v[C.meaning]).trim() && canTranslate && v[C.lang] !== '한국어') {
    var t = translate_(word, v[C.lang]);
    if (t) {
      v[C.meaning] = t; translated = true; changed = true;
      if (!v[C.memo]) v[C.memo] = AUTO_NOTE;
    }
  }
  var bumpOnly = false;
  if (editMode && !String(v[C.meaning]).trim() && v[C.lang] !== '한국어') { bumpOnly = !changed; changed = true; }   // 입력 중인 행: 수정일시를 지금으로 갱신해 번역을 뒤로 미룸
  if (changed) v[C.upd] = now;                              // 앱이 이 변경을 가져가도록 수정일시 갱신
  return { changed: changed, translated: translated, bumpOnly: bumpOnly };
}

function writeRow_(sh, row, v) {
  sh.getRange(row, 1, 1, 16).setValues([v]);
  sh.getRange(row, C.date + 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, C.doneDate + 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, C.last + 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, C.upd + 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

function guessLang_(w, hint) {                              // hint: 같은 출처 행들의 언어
  if (/[가-힣]/.test(w)) return '한국어';
  if (/[぀-ヿ]/.test(w)) return '일본어';
  if (/[一-鿿]/.test(w)) return '중국어';
  if (hint) return hint;
  if (/[áéíóúñü¿¡]/i.test(w)) return '스페인어';
  return '영어';
}

function translate_(word, lang) {
  var src = LANG_CODE[lang];
  if (!src) return '';
  try { return String(LanguageApp.translate(word, src, 'ko') || '').trim(); }
  catch (e) { return ''; }                                  // 할당량 초과 등: 다음 실행 때 다시 시도
}

// ---- 단어·뜻 자동 분리 (앱의 Core.splitMixed 와 같은 규칙) ----
var HANGUL_ = /[가-힣]/;
var FOREIGN_ = /[A-Za-zÀ-ɏ぀-ヿ一-鿿]/;
function stripSep_(s) { return s.replace(/^[\s\-–—:=,;\/·]+/, '').replace(/[\s\-–—:=,;\/·]+$/, ''); }
// strict: 언어 칸이 채워져 있을 때만 "한글만 있는 단어"를 오류/교환 대상으로 본다
function splitMixed_(word, meaning, lang, strict) {
  var w = String(word || '').trim(), m = String(meaning || '').trim();
  function out(note, reject) { return { word: w, meaning: m, note: note || '', reject: reject || '', changed: !!note }; }
  if (!w || lang === '한국어') return out();
  var hw = HANGUL_.test(w), hm = HANGUL_.test(m);
  if (hw && FOREIGN_.test(w)) {                                   // "apple 사과", "apple - 사과", "apple(사과)", "사과 apple"
    var i = w.search(HANGUL_), wd, mn;
    if (i > 0) { wd = stripSep_(w.slice(0, i).replace(/[(\[{]+\s*$/, '')); mn = stripSep_(w.slice(i).replace(/[)\]}]+\s*$/, '')); }
    else { var j = w.search(FOREIGN_); wd = stripSep_(w.slice(j).replace(/^[(\[{]+/, '').replace(/[)\]}]+\s*$/, '')); mn = stripSep_(w.slice(0, j).replace(/[(\[{]+\s*$/, '')); }
    if (wd && mn && FOREIGN_.test(wd) && HANGUL_.test(mn)) {
      w = wd; m = (m && m.toLowerCase() !== mn.toLowerCase()) ? mn + ', ' + m : mn;
      return out('자동분리');
    }
  }
  if (hw && !FOREIGN_.test(w)) {
    if (m && !hm && FOREIGN_.test(m)) { var t = w; w = m; m = t; return out('자리바꿈'); }
    if (strict && !m) return out('', '단어 칸에 한글만 있어요 (' + lang + ' 단어를 적어 주세요)');
    return out();
  }
  if (m && HANGUL_.test(m) && m.toLowerCase().indexOf(w.toLowerCase()) === 0) {
    var rest = stripSep_(m.slice(w.length).replace(/^[(\[{]+/, '').replace(/[)\]}]+\s*$/, ''));
    if (rest && HANGUL_.test(rest)) { m = rest; return out('자동분리'); }
  }
  return out();
}
