// 순수 로직: 열 정의, 엑셀 날짜 변환, 병합, 학습 큐. (브라우저/노드 공용)
(function (root) {
  const COLS = ['id', 'date', 'lang', 'source', 'word', 'meaning', 'memo_done', 'done_date', 'reviews',
    'right', 'wrong', 'last_review', 'star', 'memo', 'updated', 'deleted'];
  const HEADERS = ['ID', '날짜', '언어', '구분(출처)', '단어', '뜻', '암기여부', '암기일', '복습횟수', '정답횟수',
    '오답횟수', '마지막복습', '중요', '메모', '수정일시', '삭제'];
  // 앱 내부 키 이름 (memo_done = 암기여부)
  const K = { id: 0, date: 1, lang: 2, source: 3, word: 4, meaning: 5, done: 6, doneDate: 7, reviews: 8, right: 9,
    wrong: 10, lastReview: 11, star: 12, memo: 13, updated: 14, deleted: 15 };

  const pad = n => String(n).padStart(2, '0');
  const tz = d => d.getTimezoneOffset() * 60000;

  // 엑셀 일련번호 <-> 값. 날짜는 'YYYY-MM-DD', 수정일시는 epoch ms(로컬 시각 기준)
  function serialToMs(s) { return Math.round((s - 25569) * 86400000) + tz(new Date()); }
  function msToSerial(ms) { return (ms - tz(new Date())) / 86400000 + 25569; }
  function serialToDate(s) {
    if (s === '' || s == null) return '';
    if (typeof s === 'string') return s.slice(0, 10);
    const d = new Date(Math.round((s - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function dateToSerial(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000 + 25569;
  }
  function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function toBool(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === 1; }
  function toNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  // 엑셀 한 행(배열, 16열) -> 앱 객체
  function fromRow(r) {
    const upd = r[K.updated];
    return {
      id: r[K.id] ? String(r[K.id]).trim() : '',
      date: serialToDate(r[K.date]),
      lang: r[K.lang] || '영어',
      source: (r[K.source] || '').toString().trim(),
      word: (r[K.word] == null ? '' : String(r[K.word])).trim(),
      meaning: r[K.meaning] == null ? '' : String(r[K.meaning]).trim(),
      done: toBool(r[K.done]),
      doneDate: serialToDate(r[K.doneDate]),
      reviews: toNum(r[K.reviews]), right: toNum(r[K.right]), wrong: toNum(r[K.wrong]),
      lastReview: serialToDate(r[K.lastReview]),
      star: toNum(r[K.star]),
      memo: r[K.memo] == null ? '' : String(r[K.memo]),
      updated: typeof upd === 'number' ? serialToMs(upd) : (upd ? Date.parse(upd) || 0 : 0),
      deleted: toBool(r[K.deleted]),
    };
  }
  // 앱 객체 -> 엑셀 한 행 (16열)
  function toRow(w) {
    return [w.id, dateToSerial(w.date), w.lang, w.source, w.word, w.meaning, !!w.done, dateToSerial(w.doneDate),
      w.reviews || 0, w.right || 0, w.wrong || 0, dateToSerial(w.lastReview), w.star || 0, w.memo || '',
      msToSerial(w.updated || Date.now()), !!w.deleted];
  }

  let seq = 0;
  function newId() { return 'A' + Date.now().toString(36).toUpperCase() + (seq++).toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }

  function sameContent(a, b) { return toRow(a).slice(0, 14).join('|') === toRow(b).slice(0, 14).join('|') && !!a.deleted === !!b.deleted; }

  // 병합: 같은 ID는 수정일시가 최신인 쪽. 동률이면 원격 우선. 반환: {rows, toPush(원격에 쓸 것), changedLocal}
  const sig = w => toRow(w).slice(0, 14).join('|') + '|' + (w.deleted ? 1 : 0);
  // base: 지난 동기화 때의 id->sig. 한쪽만 바뀌었으면 그쪽 채택(엑셀에서 수정일시 없이 고쳐도 반영), 양쪽이면 수정일시 최신.
  function merge(local, remote, base) {
    const L = new Map(local.map(w => [w.id, w]));
    const R = new Map(remote.map(w => [w.id, w]));
    const out = [], toPush = [];
    let changedLocal = 0;
    for (const [id, r] of R) {
      const l = L.get(id);
      if (!l) { out.push(r); changedLocal++; continue; }
      if (sameContent(l, r)) { out.push(l.updated >= r.updated ? l : r); continue; }
      const b = base && base[id];
      let useLocal;
      if (b && sig(r) === b) useLocal = true;          // 원격은 그대로, 로컬만 바뀜
      else if (b && sig(l) === b) useLocal = false;    // 로컬은 그대로, 원격만 바뀜
      else useLocal = (l.updated || 0) > (r.updated || 0);
      if (useLocal) { out.push(l); toPush.push(l); } else { out.push(r); changedLocal++; }
    }
    for (const [id, l] of L) if (!R.has(id)) { out.push(l); toPush.push(l); }
    return { rows: out, toPush, changedLocal };
  }

  // 학습 큐 만들기. opts: lang, source, mode(unlearned|all|wrong|star), order(random|seq|weak)
  function buildQueue(words, o) {
    let q = words.filter(w => !w.deleted && w.word);
    if (o.lang && o.lang !== '전체') q = q.filter(w => w.lang === o.lang);
    if (o.source && o.source !== '전체') q = q.filter(w => w.source === o.source);
    if (o.mode === 'unlearned') q = q.filter(w => !w.done);
    else if (o.mode === 'done') q = q.filter(w => w.done);
    else if (o.mode === 'wrong') q = q.filter(w => w.wrong > w.right || (w.wrong > 0 && !w.done));
    else if (o.mode === 'star') q = q.filter(w => w.star > 0);
    if (o.order === 'weak') q = q.slice().sort((a, b) => (b.wrong - b.right) - (a.wrong - a.right) || Math.random() - .5);
    else if (o.order === 'random') q = shuffle(q.slice());
    return q;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // "단어, 뜻" 여러 줄 붙여넣기 파싱 (탭/쉼표/콜론/' - ' 구분)
  function parseBulk(text) {
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
      const m = line.split(/\t|\s*[,;:]\s*|\s+[-–=]\s+/);
      if (m.length < 2) return null;
      return { word: m[0].trim(), meaning: m.slice(1).join(', ').trim() };
    }).filter(x => x && x.word && x.meaning);
  }

  // 정답 채점용 정규화
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9가-힣]/g, '');

  const api = { COLS, HEADERS, K, fromRow, toRow, newId, merge, buildQueue, shuffle, parseBulk, norm, today,
    serialToDate, dateToSerial, serialToMs, msToSerial, sameContent, sig };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
