// Google 스프레드시트 연결: 로그인(Google Identity Services) + '단어' 시트 읽기/쓰기 (Sheets API v4)
(function (root) {
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
  const SHEET = '단어';
  const cfgGet = () => { try { return JSON.parse(localStorage.getItem('wa_cloud') || '{}'); } catch (e) { return {}; } };
  const cfgSet = o => localStorage.setItem('wa_cloud', JSON.stringify(Object.assign(cfgGet(), o)));
  const sheetId = () => { const v = (cfgGet().sheet || '').trim(); const m = /\/d\/([\w-]+)/.exec(v); return m ? m[1] : v; };
  const loggedIn = () => !!cfgGet().signed;
  function logout() { const c = cfgGet(); try { c.access && root.google && google.accounts.oauth2.revoke(c.access); } catch (e) { } localStorage.setItem('wa_cloud', JSON.stringify({ clientId: c.clientId, sheet: c.sheet })); }

  let gisP = null;
  function loadGis() {
    if (root.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisP) gisP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => { gisP = null; rej(new Error('Google 로그인 스크립트를 불러오지 못했어요(인터넷 확인)')); }; document.head.appendChild(s); });
    return gisP;
  }

  // 토큰 받기. prompt: 'consent'(처음) | ''(이미 동의함, 조용히 갱신 시도)
  function requestToken(prompt) {
    const { clientId } = cfgGet();
    if (!clientId) return Promise.reject(new Error('설정에서 Google Client ID를 먼저 입력하세요.'));
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('NEEDLOGIN')), 10000);
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: r => { clearTimeout(t); if (r.error) return rej(new Error(r.error === 'access_denied' ? '로그인이 취소됐어요' : r.error)); cfgSet({ access: r.access_token, expires: Date.now() + (r.expires_in - 60) * 1000, signed: true }); res(r.access_token); },
        error_callback: e => { clearTimeout(t); rej(new Error(e.type === 'popup_closed' ? '로그인 창이 닫혔어요' : 'NEEDLOGIN')); },
      });
      client.requestAccessToken({ prompt });
    });
  }
  async function login() { await loadGis(); await requestToken('consent'); }
  async function handleRedirect() { if (loggedIn()) loadGis().catch(() => { }); return false; }

  async function token() {
    const c = cfgGet();
    if (c.access && c.expires > Date.now()) return c.access;
    if (!c.signed) throw new Error('NEEDLOGIN');
    await loadGis();
    return requestToken('');                       // 사용자 탭 직후라면 조용히 갱신, 아니면 NEEDLOGIN
  }

  async function call(method, path, body, retried) {
    const id = sheetId(); if (!id) throw new Error('설정에서 스프레드시트 주소를 입력하세요.');
    const t = await token();
    const r = await fetch(API + id + path, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retried) { cfgSet({ access: '', expires: 0 }); return call(method, path, body, true); }
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); return call(method, path, body, retried); }
    const txt = await r.text(); const j = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
    return j;
  }
  const rng = a => encodeURIComponent(`'${SHEET}'!${a}`);

  // 데이터 읽기: 2행부터. 날짜는 일련번호, 불리언은 true/false
  async function readTable() {
    const j = await call('GET', `/values/${rng('A2:P')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    const values = (j.values || []).map(r => { const a = r.slice(0, 16); while (a.length < 16) a.push(''); return a; });
    return { values, firstRow: 2 };
  }

  async function writeRows(items) {
    for (let i = 0; i < items.length; i += 100) {
      const data = items.slice(i, i + 100).map(it => ({ range: `'${SHEET}'!A${it.sheetRow}:P${it.sheetRow}`, values: [it.cells] }));
      await call('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
    }
  }

  let gid = null;
  async function gridId() {
    if (gid != null) return gid;
    const j = await call('GET', '?fields=sheets.properties');
    const s = j.sheets.find(x => x.properties.title === SHEET); if (!s) throw new Error(`'${SHEET}' 시트를 찾을 수 없어요`);
    return gid = s.properties.sheetId;
  }
  async function addRows(list, nextSheetRow) {
    if (!list.length) return;
    const end = nextSheetRow + list.length - 1;
    const values = list.map((cells, k) => { const r = nextSheetRow + k; return cells.concat([`=IF(E${r}="","",COUNTIFS($E$2:$E$5000,E${r},$C$2:$C$5000,C${r}))`]); });
    await call('PUT', `/values/${rng(`A${nextSheetRow}:Q${end}`)}?valueInputOption=USER_ENTERED`, { values });
    // 새 행의 날짜 서식
    const sid = await gridId();
    const fmt = (c, type, pattern) => ({ repeatCell: { range: { sheetId: sid, startRowIndex: nextSheetRow - 1, endRowIndex: end, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
    await call('POST', ':batchUpdate', { requests: [fmt(1, 'DATE', 'yyyy-mm-dd'), fmt(7, 'DATE', 'yyyy-mm-dd'), fmt(11, 'DATE', 'yyyy-mm-dd'), fmt(14, 'DATE_TIME', 'yyyy-mm-dd hh:mm')] });
  }

  root.Cloud = { cfgGet, cfgSet, login, handleRedirect, loggedIn, logout, readTable, writeRows, addRows, origin: () => location.origin };
})(self);
