/* 단어장 앱: 학습(카드/필기) · 듣기 · 단어 관리 · 통계 · 설정/동기화 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANG_CODE = { 영어: 'en-US', 스페인어: 'es-ES', 일본어: 'ja-JP', 중국어: 'zh-CN', 한국어: 'ko-KR', 프랑스어: 'fr-FR', 독일어: 'de-DE' };

  const DEF = { theme: 'auto', fs: 1, rate: 0.9, wake: true, autoSpeak: true, penOnly: true, repeat: 2, gap: 2,
    filter: { lang: '전체', source: '전체', mode: 'unlearned', order: 'random', dir: 'w2m' }, penMode: 'recall', human: false, voice: {}, testN: 20, testType: 'mix', testSpeed: 'none' };
  const ld = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const S = {
    words: ld('wa_words', []), base: ld('wa_base', {}), set: Object.assign({}, DEF, ld('wa_set', {})),
    view: 'study', study: null, listen: null, search: '', fl: { lang: '전체', source: '전체', st: '활성' }, shown: 100,
    sync: { busy: false, state: 'local', last: 0 },
    prog: ld('wa_prog', {}), setSel: null, chunk: 0, multi: [], multiMode: false,
  };
  if (!S.set.v4) { S.set.filter.mode = 'all'; S.set.filter.order = 'seq'; S.set.chunk = 30; S.set.v4 = 1; }
  S.set.filter = Object.assign({}, DEF.filter, S.set.filter);
  let saveT = null;
  function save() {
    try { localStorage.setItem('wa_words', JSON.stringify(S.words)); localStorage.setItem('wa_base', JSON.stringify(S.base)); localStorage.setItem('wa_set', JSON.stringify(S.set)); localStorage.setItem('wa_prog', JSON.stringify(S.prog)); }
    catch (e) { toast('저장 공간이 부족합니다'); }
  }
  function touch(w) { w.updated = Date.now(); save(); queueSync(); }

  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
  const langs = () => [...new Set(['영어', '스페인어', '일본어', '중국어', ...S.words.map(w => w.lang)])].filter(Boolean);
  const sources = () => [...new Set(S.words.filter(w => !w.deleted).map(w => w.source))].filter(Boolean);
  const opts = (list, cur, all) => (all ? ['전체', ...list] : list).map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');

  function applyTheme() {
    document.documentElement.dataset.theme = S.set.theme;
    document.documentElement.style.setProperty('--fs', S.set.fs);
  }

  /* ---------- 음성 ---------- */
  const AU = ld('wa_audio', {});
  let curAudio = null, curRes = null, spkTok = 0, AIDX = null;
  const vlist = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []);
  const norml = l => (l || '').replace('_', '-');
  const vscore = (v, lang) => (norml(v.lang) === lang ? 5 : 0) + (/natural|neural|online/i.test(v.name) ? 7 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/premium|enhanced|siri/i.test(v.name) ? 4 : 0) + (v.localService ? 0 : 1);
  function voicesFor(lang) { const p = lang.slice(0, 2).toLowerCase(); return vlist().filter(v => norml(v.lang).toLowerCase().startsWith(p)).sort((a, b) => vscore(b, lang) - vscore(a, lang)); }
  function bestVoice(lang) { const vs = voicesFor(lang); const pref = (S.set.voice || {})[lang]; return vs.find(v => v.name === pref) || vs[0]; }
  function stopSpeech() { spkTok++; try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { } if (curAudio) { try { curAudio.pause(); } catch (e) { } curAudio = null; } if (curRes) { const r = curRes; curRes = null; r(false); } }
  function speak(text, lang, rate) {
    return new Promise(res => {
      if (!('speechSynthesis' in window) || !text) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang; u.rate = rate || S.set.rate; u.pitch = 1;
      const v = bestVoice(lang); if (v) u.voice = v;
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      u.onend = fin; u.onerror = fin;
      setTimeout(fin, Math.max(4000, text.length * 400 / (u.rate || 1)));
      speechSynthesis.speak(u);
    });
  }
  // 영어 단어: 사전 사람 녹음(dictionaryapi.dev) → 실패/없음이면 음성합성
  async function audioUrl(word) {
    const k = word.toLowerCase();
    if (k in AU) return AU[k];
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(k));
      if (r.status === 404) AU[k] = '';
      else if (r.ok) { const j = await r.json(); const urls = []; j.forEach(e => (e.phonetics || []).forEach(p => p.audio && urls.push(p.audio))); AU[k] = urls.find(u => /-us[.\-]/.test(u)) || urls[0] || ''; }
      else return '';
      localStorage.setItem('wa_audio', JSON.stringify(AU)); return AU[k];
    } catch (e) { return ''; }
  }
  function playUrl(u) { return new Promise(res => { const a = new Audio(u); curAudio = a; curRes = res; a.onended = () => { curRes = null; res(true); }; a.onerror = () => { curRes = null; res(false); }; a.play().catch(() => { curRes = null; res(false); }); }); }
  // 미리 만들어 둔 신경망 음성(audio/ 폴더, tools/gen_audio.py 로 생성)
  async function audioIdx() { if (AIDX) return AIDX; try { const r = await fetch('audio/index.json'); AIDX = r.ok ? await r.json() : {}; } catch (e) { AIDX = {}; } return AIDX; }
  async function speakMeaning(w) {
    const t = spkTok, f = (await audioIdx())['한국어|' + w.meaning];
    if (f && await playUrl('audio/' + f)) return;
    if (t !== spkTok) return;
    return speak(w.meaning, 'ko-KR');
  }
  async function speakWord(w) {
    stopSpeech(); const t = spkTok;
    const f = (await audioIdx())[w.lang + '|' + w.word];
    if (t !== spkTok) return;
    if (f && await playUrl('audio/' + f)) return;
    if (t !== spkTok) return;
    if (w.lang === '영어' && S.set.human && /^[A-Za-z'-]+$/.test(w.word) && navigator.onLine) {
      const u = await Promise.race([audioUrl(w.word), new Promise(r => setTimeout(() => r(''), 2500))]);
      if (t !== spkTok) return;
      if (u && await playUrl(u)) return;
      if (t !== spkTok) return;
    }
    return speak(w.word, LANG_CODE[w.lang] || 'en-US');
  }
  async function prefetch(list) { if (!S.set.human) return; for (const w of list) { if (w.lang === '영어' && /^[A-Za-z'-]+$/.test(w.word) && !(w.word.toLowerCase() in AU)) { await audioUrl(w.word); await new Promise(r => setTimeout(r, 120)); } } }
  const say = w => speakWord(w);

  /* ---------- 화면 유지 ---------- */
  let lock = null;
  async function wake(on) {
    try {
      if (on && S.set.wake && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); }
      else if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { }
  }

  /* ---------- 라우팅 ---------- */
  function go(v) {
    if (S.view === 'listen' && v !== 'listen') stopListen();
    if (S.view === 'study' && v !== 'study' && window.Modes) Modes.stopTimers();
    S.view = v; S.shown = 100;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    render();
  }
  function render() {
    wake(S.view === 'listen' || (S.view === 'study' && S.study));
    ({ study: viewStudy, listen: viewListen, words: viewWords, stats: viewStats, settings: viewSettings })[S.view]();
  }
  const main = () => $('#main');

  /* ================= 학습 ================= */
  function filterBox(withDir, action) {
    const f = S.set.filter;
    const n = Core.buildQueue(S.words, f).length;
    return `<div class="card"><h2>${action}</h2>
    <div class="grid2"><div><label>언어</label><select data-f="lang">${opts(langs(), f.lang, true)}</select></div>
    <div><label>출처</label><select data-f="source">${opts(sources(), f.source, true)}</select></div>
    <div><label>대상</label><select data-f="mode">${[['unlearned', '미암기만'], ['all', '전체'], ['wrong', '자주 틀린 것'], ['star', '★ 중요'], ['done', '암기한 것(복습)']].map(([k, v]) => `<option value="${k}" ${f.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>순서</label><select data-f="order">${[['random', '무작위'], ['seq', '입력 순서'], ['weak', '약한 것 먼저']].map(([k, v]) => `<option value="${k}" ${f.order === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${withDir ? `<div><label>방향</label><select data-f="dir"><option value="w2m" ${f.dir === 'w2m' ? 'selected' : ''}>단어 → 뜻</option><option value="m2w" ${f.dir === 'm2w' ? 'selected' : ''}>뜻 → 단어</option></select></div>` : ''}
    </div><p class="muted">대상 단어 <b>${n}</b>개</p></div>`;
  }
  function bindFilters() {
    $$('[data-f]').forEach(el => el.onchange = () => { S.set.filter[el.dataset.f] = el.value; save(); render(); });
  }

  /* ---- 세트(단원) 중심 학습: 세트 목록 → 구간 → 단계별 학습 ---- */
  const SPECIAL = { __wrong: '❌ 오답노트', __star: '⭐ 중요 단어', __all: '📚 전체 단어' };
  const FLOW = ['learn', 'recall', 'spell', 'test'];
  const MN = { learn: ['📖', '암기학습'], recall: ['🃏', '리콜학습(4지선다)'], spell: ['⌨️', '스펠학습'], test: ['📝', '테스트'], match: ['🧩', '매칭게임'], crash: ['☄️', '크래시'] };
  const actv = () => S.words.filter(w => !w.deleted && w.word && w.meaning);
  const MULTI = '__multi:';
  const titleOf = key => SPECIAL[key] || (key.startsWith(MULTI) ? `🧩 합친 세트 (${key.slice(MULTI.length).split('|').length}개)` : key);
  function setWords(key) {
    const a = actv();
    if (key.startsWith(MULTI)) { const names = new Set(key.slice(MULTI.length).split('|')); return a.filter(w => names.has(w.source)); }
    if (key === '__wrong') return a.filter(w => w.wrong > w.right);
    if (key === '__star') return a.filter(w => w.star > 0);
    if (key === '__all') return a;
    return a.filter(w => w.source === key);
  }
  function chunkList(key) {
    const all = setWords(key), n = S.set.chunk; if (!n) return [all];
    const out = []; for (let i = 0; i < all.length; i += n) out.push(all.slice(i, i + n));
    return out.length ? out : [[]];
  }
  const pkey = (key, ci) => key + '#' + (S.set.chunk || 0) + '#' + ci;
  const stageOf = (key, ci, st) => (S.prog[pkey(key, ci)] || {})[st];
  function markStage(stage, score) {
    const st = S.study; if (!st || !st.setKey) return;
    const p = S.prog[pkey(st.setKey, st.ci)] = S.prog[pkey(st.setKey, st.ci)] || {};
    p[stage] = Core.today(); if (score != null) p.best = Math.max(p.best || 0, score); save();
  }
  function recordBest(field, val, lower) {
    const st = S.study; if (!st || !st.setKey) return false;
    const p = S.prog[pkey(st.setKey, st.ci)] = S.prog[pkey(st.setKey, st.ci)] || {};
    const prev = p[field], better = prev == null || (lower ? val < prev : val > prev);
    if (better) { p[field] = val; save(); }
    return better && prev != null;
  }
  function nextHtml() {
    const st = S.study; if (!st || !st.setKey) return '';
    const nx = FLOW.find(f => !stageOf(st.setKey, st.ci, f));
    const more = st.ci < chunkList(st.setKey).length - 1;
    return (nx ? `<button class="pri" data-act="mode" data-m="${nx}">다음 단계 ▶ ${MN[nx][1]}</button>` : '')
      + (more ? `<button class="${nx ? '' : 'pri'}" data-act="nextchunk">다음 구간 ▶</button>` : '');
  }
  function viewStudy() {
    if (!S.words.length) return emptyState();
    if (S.study) return renderSession();
    if (S.setSel) return setDetail();
    const lg = S.set.filter.lang, A = actv().filter(w => lg === '전체' || w.lang === lg);
    const by = new Map();
    A.forEach(w => { const e = by.get(w.source) || { n: 0, d: 0 }; e.n++; if (w.done) e.d++; by.set(w.source, e); });
    const card = ([name, e]) => {
      const ch = chunkList(name), ok = ch.filter((_, i) => stageOf(name, i, 'test')).length;
      const on = S.multiMode && S.multi.includes(name);
      return `<button class="setcard ${on ? 'sel' : ''}" data-act="${S.multiMode ? 'togglesel' : 'openset'}" data-key="${esc(name)}"><div class="t">${S.multiMode ? (on ? '☑ ' : '☐ ') : ''}${esc(name || '(출처 없음)')}</div>
        <div class="muted">${e.n}단어 · 구간 ${ok}/${ch.length} 완료</div><div class="bar"><i style="width:${Math.round(e.d / e.n * 100)}%;background:var(--ok)"></i></div><div class="muted">암기 ${e.d}/${e.n}</div></button>`;
    };
    const sp = k => `<button class="setcard" data-act="openset" data-key="${k}"><div class="t">${SPECIAL[k]}</div><div class="muted">${setWords(k).length}단어</div></button>`;
    main().innerHTML = `<div class="row fixed" style="align-items:center;margin-bottom:8px"><h2 style="margin:0;flex:1">학습할 세트를 고르세요</h2>
      <button class="${S.multiMode ? 'on' : ''}" data-act="multimode">☑ 합쳐서 학습</button><select data-f="lang" style="width:auto">${opts(langs(), lg, true)}</select></div>
      ${S.multiMode ? '<p class="muted">합칠 세트를 2개 이상 선택하세요. (임시로 합쳐서 학습하는 것이라 단어/시트는 바뀌지 않아요)</p>' : ''}
      ${S.multiMode ? '' : `<div class="setgrid">${sp('__wrong')}${sp('__star')}${sp('__all')}</div>`}
      <h2 style="margin-top:14px">세트 (출처별)</h2><div class="setgrid">${[...by].map(card).join('') || '<p class="muted">단어가 없어요</p>'}</div>
      ${S.multiMode ? `<div class="multibar"><span>${S.multi.length}개 세트 · ${S.multi.reduce((n, k) => n + (by.get(k) ? by.get(k).n : 0), 0)}단어</span><button class="pri" data-act="multistart" ${S.multi.length < 2 ? 'disabled' : ''}>합쳐서 학습 ▶</button></div>` : ''}`;
    bindFilters();
  }
  function setDetail() {
    const key = S.setSel, chunks = chunkList(key);
    S.chunk = Math.max(0, Math.min(S.chunk, chunks.length - 1));
    const ci = S.chunk, list = chunks[ci], f = S.set.filter;
    const rows = list.length;
    const step = (m, i) => { const d = stageOf(key, ci, m); return `<button class="step ${d ? 'dn' : ''}" data-act="mode" data-m="${m}"><b>${i ? i : ''}</b><i>${MN[m][0]}</i><span>${MN[m][1]}${m === 'test' && (S.prog[pkey(key, ci)] || {}).best != null ? ` · 최고 ${S.prog[pkey(key, ci)].best}점` : ''}${m === 'match' && (S.prog[pkey(key, ci)] || {}).matchBest != null ? ` · 최고 ${S.prog[pkey(key, ci)].matchBest}초` : ''}${m === 'crash' && (S.prog[pkey(key, ci)] || {}).crashBest != null ? ` · 최고 ${S.prog[pkey(key, ci)].crashBest}점` : ''}</span><em>${d ? '✔ ' + d.slice(5) : ''}</em></button>`; };
    main().innerHTML = `<div class="row fixed" style="align-items:center"><button class="ghost" data-act="backsets">← 세트</button><h2 style="margin:0;flex:1">${esc(titleOf(key))}</h2></div>
      ${key.startsWith(MULTI) ? `<p class="muted">${key.slice(MULTI.length).split('|').map(esc).join(' + ')}</p>` : ''}
      <div class="card"><div class="row fixed" style="align-items:center;margin-bottom:8px"><span class="muted">구간 크기</span>
        <select id="chsz" style="width:auto">${[[10, '10개'], [20, '20개'], [30, '30개'], [50, '50개'], [0, '전체']].map(([k, v]) => `<option value="${k}" ${S.set.chunk === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="muted">${rows}단어</span></div>
        <div class="pager">${chunks.map((c, i) => `<button class="${i === ci ? 'on' : ''}" data-act="chunk" data-i="${i}">${i + 1}${stageOf(key, i, 'test') ? '✔' : ''}</button>`).join('')}</div></div>
      <div class="card"><h2>단계별 학습 (순서대로 추천)</h2><div class="steps">${FLOW.map((m, i) => step(m, i + 1)).join('')}</div>
        <h2 style="margin-top:12px">게임 · 필기</h2><div class="steps">${step('match', 0)}${step('crash', 0)}
        <button class="step" data-act="mode" data-m="pen"><b></b><i>✍️</i><span>필기 학습 (펜)</span><em></em></button></div></div>
      <div class="card"><div class="grid2">
        <div><label>대상</label><select data-f="mode">${[['all', '구간 전체'], ['unlearned', '미암기만'], ['wrong', '자주 틀린 것'], ['star', '★ 중요'], ['done', '암기한 것(복습)']].map(([k, v]) => `<option value="${k}" ${f.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>순서</label><select data-f="order">${[['seq', '입력 순서'], ['random', '무작위'], ['weak', '약한 것 먼저']].map(([k, v]) => `<option value="${k}" ${f.order === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>카드 방향</label><select data-f="dir"><option value="w2m" ${f.dir === 'w2m' ? 'selected' : ''}>단어 → 뜻</option><option value="m2w" ${f.dir === 'm2w' ? 'selected' : ''}>뜻 → 단어</option></select></div>
        <div><label>테스트</label><select id="tn">${[[10, '10문제'], [20, '20문제'], [50, '50문제'], [0, '전체']].map(([k, v]) => `<option value="${k}" ${S.set.testN === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>테스트 속도</label><select id="ts">${[['none', '제한 없음'], ['slow', '느림 (20초)'], ['normal', '보통 (12초)'], ['fast', '빠름 (7초)'], ['vfast', '매우 빠름 (4초)']].map(([k, v]) => `<option value="${k}" ${S.set.testSpeed === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>테스트 유형</label><select id="tt">${[['mix', '섞어서'], ['mc', '객관식'], ['sub', '주관식'], ['ls', '듣기']].map(([k, v]) => `<option value="${k}" ${S.set.testType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div></div>
      <details class="card"><summary>이 구간 단어 보기 (${rows})</summary><div class="list">${list.map(w => `<div class="it" data-id="${esc(w.id)}" style="grid-template-columns:auto 1fr auto"><span>${w.done ? '✅' : w.wrong > w.right ? '❌' : '⬜'}</span><div data-act="edit"><div class="w">${esc(w.word)}</div><div class="m">${esc(w.meaning)}</div></div><button class="ghost" data-act="say">🔈</button></div>`).join('')}</div></details>`;
    $('#tn').onchange = e => { S.set.testN = +e.target.value; save(); };
    $('#tt').onchange = e => { S.set.testType = e.target.value; save(); };
    $('#ts').onchange = e => { S.set.testSpeed = e.target.value; save(); };
    $('#chsz').onchange = e => { S.set.chunk = +e.target.value; S.chunk = 0; save(); render(); };
    bindFilters();
  }
  const MODES = [['learn', '📖', '암기학습', '단어·뜻을 함께 보며 외우기'], ['recall', '🃏', '리콜학습', '떠올려 보고 알아요/몰라요'], ['spell', '⌨️', '스펠학습', '뜻을 보고 철자 입력'], ['match', '🧩', '매칭게임', '단어와 뜻 짝 맞추기'], ['crash', '☄️', '크래시', '떨어지는 뜻의 단어를 빨리!'], ['test', '📝', '테스트', '객관식·주관식 시험']];
  function renderSession() {
    const st = S.study; if (st.mode === 'pen') return renderCard();
    ({ recall: Modes.recall, learn: Modes.learn, spell: Modes.spell, test: Modes.test, match: Modes.matchDraw, crash: Modes.crashQ })[st.mode]();
  }
  function startStudy(m) {
    const f = S.set.filter;
    const chunks = S.setSel ? chunkList(S.setSel) : [actv()];
    const ci = Math.max(0, Math.min(S.chunk, chunks.length - 1));
    const q = Core.buildQueue(chunks[ci], { lang: '전체', source: '전체', mode: f.mode, order: f.order });
    if (!q.length) return toast('조건에 맞는 단어가 없어요 (대상 설정을 확인하세요)');
    const pen = m === 'pen', mode = pen ? 'pen' : (m || 'recall');
    const st = S.study = { q, i: 0, rev: false, dir: pen ? 'm2w' : f.dir, pen, mode, trace: S.set.penMode === 'trace', ok: 0, bad: 0, again: new Set(), known: new Set(), total: q.length, hint: 0, strokes: [], res: null, setKey: S.setSel, ci, stage: mode };
    wake(true); prefetch(q.slice(0, 30));
    if (mode === 'test') { Modes.buildTest(st); render(); }
    else if (mode === 'match') Modes.matchStart(st);
    else if (mode === 'crash') Modes.crashStart(st);
    else render();
  }
  function curW() { return S.study.q[S.study.i]; }

  function renderCard() {
    const st = S.study, w = curW();
    if (!w) return finishStudy();
    const front = st.dir === 'w2m' ? w.word : w.meaning;
    const back = st.dir === 'w2m' ? w.meaning : w.word;
    const pct = Math.round(st.known.size / st.total * 100);
    main().innerHTML = `<div class="sess">
      <div class="row fixed" style="justify-content:space-between"><button class="ghost" data-act="quit">✕ 종료</button>
        <span class="muted">마스터 ${st.known.size}/${st.total} · 남은 카드 ${st.q.length - st.i} · ❌${st.bad}</span>
        <button class="ghost ${st.pen ? 'on' : ''}" data-act="togglepen">✍️ 필기</button></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="card flash ${st.anim ? 'flip' : ''}" id="flash">
        <div class="meta"><span class="chip">${esc(w.lang)} · ${esc(w.source)}</span>
          <button class="star" data-act="star">${w.star ? '★' : '☆'}</button></div>
        <div class="front">${esc(front)}</div>
        ${st.dir === 'w2m' || st.rev ? `<button class="spk" data-act="speak" aria-label="발음 듣기">🔈</button>` : ''}
        ${st.pen ? padHtml(w) : ''}
        <div class="back ${st.rev ? '' : 'hide'}">${esc(back)}</div>
        ${st.rev && w.memo ? `<div class="memo">📝 ${esc(w.memo)}</div>` : ''}
        ${st.rev ? `<div class="muted">${w.right}✅ ${w.wrong}❌${w.done ? ' · 암기완료' : ''}</div>` : (st.pen ? '' : '<div class="muted">카드를 탭하면 정답이 보여요</div>')}
      </div>
      ${st.rev ? `<div class="acts"><button class="bad" data-act="no">❌ 몰라요<br><span class="kbd">←  / 1</span></button>
        <button class="ok" data-act="yes">✅ 알아요<br><span class="kbd">→  / 2</span></button>
        <button class="pri" data-act="mem">🎯 암기완료<br><span class="kbd">3</span></button></div>`
        : `<div class="acts"><button class="pri" data-act="reveal">${st.pen ? '✔ 다 썼어요 (정답 보기)' : '정답 보기'}<br><span class="kbd">Space</span></button></div>`}
    </div>`;
    st.anim = false;
    if (st.pen) initPad();
    if (!st.rev && st.dir === 'w2m' && S.set.autoSpeak) say(w);
    bindSwipe();
  }

  function reveal() { const st = S.study; if (!st || st.rev) return; st.rev = true; st.anim = true; if (st.pen) st.strokes = padSnapshot(); renderCard(); const w = curW(); if (st.dir === 'm2w' && S.set.autoSpeak) say(w); }
  function grade(kind) {
    const st = S.study; if (!st || !st.rev) return;
    const w = curW();
    w.reviews++; w.lastReview = Core.today();
    if (kind === 'no') { w.wrong++; w.done = false; w.doneDate = ''; st.bad++; st.q.splice(Math.min(st.q.length, st.i + 4), 0, w); }
    else { w.right++; st.ok++; st.known.add(w.id); if (kind === 'mem') { w.done = true; w.doneDate = Core.today(); } }
    touch(w);
    st.i++; st.rev = false; st.hint = 0; st.strokes = [];
    renderCard();
  }
  function finishStudy() {
    const st = S.study; markStage(st.stage);
    main().innerHTML = `<div class="card" style="text-align:center"><div class="big">🎉 ${MN[st.stage] ? MN[st.stage][1] : ''} 완료!</div>
      <p>${st.extra || `✅ ${st.ok} &nbsp; ❌ ${st.bad} &nbsp; (총 ${st.i}장)`}</p>
      <div class="row">${nextHtml()}<button data-act="restart">다시 하기</button><button data-act="quit">세트로</button></div></div>`;
  }
  function bindSwipe() {
    const el = $('#flash'); if (!el) return;
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', e => { if (e.target.closest('.pad,button')) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { S.study.rev ? grade(dx > 0 ? 'yes' : 'no') : reveal(); }
    });
    el.addEventListener('click', e => { if (e.target.closest('button,.pad')) return; if (!S.study.rev) reveal(); });
  }

  /* ---------- 필기 패드 (펜/손가락) ---------- */
  const COLORS = ['ink', '#d64545', '#1f6feb'];
  const pad = { strokes: [], color: COLORS[0], width: 3, tool: 'pen', cur: null, penSeen: false, cv: null, ctx: null };
  function padHtml(w) {
    const st = S.study;
    return `<div class="pad"><div class="cv" id="cv">
      ${st.trace ? `<div class="ghostword">${esc(w.word)}</div>` : ''}${st.rev ? `<div class="ghostword" style="opacity:.55;color:var(--ok)">${esc(w.word)}</div>` : ''}
      <canvas id="canvas"></canvas></div>
      <div class="tools">
        ${COLORS.map(c => `<button class="sw ${pad.color === c && pad.tool === 'pen' ? 'on' : ''}" data-act="color" data-c="${c}" style="background:${c === 'ink' ? 'var(--ink)' : c}" aria-label="색"></button>`).join('')}
        <button class="${pad.tool === 'erase' ? 'on' : ''}" data-act="erase">🧽 지우개</button>
        <button data-act="undo">↩ 실행취소</button><button data-act="clear">🗑 전체</button>
        <button class="${st.trace ? 'on' : ''}" data-act="trace">따라쓰기</button>
        <button data-act="hint">💡 힌트</button>
        <span class="muted" id="hintTxt">${st.hint ? esc(w.word.slice(0, st.hint)) + '…' : ''}</span>
      </div></div>`;
  }
  function padSnapshot() { return pad.strokes.slice(); }
  function initPad() {
    const cv = $('#canvas'); if (!cv) return;
    pad.cv = cv; pad.ctx = cv.getContext('2d');
    const fit = () => { const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; redraw(); };
    fit(); new ResizeObserver(fit).observe(cv);
    pad.strokes = S.study.strokes.slice();
    redraw();
    cv.onpointerdown = e => {
      if (e.pointerType === 'pen') pad.penSeen = true;
      if (e.pointerType === 'touch' && (S.set.penOnly && pad.penSeen)) return;      // 펜을 쓰는 중이면 손바닥 무시
      cv.setPointerCapture(e.pointerId); e.preventDefault();
      const erase = pad.tool === 'erase' || (e.buttons & 32) || e.button === 5;
      pad.cur = { c: pad.color, w: pad.width, er: !!erase, p: [pt(e)] };
      pad.strokes.push(pad.cur); redraw();
    };
    cv.onpointermove = e => {
      if (!pad.cur) return; e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) pad.cur.p.push(pt(ev));
      redraw();
    };
    const up = () => { pad.cur = null; S.study.strokes = pad.strokes.slice(); };
    cv.onpointerup = up; cv.onpointercancel = up;
    cv.oncontextmenu = e => e.preventDefault();
  }
  function pt(e) { const r = pad.cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pointerType === 'pen' ? (e.pressure || .5) : .5]; }
  function redraw() {
    const { cv, ctx } = pad; if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const d = window.devicePixelRatio || 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#111';
    for (const s of pad.strokes) {
      ctx.globalCompositeOperation = s.er ? 'destination-out' : 'source-over';
      const col = s.c === 'ink' ? ink : s.c; ctx.strokeStyle = col;
      const P = s.p.map(([x, y, pr]) => [x * cv.width, y * cv.height, pr]);
      if (P.length === 1) { ctx.beginPath(); ctx.fillStyle = col; ctx.arc(P[0][0], P[0][1], s.w * d, 0, 7); ctx.fill(); continue; }
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i];
        ctx.lineWidth = (s.er ? 18 : s.w * (0.5 + 1.3 * b[2])) * d;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ================= 듣기 ================= */
  function viewListen() {
    if (!S.words.length) return emptyState();
    const L = S.listen;
    if (!L) {
      main().innerHTML = `${filterBox(false, '듣기 설정 (걸으면서 귀로 외우기)')}
      <div class="card"><div class="grid2"><div><label>단어 반복</label><select id="rep">${[1, 2, 3].map(n => `<option ${S.set.repeat == n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label>간격(초)</label><select id="gap">${[1, 2, 3, 5].map(n => `<option ${S.set.gap == n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <label>속도 ${S.set.rate}</label><input type="range" id="rate" min="0.5" max="1.4" step="0.1" value="${S.set.rate}"></div>
      <button class="pri" style="width:100%;min-height:64px;font-size:1.15rem" data-act="lstart">▶ 듣기 시작</button>
      <p class="muted">단어 → (간격) → 뜻 순서로 계속 읽어줍니다. 화면을 끄면 브라우저가 소리를 멈출 수 있어, 켜 둔 채(자동으로 화면 유지) 사용하세요.</p>`;
      bindFilters();
      $('#rep').onchange = e => { S.set.repeat = +e.target.value; save(); };
      $('#gap').onchange = e => { S.set.gap = +e.target.value; save(); };
      $('#rate').oninput = e => { S.set.rate = +e.target.value; save(); e.target.previousElementSibling.textContent = '속도 ' + S.set.rate; };
      return;
    }
    const w = L.q[L.i];
    main().innerHTML = `<div class="sess"><div class="row fixed" style="justify-content:space-between"><button class="ghost" data-act="lquit">✕ 종료</button>
      <span class="muted">${L.i + 1} / ${L.q.length}</span><span></span></div>
      <div class="bar"><i style="width:${Math.round(L.i / L.q.length * 100)}%"></i></div>
      <div class="card flash"><span class="chip">${esc(w.lang)} · ${esc(w.source)}</span>
        <div class="front">${esc(w.word)}</div><div class="back ${L.phase === 'm' ? '' : 'hide'}">${esc(w.meaning)}</div></div>
      <div class="acts"><button data-act="lprev">⏮</button><button class="pri" data-act="lplay">${L.playing ? '⏸ 일시정지' : '▶ 재생'}</button><button data-act="lnext">⏭</button></div>
      <div class="acts"><button data-act="lstar">${w.star ? '★ 중요 해제' : '☆ 중요 표시'}</button><button data-act="lwrong">❌ 어려움(오답 +1)</button></div></div>`;
  }
  function startListen() {
    const q = Core.buildQueue(S.words, S.set.filter);
    if (!q.length) return toast('조건에 맞는 단어가 없어요');
    S.listen = { q, i: 0, playing: true, phase: 'w', tok: 0 }; prefetch(q.slice(0, 40));
    render(); runListen();
  }
  async function runListen() {
    const L = S.listen; if (!L) return;
    const tok = ++L.tok; L.playing = true;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const alive = () => S.listen === L && L.tok === tok && L.playing;
    while (alive() && L.i < L.q.length) {
      const w = L.q[L.i];
      L.phase = 'w'; if (S.view === 'listen') viewListen();
      for (let k = 0; k < S.set.repeat && alive(); k++) { await speakWord(w); await sleep(500); }
      if (!alive()) break;
      await sleep(S.set.gap * 1000); if (!alive()) break;
      L.phase = 'm'; if (S.view === 'listen') viewListen();
      await speakMeaning(w); if (!alive()) break;
      await sleep(S.set.gap * 1000); if (!alive()) break;
      w.reviews++; w.lastReview = Core.today(); touch(w);
      L.i++;
    }
    if (alive()) { L.playing = false; toast('끝까지 들었어요 🎉'); S.listen = null; if (S.view === 'listen') viewListen(); }
  }
  function stopListen() { if (S.listen) { S.listen.playing = false; S.listen.tok++; } stopSpeech(); S.listen = null; }

  /* ================= 단어 관리 ================= */
  function viewWords() {
    if (!S.words.length) return emptyState();
    const q = S.search.trim().toLowerCase();
    let list = S.words.filter(w => {
      if (S.fl.st === '활성' ? w.deleted : S.fl.st === '삭제됨' ? !w.deleted : false) return false;
      if (S.fl.st === '미암기' && (w.deleted || w.done)) return false;
      if (S.fl.st === '암기' && (w.deleted || !w.done)) return false;
      if (S.fl.lang !== '전체' && w.lang !== S.fl.lang) return false;
      if (S.fl.source !== '전체' && w.source !== S.fl.source) return false;
      return !q || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q);
    });
    const total = list.length; list = list.slice(0, S.shown);
    main().innerHTML = `<div class="card"><input id="q" type="search" placeholder="🔍 단어·뜻 검색" value="${esc(S.search)}">
      <div class="grid2" style="margin-top:8px"><select data-fl="lang">${opts(langs(), S.fl.lang, true)}</select>
      <select data-fl="source">${opts(sources(), S.fl.source, true)}</select>
      <select data-fl="st">${['활성', '미암기', '암기', '삭제됨'].map(x => `<option ${S.fl.st === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button data-act="bulk">📋 여러 개 붙여넣기</button></div>
      <p class="muted">${total}개</p></div>
      <div class="card list">${list.map(w => `<div class="it ${w.deleted ? 'del' : ''}" data-id="${esc(w.id)}">
        <input type="checkbox" data-act="done" ${w.done ? 'checked' : ''} aria-label="암기">
        <div data-act="edit"><div class="w">${esc(w.word)} ${w.star ? '⭐' : ''}${w.wrong > w.right ? '<span class="badge w">어려움</span>' : ''}</div>
          <div class="m">${esc(w.meaning)}</div><div class="m" style="font-size:.72rem">${esc(w.lang)} · ${esc(w.source)}</div></div>
        <button class="ghost" data-act="say">🔈</button></div>`).join('') || '<p class="muted">없음</p>'}
        ${total > list.length ? `<button style="width:100%" data-act="more">더 보기 (${total - list.length})</button>` : ''}</div>
      <button class="pri fab" data-act="add" aria-label="추가">＋</button>`;
    $('#q').oninput = e => { S.search = e.target.value; clearTimeout(viewWords.t); viewWords.t = setTimeout(() => { viewWords(); const i = $('#q'); i.focus(); i.setSelectionRange(99, 99); }, 250); };
    $$('[data-fl]').forEach(el => el.onchange = () => { S.fl[el.dataset.fl] = el.value; S.shown = 100; viewWords(); });
  }
  function editDlg(w) {
    const isNew = !w; w = w || { id: '', lang: S.fl.lang !== '전체' ? S.fl.lang : '영어', source: S.fl.source !== '전체' ? S.fl.source : '', word: '', meaning: '', star: 0, memo: '', done: false, deleted: false };
    openDlg(`<h2>${isNew ? '단어 추가' : '단어 수정'}</h2>
      <label>단어</label><input id="e_word" value="${esc(w.word)}" autocapitalize="none" autocomplete="off">
      <label>뜻</label><input id="e_meaning" value="${esc(w.meaning)}">
      <div class="grid2"><div><label>언어</label><input id="e_lang" list="dl_lang" value="${esc(w.lang)}"></div>
      <div><label>출처</label><input id="e_source" list="dl_src" value="${esc(w.source)}"></div></div>
      <datalist id="dl_lang">${langs().map(l => `<option>${esc(l)}`).join('')}</datalist><datalist id="dl_src">${sources().map(l => `<option>${esc(l)}`).join('')}</datalist>
      <label>메모</label><input id="e_memo" value="${esc(w.memo)}">
      <div class="row fixed" style="margin-top:8px"><label style="margin:0"><input type="checkbox" id="e_star" ${w.star ? 'checked' : ''} style="width:auto;min-height:0"> ⭐ 중요</label>
      <label style="margin:0"><input type="checkbox" id="e_done" ${w.done ? 'checked' : ''} style="width:auto;min-height:0"> 암기완료</label></div>
      <div class="row" style="margin-top:14px">${!isNew ? `<button class="bad" id="e_del">${w.deleted ? '복원' : '삭제'}</button>` : ''}<button id="e_cancel">취소</button><button class="pri" id="e_ok">저장</button></div>`);
    $('#e_cancel').onclick = closeDlg;
    $('#e_ok').onclick = () => {
      const word = $('#e_word').value.trim(), meaning = $('#e_meaning').value.trim();
      if (!word || !meaning) return toast('단어와 뜻을 입력하세요');
      if (isNew) { w.id = Core.newId(); w.date = Core.today(); w.reviews = w.right = w.wrong = 0; w.doneDate = w.lastReview = ''; S.words.push(w); }
      Object.assign(w, { word, meaning, lang: $('#e_lang').value.trim() || '영어', source: $('#e_source').value.trim(), memo: $('#e_memo').value, star: $('#e_star').checked ? 1 : 0 });
      const d = $('#e_done').checked; if (d && !w.done) w.doneDate = Core.today(); if (!d) w.doneDate = ''; w.done = d;
      touch(w); closeDlg(); render();
    };
    if ($('#e_del')) $('#e_del').onclick = () => { w.deleted = !w.deleted; touch(w); closeDlg(); render(); toast(w.deleted ? '삭제했어요 (설정에서 복원 가능)' : '복원했어요'); };
    if (isNew) $('#e_word').focus();
  }
  function bulkDlg() {
    openDlg(`<h2>여러 단어 붙여넣기</h2><p class="muted">한 줄에 하나: <code>단어, 뜻</code> (쉼표·탭·콜론 구분). 엑셀에서 두 열을 복사해 붙여넣어도 돼요.</p>
      <textarea id="b_t" placeholder="apple, 사과&#10;banana, 바나나"></textarea>
      <div class="grid2"><div><label>언어</label><input id="b_lang" list="dl_lang" value="${esc(S.fl.lang !== '전체' ? S.fl.lang : '영어')}"></div><div><label>출처</label><input id="b_src" list="dl_src" value="${esc(S.fl.source !== '전체' ? S.fl.source : '직접 입력')}"></div></div>
      <datalist id="dl_lang">${langs().map(l => `<option>${esc(l)}`).join('')}</datalist><datalist id="dl_src">${sources().map(l => `<option>${esc(l)}`).join('')}</datalist>
      <div class="row" style="margin-top:14px"><button id="b_cancel">취소</button><button class="pri" id="b_ok">추가</button></div>`);
    $('#b_cancel').onclick = closeDlg;
    $('#b_ok').onclick = () => {
      const items = Core.parseBulk($('#b_t').value); if (!items.length) return toast('인식된 줄이 없어요');
      const lang = $('#b_lang').value.trim() || '영어', source = $('#b_src').value.trim();
      const have = new Set(S.words.filter(w => !w.deleted).map(w => w.lang + '|' + w.word.toLowerCase()));
      let n = 0, skip = 0;
      for (const it of items) {
        if (have.has(lang + '|' + it.word.toLowerCase())) { skip++; continue; }
        S.words.push({ id: Core.newId(), date: Core.today(), lang, source, word: it.word, meaning: it.meaning, done: false, doneDate: '', reviews: 0, right: 0, wrong: 0, lastReview: '', star: 0, memo: '', updated: Date.now(), deleted: false }); n++;
      }
      save(); queueSync(); closeDlg(); render(); toast(`${n}개 추가${skip ? `, 중복 ${skip}개 건너뜀` : ''}`);
    };
  }
  function openDlg(html) { const d = $('#dlg'); d.innerHTML = html; if (!d.open) d.showModal(); }
  function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); }

  /* ================= 통계 ================= */
  function viewStats() {
    const act = S.words.filter(w => !w.deleted), done = act.filter(w => w.done).length, td = Core.today();
    const by = key => { const m = {}; act.forEach(w => { (m[w[key]] = m[w[key]] || { n: 0, d: 0 }).n++; if (w.done) m[w[key]].d++; }); return Object.entries(m); };
    const bars = key => by(key).map(([k, v]) => `<div class="hb"><span>${esc(k || '(없음)')}</span><div class="bar"><i style="width:${Math.round(v.d / v.n * 100)}%;background:var(--ok)"></i></div><span>${v.d}/${v.n}</span></div>`).join('');
    const hard = act.filter(w => w.wrong > 0).sort((a, b) => (b.wrong - b.right) - (a.wrong - a.right)).slice(0, 10);
    main().innerHTML = `<div class="card"><h2>한눈에 보기</h2><div class="stat">
      <div><b>${act.length}</b>전체</div><div><b>${done}</b>암기</div><div><b>${act.length - done}</b>미암기</div>
      <div><b>${act.length ? Math.round(done / act.length * 100) : 0}%</b>암기율</div>
      <div><b>${act.filter(w => w.lastReview === td).length}</b>오늘 복습</div><div><b>${act.filter(w => w.date === td).length}</b>오늘 추가</div></div></div>
      <div class="card"><h2>언어별 암기</h2>${bars('lang')}</div><div class="card"><h2>출처별 암기</h2>${bars('source')}</div>
      <div class="card"><h2>자주 틀리는 단어 TOP 10</h2>${hard.map(w => `<div class="hb" style="grid-template-columns:1fr auto"><span><b>${esc(w.word)}</b> ${esc(w.meaning)}</span><span>❌${w.wrong} ✅${w.right}</span></div>`).join('') || '<p class="muted">아직 없어요</p>'}</div>`;
  }

  /* ================= 설정 / 동기화 ================= */
  function viewSettings() {
    const g = Cloud.cfgGet();
    main().innerHTML = `<div class="card"><h2>☁️ Google 스프레드시트 동기화</h2>
      <p class="muted">상태: <b id="st2">${syncLabel()}</b></p>
      <label>Google Client ID (README 참고)</label><input id="g_id" value="${esc(g.clientId || '')}" autocomplete="off">
      <label>스프레드시트 주소 (또는 ID)</label><input id="g_path" value="${esc(g.sheet || '')}" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off">
      <p class="muted">승인된 JavaScript 원본(Google에 등록): <code>${esc(Cloud.origin())}</code></p>
      <div class="row">${Cloud.loggedIn() ? `<button class="pri" data-act="sync">지금 동기화</button><button data-act="logout">로그아웃</button>` : `<button class="pri" data-act="login">Google 로그인</button>`}</div></div>
      <div class="card"><h2>📁 엑셀 파일</h2><div class="row"><button data-act="import">불러오기 (.xlsx)</button><button data-act="export">내보내기 (.xlsx)</button></div>
      <p class="muted">새 형식(ID 열 있음)과 예전 형식(날짜·구분·단어·뜻·사전·암기여부…) 모두 불러올 수 있어요. 내보내기 파일은 서식 없이 데이터만 담깁니다.</p></div>
      <div class="card"><h2>🔊 발음 (TTS)</h2>
      <p class="muted">미리 만들어 둔 고품질(신경망) 음성 <b id="aucnt">…</b>개가 앱에 들어 있어요. 새 단어는 노트북에서 <code>tools/gen_audio.py</code>를 다시 실행하면 추가됩니다. 없는 단어는 아래 설정으로 읽어요.</p>
      <button data-act="cacheaudio" style="margin-bottom:8px">📥 오프라인용으로 음성 전부 저장</button>
      ${chk('s_human', '파일 없는 영어 단어는 인터넷 사전 녹음 사용 (온라인)', S.set.human)}
      ${[['en-US', '영어'], ['es-ES', '스페인어'], ['ko-KR', '한국어(뜻)']].map(([l, n]) => `<label>${n} 음성</label><div class="row"><select data-voice="${l}"><option value="">자동(가장 자연스러운 음성)</option>${voicesFor(l).map(v => `<option ${((S.set.voice || {})[l] === v.name) ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select><button class="fixed" data-act="vtest" data-l="${l}">▶</button></div>`).join('')}
      <label>속도 ${S.set.rate}</label><input type="range" id="s_rate" min="0.6" max="1.3" step="0.05" value="${S.set.rate}">
      <p class="muted">이름에 Natural / Online / Google 이 들어간 음성이 더 자연스러워요. 안드로이드: 설정 → 일반 → 텍스트 음성 변환 → Google 음성 설치·업데이트(고품질). 노트북은 Edge가 "Natural" 음성을 제공해요.</p></div>
      <div class="card"><h2>🎨 화면 · 학습</h2><div class="grid2">
      <div><label>테마</label><select id="s_theme">${[['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']].map(([k, v]) => `<option value="${k}" ${S.set.theme === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label>글자 크기 ${S.set.fs}</label><input type="range" id="s_fs" min="0.85" max="1.5" step="0.05" value="${S.set.fs}"></div></div>
      ${chk('s_auto', '카드 나오면 발음 자동 재생', S.set.autoSpeak)}${chk('s_wake', '학습·듣기 중 화면 켜 두기', S.set.wake)}
      ${chk('s_pen', '펜 사용 시 손바닥(터치) 무시', S.set.penOnly)}</div>
      <div class="card"><h2>🗑 삭제된 단어</h2><p class="muted">삭제된 단어: ${S.words.filter(w => w.deleted).length}개 (단어 탭 → 필터 "삭제됨"에서 복원)</p>
      <button class="bad" data-act="wipe">이 기기의 데이터 초기화</button></div>`;
    const sv = () => { Cloud.cfgSet({ clientId: $('#g_id').value.trim(), sheet: $('#g_path').value.trim() }); };
    $('#g_id').onchange = sv; $('#g_path').onchange = sv;
    $('#s_theme').onchange = e => { S.set.theme = e.target.value; save(); applyTheme(); };
    $('#s_fs').oninput = e => { S.set.fs = +e.target.value; applyTheme(); e.target.previousElementSibling.textContent = '글자 크기 ' + S.set.fs; save(); };
    audioIdx().then(i => { const el = $('#aucnt'); if (el) el.textContent = Object.keys(i).length; });
    $('#s_human').onchange = e => { S.set.human = e.target.checked; save(); };
    $('#s_rate').oninput = e => { S.set.rate = +e.target.value; save(); e.target.previousElementSibling.textContent = '속도 ' + S.set.rate; };
    $$('[data-voice]').forEach(el => el.onchange = () => { S.set.voice = S.set.voice || {}; S.set.voice[el.dataset.voice] = el.value; save(); });
    $('#s_auto').onchange = e => { S.set.autoSpeak = e.target.checked; save(); };
    $('#s_wake').onchange = e => { S.set.wake = e.target.checked; save(); };
    $('#s_pen').onchange = e => { S.set.penOnly = e.target.checked; save(); };
  }
  const chk = (id, t, v) => `<label style="display:flex;gap:10px;align-items:center;color:var(--ink);font-size:.95rem"><input type="checkbox" id="${id}" ${v ? 'checked' : ''} style="width:22px;min-height:0"> ${t}</label>`;
  function emptyState() {
    main().innerHTML = `<div class="card" style="text-align:center"><div class="big">👋</div><h2>단어를 가져오세요</h2>
      <p class="muted">엑셀 파일을 불러오거나 Google 시트를 연결하면 단어가 채워져요.</p>
      <div class="row"><button class="pri" data-act="import">엑셀 불러오기</button><button data-act="goset">Google 연결 (설정)</button><button data-act="add2">직접 추가</button></div></div>`;
  }

  /* ---------- 엑셀 가져오기/내보내기 ---------- */
  function importFile(f) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const wb = XLSX.read(rd.result, { type: 'array' });
        const ws = wb.Sheets['단어'] || wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        const h = rows[0] || [];
        let list = [];
        if (String(h[0]).trim() === 'ID') list = rows.slice(1).map(r => Core.fromRow(r.slice(0, 16))).filter(w => w.word);
        else if (String(h[2]).trim() === '단어') {                                  // 예전 형식
          const seen = new Set(S.words.map(w => w.lang + '|' + w.word.toLowerCase() + '|' + w.source));
          for (const r of rows.slice(1)) {
            if (!r[2]) continue;
            const w = { id: '', date: Core.serialToDate(r[0]) || Core.today(), lang: r[7] || '영어', source: String(r[1] || '').trim(), word: String(r[2]).trim(), meaning: String(r[3] || '').trim(),
              done: r[5] === true || String(r[5]).toUpperCase() === 'TRUE', doneDate: '', reviews: 0, right: 0, wrong: 0, lastReview: '', star: 0, memo: '', updated: Date.now(), deleted: false };
            const key = w.lang + '|' + w.word.toLowerCase() + '|' + w.source; if (seen.has(key)) continue; seen.add(key); list.push(w);
          }
        } else return toast('인식할 수 없는 엑셀 형식이에요');
        for (const w of list) if (!w.id) w.id = Core.newId();
        const m = Core.merge(S.words, list, S.base);
        S.words = m.rows; save(); queueSync(); toast(`${list.length}개 불러왔어요`); render();
      } catch (e) { toast('불러오기 실패: ' + e.message); }
    };
    rd.readAsArrayBuffer(f);
  }
  function exportFile() {
    const aoa = [Core.HEADERS, ...S.words.map(Core.toRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    S.words.forEach((_, i) => { [1, 7, 11].forEach(c => { const a = XLSX.utils.encode_cell({ r: i + 1, c }); if (ws[a] && ws[a].v !== '') ws[a].z = 'yyyy-mm-dd'; });
      const a = XLSX.utils.encode_cell({ r: i + 1, c: 14 }); if (ws[a]) ws[a].z = 'yyyy-mm-dd hh:mm'; });
    ws['!cols'] = [9, 11, 9, 34, 22, 26, 10, 11, 9, 9, 9, 12, 6, 26, 17, 6].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '단어');
    XLSX.writeFile(wb, '단어_암기_리스트.xlsx');
  }

  /* ---------- 동기화 ---------- */
  function syncLabel() {
    const s = S.sync;
    if (!Cloud.loggedIn()) return '로컬 전용 (로그인 안 됨)';
    return { busy: '동기화 중…', ok: '동기화됨 ' + new Date(s.last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), err: '오류: ' + (s.msg || ''), offline: '오프라인 (나중에 자동 동기화)', local: '대기' }[s.state] || '';
  }
  function setSync(state, msg) {
    S.sync.state = state; S.sync.msg = msg || '';
    $('#syncTxt').textContent = !Cloud.loggedIn() ? '로컬' : { busy: '동기화 중', ok: '완료', err: '오류', offline: '오프라인', local: '대기' }[state];
    const st2 = $('#st2'); if (st2) st2.textContent = syncLabel();
  }
  let syncQ = null;
  function queueSync() { if (!Cloud.loggedIn()) return; clearTimeout(syncQ); syncQ = setTimeout(() => sync(false), 4000); }
  async function sync(manual) {
    if (S.sync.busy) return;
    if (!Cloud.loggedIn()) { if (manual) toast('설정에서 Google 로그인을 먼저 하세요'); return; }
    if (!navigator.onLine) return setSync('offline');
    S.sync.busy = true; setSync('busy');
    try {
      const { values, firstRow } = await Cloud.readTable();
      const remote = [], rowOf = new Map(), fresh = new Set();
      values.forEach((v, idx) => {
        const w = Core.fromRow(v.slice(0, 16));
        if (!w.id && !w.word) return;
        if (!w.id) { w.id = Core.newId(); w.updated = Date.now(); fresh.add(w.id); }
        rowOf.set(w.id, firstRow + idx); remote.push(w);
      });
      const m = Core.merge(S.words, remote, S.base);
      const upd = [], add = [], pushed = new Set();
      for (const w of m.toPush) { pushed.add(w.id); rowOf.has(w.id) ? upd.push({ sheetRow: rowOf.get(w.id), cells: Core.toRow(w) }) : add.push(w); }
      for (const w of m.rows) if (fresh.has(w.id) && !pushed.has(w.id)) upd.push({ sheetRow: rowOf.get(w.id), cells: Core.toRow(w) });
      if (upd.length) await Cloud.writeRows(upd);
      if (add.length) await Cloud.addRows(add.map(Core.toRow), firstRow + values.length);
      S.words = m.rows; S.base = {}; S.words.forEach(w => S.base[w.id] = Core.sig(w));
      S.sync.last = Date.now(); save(); setSync('ok');
      if (manual || m.changedLocal) toast(`동기화 완료 (↓${m.changedLocal} ↑${upd.length + add.length})`);
      if (m.changedLocal && !S.study && !S.listen) render();
    } catch (e) {
      if (e.message === 'NEEDLOGIN') { setSync('err', '다시 로그인이 필요해요 → 설정에서 "지금 동기화"'); if (manual) toast('로그인 창이 열리지 않았어요. 팝업 허용 후 다시 눌러 주세요'); }
      else { setSync('err', e.message); if (manual) toast('동기화 실패: ' + e.message); }
    } finally { S.sync.busy = false; }
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', async e => {
    const nb = e.target.closest('#nav button'); if (nb) return go(nb.dataset.view);
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.closest('[data-id]') && b.closest('[data-id]').dataset.id;
    const word = id && S.words.find(w => w.id === id);
    switch (act) {
      case 'sync': return sync(true);
      case 'mode': return startStudy(b.dataset.m);
      case 'openset': S.setSel = b.dataset.key; S.chunk = 0; return render();
      case 'backsets': S.setSel = null; return render();
      case 'multimode': S.multiMode = !S.multiMode; S.multi = []; return render();
      case 'togglesel': { const k = b.dataset.key, i = S.multi.indexOf(k); i >= 0 ? S.multi.splice(i, 1) : S.multi.push(k); return render(); }
      case 'multistart': if (S.multi.length < 2) return toast('세트를 2개 이상 선택하세요'); S.setSel = MULTI + S.multi.join('|'); S.chunk = 0; return render();
      case 'chunk': S.chunk = +b.dataset.i; return render();
      case 'nextchunk': S.chunk++; S.study = null; Modes.stopTimers(); return render();
      case 'restart': return startStudy(S.study.pen ? 'pen' : S.study.mode);
      case 'quit': Modes.stopTimers(); stopSpeech(); S.study = null; return render();
      case 'lprevL': return Modes.learnPrev(); case 'lnextL': return Modes.learnNext(false); case 'lmemL': return Modes.learnNext(true);
      case 'spok': return Modes.spellCheck(); case 'spnext': return Modes.spellNext();
      case 'sphint': { const v = $('#sp').value; S.study.hint = Math.min(curW().word.length, S.study.hint + 1); Modes.spell(); $('#sp').value = v; $('#sp').dispatchEvent(new Event('input')); return; }
      case 'splisten': return speakWord(curW());
      case 'lautoL': return Modes.learnAuto();
      case 'lrevL': return Modes.learnReveal();
      case 'lconfL': return Modes.learnConfused();
      case 'rcpick': return Modes.recallPick(+b.dataset.k);
      case 'rcnext': return Modes.recallNext();
      case 'tplay': return Modes.testPlay();
      case 'tch': return Modes.testPick(+b.dataset.k); case 'tskip': return Modes.testSkip(); case 'tsub': return Modes.testSub();
      case 'tnext': return Modes.testNext(); case 'tretry': return Modes.testRetry(); case 'tmem': return Modes.testMemAll();
      case 'mt': return Modes.matchTap(+b.dataset.k);
      case 'cpick': return Modes.crashHit(+b.dataset.k);
      case 'cacheaudio': { const idx = await audioIdx(), fs = [...new Set(Object.values(idx))]; let n = 0; toast('저장 중… 잠시만요'); for (let i = 0; i < fs.length; i += 8) { await Promise.all(fs.slice(i, i + 8).map(f => fetch('audio/' + f).then(r => r.blob()).catch(() => 0))); n = Math.min(fs.length, i + 8); } return toast(`음성 ${n}개 저장 완료`); }
      case 'vtest': { const l = b.dataset.l; const sel = $(`[data-voice="${l}"]`); S.set.voice = S.set.voice || {}; S.set.voice[l] = sel.value; stopSpeech(); return speak({ 'en-US': 'The quick brown fox jumps over the lazy dog.', 'es-ES': 'Hola, ¿cómo estás? Vamos a estudiar.', 'ko-KR': '안녕하세요, 단어를 외워 볼까요?' }[l], l); }
      case 'reveal': return reveal();
      case 'yes': return grade('yes'); case 'no': return grade('no'); case 'mem': return grade('mem');
      case 'speak': return say(curW());
      case 'star': { const w = curW(); w.star = w.star ? 0 : 1; touch(w); b.textContent = w.star ? '★' : '☆'; return; }
      case 'togglepen': { const st = S.study; st.pen = !st.pen; st.dir = st.pen ? 'm2w' : S.set.filter.dir; st.strokes = []; return renderCard(); }
      case 'trace': { S.study.trace = !S.study.trace; S.set.penMode = S.study.trace ? 'trace' : 'recall'; save(); S.study.strokes = pad.strokes.slice(); return renderCard(); }
      case 'hint': { const st = S.study; st.hint = Math.min(curW().word.length, st.hint + 1); st.strokes = pad.strokes.slice(); $('#hintTxt').textContent = curW().word.slice(0, st.hint) + '…'; return; }
      case 'color': pad.color = b.dataset.c; pad.tool = 'pen'; S.study.strokes = pad.strokes.slice(); return renderCard();
      case 'erase': pad.tool = pad.tool === 'erase' ? 'pen' : 'erase'; S.study.strokes = pad.strokes.slice(); return renderCard();
      case 'undo': pad.strokes.pop(); S.study.strokes = pad.strokes.slice(); return redraw();
      case 'clear': pad.strokes = []; S.study.strokes = []; return redraw();
      case 'lstart': return startListen();
      case 'lquit': stopListen(); return render();
      case 'lplay': { const L = S.listen; if (L.playing) { L.playing = false; L.tok++; stopSpeech(); viewListen(); } else { runListen(); viewListen(); } return; }
      case 'lnext': case 'lprev': { const L = S.listen; stopSpeech(); L.tok++; L.i = Math.max(0, Math.min(L.q.length - 1, L.i + (act === 'lnext' ? 1 : -1))); L.phase = 'w'; if (L.playing) runListen(); viewListen(); return; }
      case 'lstar': { const w = S.listen.q[S.listen.i]; w.star = w.star ? 0 : 1; touch(w); return viewListen(); }
      case 'lwrong': { const w = S.listen.q[S.listen.i]; w.wrong++; w.done = false; touch(w); return toast('어려운 단어로 표시했어요'); }
      case 'done': if (word) { word.done = b.checked; word.doneDate = b.checked ? Core.today() : ''; touch(word); } return;
      case 'edit': return editDlg(word);
      case 'say': return word && say(word);
      case 'add': case 'add2': return editDlg(null);
      case 'bulk': return bulkDlg();
      case 'more': S.shown += 200; return viewWords();
      case 'import': $('#file').click(); return;
      case 'export': return exportFile();
      case 'goset': return go('settings');
      case 'login': try { Cloud.cfgSet({ clientId: $('#g_id').value.trim(), sheet: $('#g_path').value.trim() }); await Cloud.login(); toast('로그인 완료'); viewSettings(); sync(true); } catch (er) { toast(er.message === 'NEEDLOGIN' ? '로그인 창을 열지 못했어요(팝업 차단 확인)' : er.message); } return;
      case 'logout': Cloud.logout(); setSync('local'); return viewSettings();
      case 'wipe': if (confirm('이 기기의 단어 데이터를 모두 지울까요? (Google 시트는 그대로 유지됩니다)')) { S.words = []; S.base = {}; save(); render(); } return;
    }
  });
  $('#file').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
  document.addEventListener('keydown', e => {
    if (S.view !== 'study' || !S.study || e.target.matches('input,textarea,select') || $('#dlg').open) return;
    const md = S.study.mode;
    if (md === 'spell' && S.study.res && e.key === 'Enter') return Modes.spellNext();
    if (md === 'test' && S.study.res && e.key === 'Enter') return Modes.testNext();
    if (md === 'learn') { const rv = S.study.rev; if (e.code === 'Space' || e.key === 'ArrowRight') { e.preventDefault(); rv ? Modes.learnNext(false) : Modes.learnReveal(); } else if (e.key === 'ArrowLeft') rv ? Modes.learnConfused() : Modes.learnPrev(); return; }
    if (md === 'recall') { if (S.study.res && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); Modes.recallNext(); } else if (!S.study.res && /^[1-4]$/.test(e.key)) Modes.recallPick(+e.key - 1); return; }
    if (md !== 'pen') return;
    if (e.code === 'Space') { e.preventDefault(); S.study.rev ? grade('yes') : reveal(); }
    else if (S.study.rev) { if (e.key === 'ArrowLeft' || e.key === '1') grade('no'); else if (e.key === 'ArrowRight' || e.key === '2') grade('yes'); else if (e.key === '3') grade('mem'); }
    else if (e.key === 'Enter') reveal();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(false); wake(S.view === 'listen' || !!S.study); } });
  window.addEventListener('online', () => sync(false));
  window.addEventListener('beforeunload', save);

  /* ---------- 시작 ---------- */
  (async function boot() {
    applyTheme();
    initModes({ S, Core, touch, speakWord, speakMeaning, finishStudy, main, render, toast, markStage, nextHtml, recordBest });
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (S.view === 'settings') viewSettings(); };
    try { if (await Cloud.handleRedirect()) { go('settings'); toast('로그인 완료'); } } catch (e) { toast('로그인 실패: ' + e.message); }
    if (!$('#nav button.active')) go(S.view);
    setSync(Cloud.loggedIn() ? 'local' : 'local');
    if (Cloud.loggedIn()) sync(false);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
    window.__S = S;
  })();
})();
