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

  // ---- 병합: 구글 시트(원격)가 항상 우선 ----
  // 내용(단어·뜻·언어·출처·메모·중요·삭제·날짜) : 충돌하면 시트 값. 시트가 그대로일 때만 앱에서 고친 값이 올라감.
  // 학습 기록(암기·복습/정답/오답 횟수) : 앱에서만 쌓이므로 한쪽만 바뀌었으면 그쪽, 양쪽이면 복습 횟수가 많은 쪽.
  // 시트에서 행을 지웠으면(지난 동기화엔 있었는데 지금 없음) 앱에서도 지움.
  const CONTENT = ['lang', 'source', 'word', 'meaning', 'memo', 'star', 'deleted', 'date'];
  const PROGRESS = ['done', 'doneDate', 'reviews', 'right', 'wrong', 'lastReview'];
  const grp = (w, keys) => keys.map(k => (w[k] == null ? '' : String(w[k]))).join('\u0001');
  const snap = w => ({ c: grp(w, CONTENT), p: grp(w, PROGRESS) });
  const sig = w => JSON.stringify(snap(w));
  function merge(local, remote, base) {
    base = base || {};
    const L = new Map(local.map(w => [w.id, w]));
    const R = new Map(remote.map(w => [w.id, w]));
    const out = [], toPush = [], removed = [];
    let changedLocal = 0;
    for (const [id, r] of R) {
      const l = L.get(id);
      if (!l) { out.push(r); changedLocal++; continue; }
      const b = base[id] && typeof base[id] === 'object' ? base[id] : null;
      const cl = grp(l, CONTENT), cr = grp(r, CONTENT), pl = grp(l, PROGRESS), pr = grp(r, PROGRESS);
      const m = Object.assign({}, r);
      if (b && cr === b.c && cl !== cr) CONTENT.forEach(k => { m[k] = l[k]; });        // 시트는 그대로, 앱만 수정
      let useLocalProg;
      if (b && pr === b.p) useLocalProg = pl !== pr;                                    // 시트 기록은 그대로
      else if (b && pl === b.p) useLocalProg = false;                                   // 앱 기록은 그대로
      else useLocalProg = (l.reviews || 0) > (r.reviews || 0);                          // 양쪽 변경/기준 없음
      if (useLocalProg) PROGRESS.forEach(k => { m[k] = l[k]; });
      m.updated = Math.max(l.updated || 0, r.updated || 0);
      const toSheet = grp(m, CONTENT) !== cr || grp(m, PROGRESS) !== pr;
      if (grp(m, CONTENT) !== cl || grp(m, PROGRESS) !== pl) changedLocal++;
      out.push(m); if (toSheet) toPush.push(m);
    }
    for (const [id, l] of L) {
      if (R.has(id)) continue;
      if (base[id]) removed.push(id);                       // 시트에서 지워진 행 → 앱에서도 제거
      else { out.push(l); toPush.push(l); }                 // 앱에서 새로 만든 행 → 시트에 추가
    }
    return { rows: out, toPush, changedLocal, removed };
  }

  // ---- 단어·뜻이 한 칸에 같이 들어갔을 때 자동 분리 / 자리가 바뀌었을 때 교환 / 불가능하면 거절 ----
  const HANGUL = /[가-힣]/;
  const FOREIGN = /[A-Za-zÀ-ɏ぀-ヿ一-鿿]/;
  const stripSep = s => s.replace(/^[\s\-–—:=,;\/·]+/, '').replace(/[\s\-–—:=,;\/·]+$/, '');
  // strict=false: 언어 칸이 비어 있는 경우(한글만 있는 단어를 한국어 단어로 간주)
  function splitMixed(word, meaning, lang, strict) {
    let w = String(word == null ? '' : word).trim(), m = String(meaning == null ? '' : meaning).trim();
    const out = (note, reject) => ({ word: w, meaning: m, note: note || '', reject: reject || '', changed: !!note });
    if (!w || lang === '한국어') return out();
    const hw = HANGUL.test(w), hm = HANGUL.test(m);
    if (hw && FOREIGN.test(w)) {                                   // 한 칸에 단어+뜻: "apple 사과", "apple - 사과", "apple(사과)", "사과 apple"
      const i = w.search(HANGUL);
      let wd, mn;
      if (i > 0) { wd = stripSep(w.slice(0, i).replace(/[(\[{]+\s*$/, '')); mn = stripSep(w.slice(i).replace(/[)\]}]+\s*$/, '')); }
      else { const j = w.search(FOREIGN); wd = stripSep(w.slice(j).replace(/^[(\[{]+/, '').replace(/[)\]}]+\s*$/, '')); mn = stripSep(w.slice(0, j).replace(/[(\[{]+\s*$/, '')); }
      if (wd && mn && FOREIGN.test(wd) && HANGUL.test(mn)) {
        w = wd; m = m && m.toLowerCase() !== mn.toLowerCase() ? mn + ', ' + m : mn;
        return out('단어·뜻이 한 칸에 있어 자동으로 나눴어요');
      }
    }
    if (hw && !FOREIGN.test(w)) {
      if (m && !hm && FOREIGN.test(m)) { const t = w; w = m; m = t; return out('단어·뜻이 서로 바뀌어 있어 자리를 맞바꿨어요'); }
      if (strict && !m) return out('', `단어 칸에 한글만 있어요. ${lang} 단어를 적어 주세요 (뜻은 뜻 칸에)`);
      return out();
    }
    if (m && HANGUL.test(m) && m.toLowerCase().startsWith(w.toLowerCase())) {   // 뜻 칸에 "apple 사과"처럼 단어까지 들어간 경우
      const rest = stripSep(m.slice(w.length).replace(/^[(\[{]+/, '').replace(/[)\]}]+\s*$/, ''));
      if (rest && HANGUL.test(rest)) { m = rest; return out('뜻 칸에 단어가 같이 있어 나눴어요'); }
    }
    return out();
  }
  // 같은 단어에 뜻을 추가: 이미 있는 뜻이면 그대로, 새 뜻이면 ", 새뜻"
  const mparts = s => String(s || '').split(/\s*[,;\/]\s*/).map(x => x.trim()).filter(Boolean);
  function mergeMeaning(a, b) {
    const have = new Set(mparts(a).map(x => x.toLowerCase().replace(/\s+/g, '')));
    const add = mparts(b).filter(x => { const k = x.toLowerCase().replace(/\s+/g, ''); if (have.has(k)) return false; have.add(k); return true; });
    return add.length ? [String(a || '').trim(), ...add].filter(Boolean).join(', ') : String(a || '').trim();
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
      // 뜻이 여러 개면 "apple, 사과, 애플" / "apple: 사과; 애플" 모두 "사과, 애플" 한 칸으로. 뜻이 없으면 빈 칸(시트가 자동 번역)
      const word = m[0].trim(), meaning = mergeMeaning('', m.slice(1).join(', '));
      return word ? { word, meaning } : null;
    }).filter(Boolean);
  }

  // 정답 채점용 정규화
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9가-힣]/g, '');

  const api = { COLS, HEADERS, K, fromRow, toRow, newId, merge, buildQueue, shuffle, parseBulk, norm, today,
    serialToDate, dateToSerial, serialToMs, msToSerial, sameContent, sig, snap, splitMixed, mergeMeaning };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
