/* 클래스카드식 학습 모드: 암기학습 / 스펠 / 매칭 / 크래시 / 테스트. app.js 안에서 호출됨(공유 함수는 ctx로 전달). */
(function (root) {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  root.initModes = function (ctx) {
    const { S, Core, touch, speakWord, finishStudy, main, render } = ctx;
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
    const head = (st, i, n, extra) => `<div class="row fixed" style="justify-content:space-between"><button class="ghost" data-act="quit">✕ 종료</button>
      <span class="muted">${i} / ${n}${extra || ''}</span><span style="width:60px"></span></div><div class="bar"><i style="width:${Math.round(i / n * 100)}%"></i></div>`;
    const meta = w => `<div class="meta"><span class="chip">${esc(w.lang)} · ${esc(w.source)}</span><button class="star" data-act="star">${w.star ? '★' : '☆'}</button></div>`;
    function stopTimers() { const st = S.study; if (!st) return; if (st.raf) cancelAnimationFrame(st.raf); clearInterval(st.iv); clearTimeout(st.tm); st.raf = 0; }
    const requeue = (st, w) => { if (!st.again.has(w.id)) { st.again.add(w.id); st.q.push(w); } };

    /* ---- 암기학습: 단어+뜻 같이 보기 ---- */
    function learn() {
      const st = curSt(), w = st.q[st.i]; if (!w) return finishStudy();
      main().innerHTML = `<div class="sess">${head(st, st.i + 1, st.q.length)}
        <div class="card flash">${meta(w)}<div class="front">${esc(w.word)}</div>
        <button class="spk" data-act="speak" aria-label="발음">🔈</button>
        <div class="back">${esc(w.meaning)}</div>${w.memo ? `<div class="memo">📝 ${esc(w.memo)}</div>` : ''}
        <div class="muted">${w.done ? '✔ 암기완료 단어' : ''}</div></div>
        <div class="acts"><button data-act="lprevL">⏮ 이전</button><button class="pri" data-act="lnextL">다음 ⏭</button><button class="ok" data-act="lmemL">🎯 암기완료</button></div></div>`;
      if (S.set.autoSpeak) speakWord(w);
    }
    const learnNext = (mem) => { const st = curSt(), w = st.q[st.i]; if (!w) return; w.lastReview = Core.today(); if (mem) { w.done = true; w.doneDate = Core.today(); } touch(w); st.ok++; st.i++; learn(); };
    const learnPrev = () => { const st = curSt(); if (st.i > 0) { st.i--; learn(); } };

    /* ---- 스펠학습 ---- */
    function spell() {
      const st = curSt(), w = st.q[st.i]; if (!w) return finishStudy();
      const r = st.res;
      main().innerHTML = `<div class="sess">${head(st, st.i + 1, st.q.length, ` · ✅${st.ok} ❌${st.bad}`)}
        <div class="card flash">${meta(w)}<div class="front">${esc(w.meaning)}</div>
        ${r ? `<div class="back" style="color:${r.ok ? 'var(--ok)' : 'var(--bad)'}">${r.ok ? '⭕ 정답' : '❌ 오답'} · ${esc(w.word)}</div>${r.note ? `<div class="muted">${r.note}</div>` : ''}` : `<div class="muted">${st.hint ? esc(w.word.slice(0, st.hint)) + ' ' + '＿ '.repeat(Math.max(0, w.word.length - st.hint)) : '뜻을 보고 ' + esc(w.lang) + ' 철자를 입력하세요'}</div>`}
        <input id="sp" autocomplete="off" autocapitalize="none" spellcheck="false" ${r ? 'disabled' : ''} value="${r ? esc(r.ans) : ''}" style="max-width:420px;text-align:center;font-size:1.4rem">
        </div><div class="acts">${r ? '<button class="pri" data-act="spnext">다음 ↵</button>' : '<button data-act="sphint">💡 힌트</button><button data-act="splisten">🔈 듣기</button><button class="pri" data-act="spok">확인 ↵</button>'}</div></div>`;
      const inp = $('#sp'); if (!r) { inp.focus(); inp.onkeydown = e => { if (e.key === 'Enter') spellCheck(); }; }
    }
    function spellCheck() {
      const st = curSt(), w = st.q[st.i], ans = ($('#sp').value || '').trim(); if (!ans) return;
      const ok = Core.norm(ans) === Core.norm(w.word);
      const exact = ans.toLowerCase() === w.word.toLowerCase();
      st.res = { ok, ans, note: ok && !exact ? '악센트/기호가 달라요: ' + esc(w.word) : '' };
      rate(w, ok && !st.hint); if (ok) st.ok++; else { st.bad++; requeue(st, w); }
      spell(); speakWord(w);
    }
    const spellNext = () => { const st = curSt(); st.i++; st.res = null; st.hint = 0; spell(); };

    /* ---- 테스트 ---- */
    function buildTest(st) {
      const type = S.set.testType || 'mix';
      const n = S.set.testN === 0 ? st.q.length : Math.min(S.set.testN || 20, st.q.length);
      st.q = st.q.slice(0, n);
      st.qs = st.q.map(w => {
        const d = Math.random() < .5 ? 'w2m' : 'm2w', key = d === 'w2m' ? 'meaning' : 'word';
        let t = type === 'mix' ? (Math.random() < .6 ? 'mc' : 'sub') : type;
        let opts = null;
        if (t === 'mc') { const ds = distract(w, 3, key); if (ds.length < 3) t = 'sub'; else opts = Core.shuffle([w, ...ds]); }
        return { w, t, d, opts, key };
      });
      st.wrongs = [];
    }
    function test() {
      const st = curSt(); const q = st.qs[st.i];
      if (!q) return testResult();
      const w = q.w, r = st.res;
      const prompt = q.t === 'sub' ? w.meaning : (q.d === 'w2m' ? w.word : w.meaning);
      let body;
      if (q.t === 'mc') {
        body = `<div class="grid2" style="width:100%;max-width:640px">${q.opts.map((o, k) => {
          let cls = ''; if (r) { if (o.id === w.id) cls = 'ok'; else if (k === r.pick) cls = 'bad'; }
          return `<button class="${cls}" style="min-height:64px" data-act="tch" data-k="${k}" ${r ? 'disabled' : ''}>${esc(o[q.key])}</button>`; }).join('')}</div>`;
      } else {
        body = `<input id="sp" autocomplete="off" autocapitalize="none" spellcheck="false" ${r ? 'disabled' : ''} value="${r ? esc(r.ans) : ''}" style="max-width:420px;text-align:center;font-size:1.3rem">
          ${r ? `<div class="back" style="color:${r.ok ? 'var(--ok)' : 'var(--bad)'}">${r.ok ? '⭕' : '❌'} ${esc(w.word)}</div>` : ''}`;
      }
      main().innerHTML = `<div class="sess">${head(st, st.i + 1, st.qs.length, ` · ✅${st.ok}`)}
        <div class="card flash"><span class="chip">${q.t === 'mc' ? '객관식' : '주관식'}</span><div class="front">${esc(prompt)}</div>${body}</div>
        <div class="acts">${r ? '<button class="pri" data-act="tnext">다음 ↵</button>' : (q.t === 'sub' ? '<button class="pri" data-act="tsub">확인 ↵</button>' : '<button class="ghost" data-act="tskip">모르겠어요</button>')}</div></div>`;
      const inp = $('#sp'); if (inp && !r) { inp.focus(); inp.onkeydown = e => { if (e.key === 'Enter') testSub(); }; }
      if (q.t === 'sub' && !r && S.set.autoSpeak && false) speakWord(w);
    }
    function testAnswer(ok, pick, ans) {
      const st = curSt(), q = st.qs[st.i]; if (st.res) return;
      st.res = { ok, pick, ans }; rate(q.w, ok); if (ok) st.ok++; else st.wrongs.push(q.w);
      test();
      if (ok) { speakWord(q.w); st.tm = setTimeout(() => { if (S.study === st && st.res) testNext(); }, 1100); }
    }
    const testPick = k => { const q = curSt().qs[curSt().i]; testAnswer(q.opts[k].id === q.w.id, k); };
    const testSkip = () => testAnswer(false, -1);
    function testSub() { const q = curSt().qs[curSt().i], v = ($('#sp').value || '').trim(); if (!v) return; testAnswer(Core.norm(v) === Core.norm(q.w.word), -1, v); }
    function testNext() { const st = curSt(); clearTimeout(st.tm); st.i++; st.res = null; test(); }
    function testResult() {
      const st = curSt(), n = st.qs.length, pct = Math.round(st.ok / n * 100);
      main().innerHTML = `<div class="card" style="text-align:center"><div class="big">${pct >= 90 ? '🏆' : pct >= 70 ? '👍' : '💪'} ${st.ok} / ${n}</div><p>${pct}점</p></div>
        ${st.wrongs.length ? `<div class="card"><h2>틀린 단어</h2>${st.wrongs.map(w => `<div class="hb" style="grid-template-columns:1fr 1fr"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></div>`).join('')}</div>` : ''}
        <div class="row">${st.wrongs.length ? '<button class="pri" data-act="tretry">오답만 다시</button>' : ''}<button class="ok" data-act="tmem">맞힌 단어 암기완료 처리</button><button data-act="quit">종료</button></div>`;
    }
    function testRetry() { const st = curSt(); st.q = st.wrongs.slice(); st.i = 0; st.ok = 0; st.res = null; buildTest(st); test(); }
    function testMemAll() { const st = curSt(); const wr = new Set(st.wrongs.map(w => w.id)); let n = 0; st.qs.forEach(q => { if (!wr.has(q.w.id) && !q.w.done) { q.w.done = true; q.w.doneDate = Core.today(); touch(q.w); n++; } }); ctx.toast(`${n}개 암기완료로 표시했어요`); }

    /* ---- 매칭 게임 ---- */
    function matchStart(st) { st.mi = 0; st.t0 = Date.now(); st.miss = 0; st.times = []; matchRound(); }
    function matchRound() {
      const st = curSt(), words = st.q.slice(st.mi, st.mi + 6);
      if (!words.length) return matchDone();
      st.mw = words; st.missed = new Set(); st.done = new Set(); st.sel = null;
      st.tiles = Core.shuffle(words.flatMap(w => [{ id: w.id, k: 'w', t: w.word }, { id: w.id, k: 'm', t: w.meaning }]));
      st.rt0 = Date.now(); matchDraw();
      clearInterval(st.iv); st.iv = setInterval(() => { const el = $('#mt'); if (!el || S.study !== st) return clearInterval(st.iv); el.textContent = ((Date.now() - st.rt0) / 1000).toFixed(0) + '초'; }, 500);
    }
    function matchDraw(flash) {
      const st = curSt();
      main().innerHTML = `<div class="sess">${head(st, Math.min(st.mi + 6, st.q.length), st.q.length, ` · ⏱ <span id="mt">0초</span> · 실수 ${st.miss}`)}
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
          clearInterval(st.iv); matchDraw();
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
      st.i = st.q.length; finishStudy();
    }

    /* ---- 크래시: 떨어지는 뜻에 맞는 단어를 맞추기 ---- */
    function crashStart(st) { st.lives = 3; st.score = 0; st.i = 0; crashQ(); }
    function crashQ() {
      const st = curSt(); stopTimers(); const w = st.q[st.i];
      if (!w || st.lives <= 0) { st.ok = st.score; st.bad = 3 - st.lives; return finishStudy(); }
      st.opts = Core.shuffle([w, ...distract(w, 3, 'word')]); st.lock = false;
      st.dur = Math.max(3500, 9000 - st.i * 150);
      main().innerHTML = `<div class="sess">${head(st, st.i + 1, st.q.length, ` · 점수 ${st.score} · ${'❤️'.repeat(st.lives)}`)}
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
      if (ok) { st.score++; speakWord(w); } else { st.lives--; if (!st.again.has(w.id)) { st.again.add(w.id); st.q.push(w); } }
      const f = $('#fall'); if (f) f.style.color = ok ? 'var(--ok)' : 'var(--bad)';
      st.tm = setTimeout(() => { if (S.study !== st) return; st.i++; crashQ(); }, ok ? 500 : 1200);
    }

    root.Modes = { learn, learnNext, learnPrev, spell, spellCheck, spellNext, buildTest, test, testPick, testSkip, testSub, testNext, testRetry, testMemAll,
      matchStart, matchTap, crashStart, crashHit, stopTimers, rate };
  };
})(self);
