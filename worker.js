/* 夜燈 — 伺服器端登入
 * ────────────────────────────────────────────────────────
 * 這支程式跑在 Cloudflare 上，不在使用者手機裡，所以改不了。
 *
 * 流程：
 *   1. 有人來訪 → 檢查他有沒有帶有效的通行證（cookie）
 *   2. 沒有 → 回傳登入畫面，不給任何檔案
 *   3. 輸入密碼 → 伺服器比對 → 對了就發通行證
 *   4. 之後每次來訪都自動帶著通行證，不用再登入
 *
 * 要在 Cloudflare 後台設兩個 Secret（不要寫在這個檔案裡）：
 *   SITE_PASSWORD  登入密碼
 *   AUTH_SECRET    用來簽章的隨機字串（隨便打一長串亂碼）
 */

const COOKIE = 'yd_auth';
const DAYS = 365;                       // 通行證有效天數

/* ── 通行證：內容是到期時間，後面加上伺服器的簽章 ──
   簽章讓別人無法偽造，也無法把到期日改長。 */
async function sign(text, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeToken(secret) {
  const exp = Date.now() + DAYS * 86400000;
  return `${exp}.${await sign(String(exp), secret)}`;
}

async function checkToken(token, secret) {
  if (!token || !token.includes('.')) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expect = await sign(exp, secret);
  // 逐字元比對且不提前結束，避免用回應時間反推簽章
  if (sig.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : null;
}

/* ── 擋暴力破解：同一個 IP 一分鐘最多五次 ──
   存在記憶體裡，是盡力而為的防護，不是滴水不漏，但足以讓
   「一秒試幾千次」變成不可能。 */
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.t > 60000) { attempts.set(ip, { n: 1, t: now }); return false; }
  rec.n++;
  if (attempts.size > 5000) attempts.clear();     // 避免無限長大
  return rec.n > 5;
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-Hant"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07070a">
<title>夜燈</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{min-height:100dvh;background:#07070a;color:#d08a52;display:flex;align-items:center;
  justify-content:center;padding:28px;
  font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",-apple-system,sans-serif}
.box{width:100%;max-width:340px;text-align:center}
svg{margin-bottom:22px}
h1{font-family:"Noto Serif TC","Songti TC",serif;font-weight:400;font-size:30px;
  letter-spacing:.22em;text-indent:.22em;color:#eab578;margin-bottom:10px}
p{font-size:13.5px;color:#9c8878;line-height:1.9;margin-bottom:28px}
input{width:100%;background:#0d0b0d;border:1px solid #3a2f28;border-radius:3px;
  padding:15px;font-size:17px;color:#eab578;text-align:center;letter-spacing:.2em;outline:none}
input:focus{border-color:#d08a52}
button{width:100%;margin-top:12px;background:#d08a52;color:#120c07;border:none;border-radius:3px;
  padding:15px;font-size:16px;letter-spacing:.1em;font-weight:500}
.err{margin-top:14px;font-size:13px;color:#c96a4a;min-height:1.3em}
</style></head><body>
<div class="box">
  <svg width="58" height="58" viewBox="0 0 52 52" fill="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eab578"/><stop offset="1" stop-color="#b87c46"/></linearGradient>
      <mask id="m"><rect width="52" height="52" fill="#000"/>
        <circle cx="26" cy="26" r="19" fill="#fff"/>
        <circle cx="35" cy="22" r="17.5" fill="#000"/></mask></defs>
    <circle cx="26" cy="26" r="24" stroke="#3a2f28"/>
    <rect width="52" height="52" fill="url(#g)" mask="url(#m)"/>
  </svg>
  <h1>夜　燈</h1>
  <p>輸入密碼 1234<br>輸入一次就好，之後會自動記住。</p>
  <input id="pw" type="password" inputmode="text" placeholder="密碼" autocomplete="current-password">
  <button id="go">進入</button>
  <div class="err" id="err"></div>

</div>
<script>
var pw=document.getElementById('pw'),go=document.getElementById('go'),err=document.getElementById('err');
async function submit(){
  err.textContent='';go.disabled=true;go.textContent='確認中…';
  try{
    var r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pw:pw.value})});
    if(r.ok){location.reload();return;}
    var d=await r.json().catch(function(){return{}});
    err.textContent = r.status===429 ? '嘗試太多次，請等一分鐘' : (d.msg||'密碼不對');
  }catch(e){ err.textContent='連線失敗，請檢查網路'; }
  go.disabled=false;go.textContent='進入';pw.select();
}
go.onclick=submit;
pw.addEventListener('keydown',function(e){if(e.key==='Enter')submit()});
pw.focus();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

    /* 沒設定 Secret 就直接講清楚，不要讓人以為是別的問題 */
    if (!env.SITE_PASSWORD || !env.AUTH_SECRET) {
      return new Response(
        '尚未設定 SITE_PASSWORD 與 AUTH_SECRET。\n' +
        '請到 Cloudflare → Workers → sleep → Settings → Variables and Secrets 新增。',
        { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    /* ── 登入 ── */
    if (url.pathname === '/api/login' && request.method === 'POST') {
      if (tooMany(ip)) {
        return Response.json({ ok: false, msg: '嘗試太多次' }, { status: 429 });
      }
      const body = await request.json().catch(() => ({}));
      const ok = typeof body.pw === 'string' && body.pw === env.SITE_PASSWORD;
      if (!ok) {
        await new Promise(r => setTimeout(r, 600));      // 拖慢猜測速度
        return Response.json({ ok: false, msg: '密碼不對' }, { status: 401 });
      }
      const token = await makeToken(env.AUTH_SECRET);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; ` +
                        `HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    /* ── 登出 ── */
    if (url.pathname === '/api/logout') {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` }
      });
    }

    /* ── 其餘所有請求都要通行證 ── */
    const valid = await checkToken(getCookie(request, COOKIE), env.AUTH_SECRET);
    if (!valid) {
      // 網頁 → 給登入畫面；音檔、圖示等 → 直接拒絕
      const wantsHTML = (request.headers.get('Accept') || '').includes('text/html');
      if (wantsHTML) {
        return new Response(LOGIN_PAGE, {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      return new Response('unauthorized', { status: 401 });
    }

    /* 通過了才把檔案交出去 */
    return env.ASSETS.fetch(request);
  }
};
