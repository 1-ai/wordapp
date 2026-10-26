/**
 * 단어장 시트 자동 채우기 (Google Apps Script)
 *
 * 하는 일
 *  - 단어(E열)만 적어도 ID, 날짜, 언어, 수정일시, 기본값(암기여부=FALSE, 횟수=0 …)을 채웁니다.
 *  - 뜻(F열)이 비어 있으면 구글 번역으로 한국어 뜻을 채우고, 메모에 "자동번역"이라고 표시합니다.
 *  - 시트에서 직접 입력하면 바로(onEdit), 앱에서 추가한 단어는 5분 이내(시간 트리거)에 처리됩니다.
 *
 * 설치: 시트 → 확장 프로그램 → Apps Script → 이 코드를 붙여넣고 저장 → 함수 목록에서 setup 선택 → ▶ 실행
 *       (권한 허용 1회: "고급 → 이동" 경고가 나오면 계속). 끝.
 */
var SHEET_NAME = '단어';
var AUTO_NOTE = '자동번역';
var MAX_PER_RUN = 40;                       // 한 번에 번역할 최대 개수 (실행 시간/할당량 보호)
var LANG_CODE = { '영어': 'en', '스페인어': 'es', '일본어': 'ja', '중국어': 'zh-CN', '프랑스어': 'fr', '독일어': 'de' };

// 열 번호(1부터): ID, 날짜, 언어, 출처, 단어, 뜻, 암기여부, 암기일, 복습, 정답, 오답, 마지막복습, 중요, 메모, 수정일시, 삭제
var C = { id: 0, date: 1, lang: 2, src: 3, word: 4, meaning: 5, done: 6, doneDate: 7, rev: 8, right: 9, wrong: 10, last: 11, star: 12, memo: 13, upd: 14, del: 15 };

function setup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('fillAll').timeBased().everyMinutes(5).create();
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
  fillRows_(sh, from, to);
}

// 5분마다: 앱에서 추가된 행 등 비어 있는 행을 전부 점검
function fillAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) return;
    fillRows_(sh, 2, sh.getLastRow());
  } finally { lock.releaseLock(); }
}

function fillRows_(sh, from, to) {
  var n = to - from + 1;
  var rows = sh.getRange(from, 1, n, 16).getValues();
  var srcLang = {};                                          // 같은 출처의 다른 행에서 언어 추정
  sh.getRange(2, 3, Math.max(1, sh.getLastRow() - 1), 2).getValues().forEach(function (r) { if (r[0] && r[1]) srcLang[String(r[1])] = String(r[0]); });
  var translated = 0;
  for (var i = 0; i < n; i++) {
    var v = rows[i];
    if (!String(v[C.word]).trim()) continue;                // 단어 없는 행은 건드리지 않음
    var r = fillOne_(v, translated < MAX_PER_RUN, srcLang);
    if (r.translated) translated++;
    if (r.changed) writeRow_(sh, from + i, v);
  }
}

// v(16칸 배열)를 제자리에서 채우고 {changed, translated} 반환
function fillOne_(v, canTranslate, srcLang) {
  var changed = false, translated = false, now = new Date();
  var word = String(v[C.word]).trim();
  if (!v[C.id]) { v[C.id] = 'G' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); changed = true; }
  if (!v[C.date]) { v[C.date] = new Date(now.getFullYear(), now.getMonth(), now.getDate()); changed = true; }
  if (!v[C.lang]) { v[C.lang] = guessLang_(word, (srcLang || {})[String(v[C.src])]); changed = true; }
  if (v[C.done] === '') { v[C.done] = false; changed = true; }
  [C.rev, C.right, C.wrong, C.star].forEach(function (k) { if (v[k] === '') { v[k] = 0; changed = true; } });
  if (v[C.del] === '') { v[C.del] = false; changed = true; }
  if (!String(v[C.meaning]).trim() && canTranslate && v[C.lang] !== '한국어') {
    var t = translate_(word, v[C.lang]);
    if (t) {
      v[C.meaning] = t; translated = true; changed = true;
      if (!v[C.memo]) v[C.memo] = AUTO_NOTE;
    }
  }
  if (changed) v[C.upd] = now;                              // 앱이 이 변경을 가져가도록 수정일시 갱신
  return { changed: changed, translated: translated };
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
