// 나를 한 문장으로 — 반 단위 결과 모으기 서버 (외부 패키지 없음)
// 학생 결과는 서버 메모리에만 두고, 6시간 동안 아무도 쓰지 않은 반은 지운다.
// 서버가 다시 켜지면 모인 결과는 사라지지만, 학생 화면이 10초마다 다시 보내므로 곧 다시 모인다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;   // 헷갈리는 글자(I, O, 0, 1) 뺀 4자리
const SID_RE = /^[a-z0-9]{8,24}$/;
const MAX_ROOMS = 300, MAX_STUDENTS = 80, MAX_BODY = 8 * 1024, ROOM_TTL = 6 * 3600 * 1000;
const rooms = new Map(); // code -> { t, students: Map(sid -> data) }

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) dropOldest();
    r = { t: Date.now(), students: new Map() };
    rooms.set(code, r);
  }
  r.t = Date.now();
  return r;
}
function dropOldest() {
  let old = null;
  for (const [k, r] of rooms) if (!old || r.t < old[1].t) old = [k, r];
  if (old) rooms.delete(old[0]);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.t > ROOM_TTL) rooms.delete(k);
}, 10 * 60 * 1000).unref();

// 받은 값은 정해 둔 칸만, 정해 둔 길이까지만 남긴다
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const bool = v => v === true;
function clean(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    name: str(d.name, 20), screen: str(d.screen, 20), first: str(d.first, 200),
    r1: num(d.r1), r2: num(d.r2), slow: num(d.slow), t1: num(d.t1), t2: num(d.t2), w1: num(d.w1), w2: num(d.w2),
    scores: Array.isArray(d.scores) ? d.scores.slice(0, 8).map(num) : [],
    top: Array.isArray(d.top) ? d.top.slice(0, 2).filter(k => /^[A-H]$/.test(k)) : [],
    f1hit: num(d.f1hit), f1wrong: num(d.f1wrong), f1done: bool(d.f1done),
    f2: num(d.f2), f3: num(d.f3),
    f4: Array.isArray(d.f4) ? d.f4.slice(0, 6).map(num) : [], f4done: bool(d.f4done),
    self: str(d.self, 200), selfDone: bool(d.selfDone), cmp: num(d.cmp)
  };
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, cb) {
  let size = 0, chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { cb(e); }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, INDEX, 'text/html; charset=utf-8');
  if (req.method === 'GET' && p === '/api/ping') return send(res, 200, { ok: true });

  if (req.method === 'POST' && p === '/api/submit') {
    return readBody(req, (err, b) => {
      if (err || !b) return send(res, 400, { error: 'bad_body' });
      const code = String(b.room || '').toUpperCase(), sid = String(b.sid || '');
      if (!CODE_RE.test(code) || !SID_RE.test(sid)) return send(res, 400, { error: 'bad_code' });
      const data = clean(b.data);
      if (!data) return send(res, 400, { error: 'bad_data' });
      const r = getRoom(code);
      if (!r.students.has(sid) && r.students.size >= MAX_STUDENTS) return send(res, 429, { error: 'room_full' });
      r.students.set(sid, { ...data, t: Date.now() });
      send(res, 200, { ok: true });
    });
  }

  const m = p.match(/^\/api\/room\/([A-Za-z0-9]{4})$/);
  if (m) {
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return send(res, 400, { error: 'bad_code' });
    if (req.method === 'GET') {
      const r = getRoom(code);
      return send(res, 200, { students: [...r.students].map(([sid, d]) => ({ sid, ...d })) });
    }
    if (req.method === 'DELETE') {
      rooms.delete(code);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log('listening on ' + PORT));
