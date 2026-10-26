/* 클래스카드식 학습 모드: 암기학습(자동재생) / 스펠(칸 입력·틀리면 따라쓰기·마스터할 때까지 반복) / 매칭(기록) / 크래시(콤보) / 테스트(객관·주관·듣기) */
(function (root) {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  root.initModes = function (ctx) {
    const { S, Core, touch, speakWord, speakMeaning, finishStudy, main, toast } = ctx;
    const curSt = () => S.study;
    const rate = (w, ok) => { w.reviews++; w.lastReview = Core.today(); if (ok) w.right++; else { w.wrong++; w.done = false; w.doneDate = ''; } touch(w); };
    const activeWords = () => S.words.filter(w => !w.deleted && w.word && w.meaning);
    function distract(w, n, key) {
      const same = Core.shuffle(activeWords().filter(x => x.id !== w.id && x.lang === w.lang && x[key] !== w[key]));
      const seen = new Set([w[key]]), out = [];
      for (const x of same) { if (out.length >= n) break; if (!seen.has(x[key])) { seen.add(x[key]); out.push(x); } }
      if (out.length < n) for (const x of Core.shuffle(activeWords().filter(x => x.id !== w.id))) { if (out.length >= n) break; if (!seen.has(x[key])) { seen.add(x[key]); out.push(x); } }
      return out;
    }
    const head = (st, label, pct) => `<div class="row fixed" style="justify-content:space-between"><button class="ghost" data-act="quit">✕ 종료</button>
      <span class="muted">${label}</span><span style="width:60px"></span></div><div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>`;
    const meta = w => `<div class="meta"><span class="chip">${esc(w.lang)} · ${esc(w.source)}</span><button class="star" data-act="star">${w.star ? '★' : '☆'}</button></div>`;
    function stopTimers() { const st = S.study; if (!st) return; if (st.raf) cancelAnimationFrame(st.raf); clearInterval(st.iv); clearTimeout(st.tm); st.atok = (st.atok || 0) + 1; st.auto = false; st.raf = 0; }
    // 틀린 카드는 몇 장 뒤에 다시 (마스터할 때까지 반복 — 클래스카드 방식)
    const requeue = (st, w, gap = 3) => { st.q.splice(Math.min(st.q.length, st.i + 1 + gap), 0, w); };
    const prog = st => st.known.size / st.total;

    /* ---- 암기학습: 단어가 먼저, 뜻은 넘겨서 확인, 헷갈리면 표시해 다시 보기 (클래스카드) ---- */
    function learn(skipAuto) {
      const st = curSt(), w = st.q[st.i]; if (!w) { st.auto = false; return finishStudy(); }
      main().innerHTML = `<div class="sess">${head(st, `${st.i + 1} / ${st.q.length} · 외웠어요 ${st.ok}`, st.i / st.q.length)}
        <div class="card flash" ${st.rev ? '' : 'data-act="lrevL"'}>${meta(w)}<div class="front">${esc(w.word)}</div>
        <button class="spk" data-act="speak" aria-label="발음">🔈</button>
        <div class="back ${st.rev ? '' : 'hide'}">${esc(w.meaning)}</div>${st.rev && w.memo ? `<div class="memo">📝 ${esc(w.memo)}</div>` : ''}
        <div class="muted">${st.rev ? (w.done ? '✔ 이미 암기한 단어' : '') : '카드를 탭하면 뜻이 나와요 (Space)'}</div></div>
        ${st.rev ? `<div class="acts"><button class="bad" data-act="lconfL">🔁 헷갈려요<br><span class="kbd">다시 보기</span></button><button class="pri" data-act="lnextL">다음 ▶<br><span class="kbd">Space</span></button><button class="ok" data-act="lmemL">🎯 외웠어요</button></div>`
          : `<div class="acts"><button data-act="lprevL">⏮ 이전</button><button class="pri" data-act="lrevL">뜻 보기<br><span class="kbd">Space</span></button><button class="${st.auto ? 'on' : ''}" data-act="lautoL">${st.auto ? '⏸ 자동재생 중' : '▶ 자동재생'}</button></div>`}</div>`;
      if (skipAuto) return;
      if (st.auto) autoStep(); else if (!st.rev && S.set.autoSpeak) speakWord(w);
    }
    async function autoStep() {
      const st = curSt(), tok = ++st.atok, w = st.q[st.i];
      const alive = () => S.study === st && st.auto && st.atok === tok;
      if (!st.rev) { await speakWord(w); if (!alive()) return; await sleep(2200); if (!alive()) return; st.rev = true; learn(true); }
      await speakMeaning(w); if (!alive()) return; await sleep(1000); if (!alive()) return;
      learnNext(false);
    }
    const learnReveal = () => { const st = curSt(); if (st.rev) return; st.rev = true; st.atok++; const w = st.q[st.i]; learn(); if (!st.auto) speakMeaning(w); };
    const learnAuto = () => { const st = curSt(); st.auto = !st.auto; st.atok++; learn(); };
    const learnNext = mem => { const st = curSt(), w = st.q[st.i]; if (!w) return; w.lastReview = Core.today(); if (mem) { w.done = true; w.doneDate = Core.today(); st.ok++; } touch(w); st.i++; st.rev = false; st.atok++; learn(); };
    const learnConfused = () => { const st = curSt(), w = st.q[st.i]; if (!w) return; w.lastReview = Core.today(); touch(w); requeue(st, w, 3); st.i++; st.rev = false; st.atok++; learn(); };
    const learnPrev = () => { const st = curSt(); if (st.i > 0) { st.i--; st.rev = false; st.atok++; learn(); } };

    /* ---- 리콜학습: 단어를 보고 4개 보기에서 뜻 고르기, 틀리면 반복 (클래스카드) ---- */
    function recall() {
      const st = curSt(), w = st.q[st.i]; if (!w) return finishStudy();
      const r = st.res, d = st.dir, key = d === 'w2m' ? 'meaning' : 'word';
      if (!st.opts || st.optsFor !== w.id + ':' + st.i) { st.opts = Core.shuffle([w, ...distract(w, 3, key)]); st.optsFor = w.id + ':' + st.i; }
      main().innerHTML = `<div class="sess">${head(st, `마스터 ${st.known.size} / ${st.total} · 남은 카드 ${st.q.length - st.i} · ❌${st.bad}`, prog(st))}
        <div class="card flash">${meta(w)}<div class="front">${esc(d === 'w2m' ? w.word : w.meaning)}</div>
        ${d === 'w2m' ? '<button class="spk" data-act="speak" aria-label="발음">🔈</button>' : ''}
        <div class="grid2" style="width:100%;max-width:640px">${st.opts.map((o, k) => {
          let cls = ''; if (r) { if (o.id === w.id) cls = 'ok'; else if (k === r.pick) cls = 'bad'; }
          return `<button class="${cls}" style="min-height:64px" data-act="rcpick" data-k="${k}" ${r ? 'disabled' : ''}><span class="kbd">${k + 1}</span> ${esc(o[key])}</button>`; }).join('')}</div>
        ${r && !r.ok && w.memo ? `<div class="memo">📝 ${esc(w.memo)}</div>` : ''}</div>
        <div class="acts">${r ? '<button class="pri" data-act="rcnext">다음 ↵</button>' : '<button class="ghost" data-act="rcpick" data-k="-1">모르겠어요</button>'}</div></div>`;
      if (!r && d === 'w2m' && S.set.autoSpeak) speakWord(w);
    }
    function recallPick(k) {
      const st = curSt(), w = st.q[st.i]; if (!w || st.res) return;
      const ok = k >= 0 && st.opts[k].id === w.id;
      rate(w, ok); st.res = { ok, pick: k };
      if (ok) { st.known.add(w.id); st.ok++; } else { st.bad++; requeue(st, w); }
      recall(); if (ok) { if (st.dir === 'm2w') speakWord(w); st.tm = setTimeout(() => { if (S.study === st && st.res) recallNext(); }, 900); }
    }
    function recallNext() { const st = curSt(); clearTimeout(st.tm); st.i++; st.res = null; st.opts = null; recall(); }

    /* ---- 스펠학습: 글자 칸 · 힌트 · 틀리면 정답 따라 쓰기 · 맞힐 때까지 반복 ---- */
    function slotsHtml(w, typed, hint) {
      return [...w.word].map((ch, k) => /[\s\-'’.,!?]/.test(ch) ? `<span class="sl sp">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`
        : `<span class="sl ${typed[k] ? 'f' : ''}">${typed[k] ? esc(typed[k]) : (k < hint ? `<u>${esc(ch)}</u>` : '')}</span>`).join('');
    }
    function spell() {
      const st = curSt(), w = st.q[st.i]; if (!w) return finishStudy();
      const r = st.res, copy = r && r.stage === 'copy';
      main().innerHTML = `<div class="sess">${head(st, `마스터 ${st.known.size} / ${st.total} · 남은 카드 ${st.q.length - st.i}`, prog(st))}
        <div class="card flash">${meta(w)}<div class="front">${esc(w.meaning)}</div>
        <div class="slots" id="slots"></div>
        ${r ? (r.ok ? `<div class="back" style="color:${r.hinted ? 'var(--warn)' : 'var(--ok)'}">${r.hinted ? '💡 힌트를 써서 오답 처리 — 다시 나와요' : '⭕ 정답!'}</div>` : `<div class="back" style="color:var(--bad)">❌ 정답: ${esc(w.word)}<br><span class="muted">정답을 한 번 따라 써 보세요</span></div>`) : ''}
        <input id="sp" autocomplete="off" autocapitalize="none" spellcheck="false" ${r && r.ok ? 'disabled' : ''} placeholder="${copy ? '정답 따라 쓰기' : esc(w.lang) + ' 철자'}" style="max-width:420px;text-align:center;font-size:1.4rem"></div>
        <div class="acts">${r && r.ok ? '<button class="pri" data-act="spnext">다음 ↵</button>' : `${copy ? '' : '<button data-act="sphint">💡 힌트</button>'}<button data-act="splisten">🔈 듣기</button><button class="pri" data-act="spok">확인 ↵</button>`}</div></div>`;
      const inp = $('#sp'), slots = $('#slots'), h = copy ? 0 : st.hint;
      slots.innerHTML = slotsHtml(w, '', h);
      if (!(r && r.ok)) {
        inp.focus();
        inp.oninput = () => { slots.innerHTML = slotsHtml(w, inp.value, h); };
        inp.onkeydown = e => { if (e.key === 'Enter') spellCheck(); };
      }
    }
    function spellCheck() {
      const st = curSt(), w = st.q[st.i], ans = ($('#sp').value || '').trim(); if (!ans) return;
      const good = Core.norm(ans) === Core.norm(w.word);
      if (st.res && st.res.stage === 'copy') { if (good) return spellNext(); toast('정답과 똑같이 써 주세요'); return; }
      if (good && !st.hint) {
        rate(w, true); st.known.add(w.id); st.ok++;
        st.res = { ok: true }; spell(); speakWord(w);
      } else if (good) {                                   // 힌트를 쓰면 오답 처리 → 다시 복습
        rate(w, false); st.bad++; requeue(st, w); st.res = { ok: true, hinted: true }; spell(); speakWord(w);
      } else {
        rate(w, false); st.bad++; requeue(st, w); st.res = { ok: false, stage: 'copy' }; spell(); speakWord(w);
      }
    }
    const spellNext = () => { const st = curSt(); st.i++; st.res = null; st.hint = 0; spell(); };

    /* ---- 테스트: 객관식 / 주관식 / 듣기 ---- */
    function buildTest(st) {
      const type = S.set.testType || 'mix';
      const n = S.set.testN === 0 ? st.q.length : Math.min(S.set.testN || 20, st.q.length);
      st.q = Core.shuffle(st.q.slice()).slice(0, n);
      st.qs = st.q.map(w => {
        let t = type === 'mix' ? ['mc', 'mc', 'sub', 'ls'][Math.floor(Math.random() * 4)] : type;
        const d = Math.random() < .5 ? 'w2m' : 'm2w', key = t === 'ls' ? 'word' : (d === 'w2m' ? 'meaning' : 'word');
        let opts = null;
        if (t === 'mc' || t === 'ls') { const ds = distract(w, 3, key); if (ds.length < 3) t = 'sub'; else opts = Core.shuffle([w, ...ds]); }
        return { w, t, d, opts, key };
      });
      st.wrongs = []; st.t0 = Date.now();
    }
    function test() {
      const st = curSt(); const q = st.qs[st.i];
      if (!q) return testResult();
      const w = q.w, r = st.res;
      const prompt = q.t === 'sub' ? w.meaning : q.t === 'ls' ? '🔈 듣고 알맞은 단어를 고르세요' : (q.d === 'w2m' ? w.word : w.meaning);
      let body;
      if (q.t === 'mc' || q.t === 'ls') {
        body = `${q.t === 'ls' ? '<button class="spk" data-act="tplay" aria-label="다시 듣기">🔈</button>' : ''}<div class="grid2" style="width:100%;max-width:640px">${q.opts.map((o, k) => {
          let cls = ''; if (r) { if (o.id === w.id) cls = 'ok'; else if (k === r.pick) cls = 'bad'; }
          return `<button class="${cls}" style="min-height:64px" data-act="tch" data-k="${k}" ${r ? 'disabled' : ''}>${esc(o[q.key])}</button>`; }).join('')}</div>`;
      } else {
        body = `<input id="sp" autocomplete="off" autocapitalize="none" spellcheck="false" ${r ? 'disabled' : ''} value="${r ? esc(r.ans || '') : ''}" style="max-width:420px;text-align:center;font-size:1.3rem">
          ${r ? `<div class="back" style="color:${r.ok ? 'var(--ok)' : 'var(--bad)'}">${r.ok ? '⭕' : '❌'} ${esc(w.word)}</div>` : ''}`;
      }
      main().innerHTML = `<div class="sess">${head(st, `${st.i + 1} / ${st.qs.length} · 정답 ${st.ok} · ⏱ ${Math.round((Date.now() - st.t0) / 1000)}초`, st.i / st.qs.length)}
        <div class="card flash"><span class="chip">${{ mc: '객관식', sub: '주관식', ls: '듣기' }[q.t]}</span><div class="front" style="${q.t === 'ls' ? 'font-size:1.3rem' : ''}">${esc(prompt)}</div>${body}</div>
        <div class="acts">${r ? '<button class="pri" data-act="tnext">다음 ↵</button>' : (q.t === 'sub' ? '<button class="pri" data-act="tsub">확인 ↵</button>' : '<button class="ghost" data-act="tskip">모르겠어요</button>')}</div></div>`;
      const inp = $('#sp'); if (inp && !r) { inp.focus(); inp.onkeydown = e => { if (e.key === 'Enter') testSub(); }; }
      if (q.t === 'ls' && !r) speakWord(w);
      clearInterval(st.iv);
      const lim = (({ slow: 20, normal: 12, fast: 7, vfast: 4 })[S.set.testSpeed] || 0) * (q.t === 'sub' ? 2.5 : q.t === 'ls' ? 1.4 : 1);
      if (lim && !r) {
        const t0 = Date.now(), card = $('.flash'); card.insertAdjacentHTML('beforeend', '<div class="bar" style="width:100%;max-width:640px"><i id="tbar" style="width:100%;background:var(--bad)"></i></div>');
        st.iv = setInterval(() => {
          const bar = $('#tbar'), left = 1 - (Date.now() - t0) / (lim * 1000);
          if (S.study !== st || !bar || st.res) return clearInterval(st.iv);
          bar.style.width = Math.max(0, left * 100) + '%';
          if (left <= 0) { clearInterval(st.iv); testAnswer(false, -1, ''); }
        }, 100);
      }
    }
    function testAnswer(ok, pick, ans) {
      const st = curSt(), q = st.qs[st.i]; if (st.res) return; clearInterval(st.iv);
      st.res = { ok, pick, ans }; rate(q.w, ok); if (ok) st.ok++; else st.wrongs.push(q.w);
      test();
      if (ok) { if (q.t !== 'ls') speakWord(q.w); st.tm = setTimeout(() => { if (S.study === st && st.res) testNext(); }, 1100); }
    }
    const testPick = k => { const q = curSt().qs[curSt().i]; testAnswer(q.opts[k].id === q.w.id, k); };
    const testSkip = () => testAnswer(false, -1);
    function testSub() { const q = curSt().qs[curSt().i], v = ($('#sp').value || '').trim(); if (!v) return; testAnswer(Core.norm(v) === Core.norm(q.w.word), -1, v); }
    function testNext() { const st = curSt(); clearTimeout(st.tm); st.i++; st.res = null; test(); }
    const testPlay = () => { const st = curSt(); speakWord(st.qs[st.i].w); };
    function testResult() {
      const st = curSt(), n = st.qs.length, pct = Math.round(st.ok / n * 100), sec = Math.round((Date.now() - st.t0) / 1000);
      ctx.markStage('test', pct);
      main().innerHTML = `<div class="card" style="text-align:center"><div class="big">${pct >= 90 ? '🏆' : pct >= 70 ? '👍' : '💪'} ${pct}점</div><p>${st.ok} / ${n} 정답 · ⏱ ${sec}초</p></div>
        ${st.wrongs.length ? `<div class="card"><h2>오답 노트</h2>${st.wrongs.map(w => `<div class="hb" style="grid-template-columns:1fr 1fr"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></div>`).join('')}</div>` : ''}
        <div class="row">${ctx.nextHtml()}${st.wrongs.length ? '<button class="pri" data-act="tretry">오답만 다시 시험</button>' : ''}<button class="ok" data-act="tmem">맞힌 단어 암기완료 처리</button><button data-act="quit">세트로</button></div>`;
    }
    function testRetry() { const st = curSt(); st.q = st.wrongs.slice(); st.i = 0; st.ok = 0; st.res = null; buildTest(st); test(); }
    function testMemAll() { const st = curSt(); const wr = new Set(st.wrongs.map(w => w.id)); let n = 0; st.qs.forEach(q => { if (!wr.has(q.w.id) && !q.w.done) { q.w.done = true; q.w.doneDate = Core.today(); touch(q.w); n++; } }); toast(`${n}개 암기완료로 표시했어요`); }

    /* ---- 매칭 게임: 6쌍씩, 전체 시간 기록 ---- */
    function matchStart(st) { st.mi = 0; st.t0 = Date.now(); st.miss = 0; matchRound(); }
    function matchRound() {
      const st = curSt(), words = st.q.slice(st.mi, st.mi + 6);
      if (!words.length) return matchDone();
      st.mw = words; st.missed = new Set(); st.done = new Set(); st.sel = null;
      st.tiles = Core.shuffle(words.flatMap(w => [{ id: w.id, k: 'w', t: w.word }, { id: w.id, k: 'm', t: w.meaning }]));
      matchDraw();
      clearInterval(st.iv); st.iv = setInterval(() => { const el = $('#mt'); if (!el || S.study !== st) return clearInterval(st.iv); el.textContent = ((Date.now() - st.t0) / 1000).toFixed(0) + '초'; }, 500);
    }
    function matchDraw(flash) {
      const st = curSt();
      main().innerHTML = `<div class="sess">${head(st, `라운드 ${Math.floor(st.mi / 6) + 1}/${Math.ceil(st.q.length / 6)} · ⏱ <span id="mt">${Math.round((Date.now() - st.t0) / 1000)}초</span> · 실수 ${st.miss}`, Math.min(st.mi, st.q.length) / st.q.length)}
        <div class="mgrid">${st.tiles.map((t, k) => `<button class="tile ${st.done.has(t.id + t.k) ? 'gone' : ''} ${st.sel === k ? 'sel' : ''} ${flash && flash.includes(k) ? 'wrong' : ''}" data-act="mt" data-k="${k}" ${st.done.has(t.id + t.k) ? 'disabled' : ''}>${esc(t.t)}</button>`).join('')}</div></div>`;
    }
    function matchTap(k) {
      const st = curSt(), t = st.tiles[k];
      if (st.done.has(t.id + t.k)) return;
      if (st.sel == null) { st.sel = k; speakIf(t); return matchDraw(); }
      if (st.sel === k) { st.sel = null; return matchDraw(); }
      const a = st.tiles[st.sel];
      if (a.id === t.id && a.k !== t.k) {
        st.done.add(a.id + a.k); st.done.add(t.id + t.k); st.sel = null; speakIf(a.k === 'w' ? a : t);
        if (st.done.size === st.tiles.length) {
          st.mw.forEach(w => rate(w, !st.missed.has(w.id)));
          st.ok += st.mw.filter(w => !st.missed.has(w.id)).length; st.bad += st.missed.size;
          matchDraw();
          st.tm = setTimeout(() => { if (S.study !== st) return; st.mi += 6; matchRound(); }, 600);
        } else matchDraw();
      } else {
        st.miss++; st.missed.add(a.id); st.missed.add(t.id); const sel = [st.sel, k]; st.sel = null; matchDraw(sel);
        st.tm = setTimeout(() => { if (S.study === st) matchDraw(); }, 450);
      }
    }
    const speakIf = t => { if (t.k === 'w' && S.set.autoSpeak) { const w = S.words.find(x => x.id === t.id); w && speakWord(w); } };
    function matchDone() {
      const st = curSt(); clearInterval(st.iv);
      const sec = +((Date.now() - st.t0) / 1000).toFixed(1);
      const best = ctx.recordBest('matchBest', sec, true);
      st.extra = `⏱ ${sec}초 · 실수 ${st.miss}회${best ? ' · 🏅 신기록!' : ''}`;
      st.i = st.q.length; finishStudy();
    }

    /* ---- 크래시: 떨어지는 뜻에 맞는 단어를 빨리 (콤보 점수) ---- */
    function crashStart(st) { st.lives = 3; st.score = 0; st.combo = 0; st.maxCombo = 0; st.i = 0; crashQ(); }
    function crashQ() {
      const st = curSt(); stopTimers(); const w = st.q[st.i];
      if (!w || st.lives <= 0) { st.ok = st.maxCombo; st.bad = 3 - st.lives; const nb = ctx.recordBest('crashBest', st.score, false); st.extra = `점수 ${st.score} · 최대 콤보 ${st.maxCombo}${nb ? ' · 🏅 신기록!' : ''}`; return finishStudy(); }
      st.opts = Core.shuffle([w, ...distract(w, 3, 'word')]); st.lock = false;
      st.dur = Math.max(3500, 9000 - st.i * 150);
      main().innerHTML = `<div class="sess">${head(st, `점수 ${st.score} · 콤보 ${st.combo}🔥 · ${'❤️'.repeat(st.lives)}`, st.i / st.q.length)}
        <div class="crash" id="cr"><div class="fall" id="fall">${esc(w.meaning)}</div><div class="ground"></div></div>
        <div class="grid2">${st.opts.map((o, k) => `<button style="min-height:64px;font-size:1.1rem" data-act="cpick" data-k="${k}">${esc(o.word)}</button>`).join('')}</div></div>`;
      st.t0 = performance.now();
      const step = now => {
        if (S.study !== st || st.lock) return;
        const el = $('#fall'), box = $('#cr'); if (!el) return;
        const p = Math.min(1, (now - st.t0) / st.dur);
        el.style.transform = `translate(-50%, ${p * (box.clientHeight - el.offsetHeight - 6)}px)`;
        if (p >= 1) return crashHit(-1);
        st.raf = requestAnimationFrame(step);
      };
      st.raf = requestAnimationFrame(step);
    }
    function crashHit(k) {
      const st = curSt(); if (st.lock) return; st.lock = true; cancelAnimationFrame(st.raf);
      const w = st.q[st.i], ok = k >= 0 && st.opts[k].id === w.id;
      rate(w, ok);
      document.querySelectorAll('[data-act=cpick]').forEach((b, j) => { b.disabled = true; if (st.opts[j].id === w.id) b.classList.add('ok'); else if (j === k) b.classList.add('bad'); });
      if (ok) { st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo); st.score += 10 + Math.min(st.combo, 10) * 2; speakWord(w); }
      else { st.combo = 0; st.lives--; st.q.splice(Math.min(st.q.length, st.i + 4), 0, w); }
      const f = $('#fall'); if (f) f.style.color = ok ? 'var(--ok)' : 'var(--bad)';
      st.tm = setTimeout(() => { if (S.study !== st) return; st.i++; crashQ(); }, ok ? 500 : 1200);
    }

    root.Modes = { learn, learnNext, learnPrev, learnAuto, learnReveal, learnConfused, recall, recallPick, recallNext, spell, spellCheck, spellNext, buildTest, test, testPick, testSkip, testSub, testNext, testRetry, testMemAll, testPlay,
      matchStart, matchDraw, matchTap, crashStart, crashQ, crashHit, stopTimers, rate };
  };
})(self);
