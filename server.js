const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
let database = { users: [], workouts: [], plans: [] };
if (fs.existsSync(DATA_FILE)) {
  try { database = { ...database, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch { throw new Error('อ่าน data/app-data.json ไม่ได้ กรุณาตรวจสอบไฟล์ข้อมูล'); }
}

const SPORTS = {
  running: 'วิ่ง', football: 'ฟุตบอล', basketball: 'บาสเกตบอล', badminton: 'แบดมินตัน',
  fencing: 'ฟันดาบ', swimming: 'ว่ายน้ำ', cycling: 'ปั่นจักรยาน', volleyball: 'วอลเลย์บอล',
  tennis: 'เทนนิส', hyrox: 'HYROX', strength: 'เวทเทรนนิง', boxing: 'มวย',
  table_tennis: 'ปิงปอง', martial_arts: 'ศิลปะการต่อสู้'
};
const FOCUSES = {
  endurance: 'ความอึด', speed: 'ความเร็ว', strength: 'ความแข็งแรง', technique: 'เทคนิค',
  agility: 'ความคล่องตัว', power: 'พลังระเบิด', flexibility: 'ความยืดหยุ่น',
  conditioning: 'สมรรถภาพโดยรวม', competition: 'เตรียมแข่งขัน', recovery: 'ฟื้นฟูร่างกาย'
};
const LEVELS = { beginner: 'เริ่มต้น', intermediate: 'ปานกลาง', advanced: 'สูง' };
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function saveDatabase() {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(database, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}
function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
  return true;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 40_000) { reject(new Error('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('ข้อมูล JSON ไม่ถูกต้อง')); }
    });
    req.on('error', reject);
  });
}
function cookieToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const entry = cookieHeader.split(';').map(item => item.trim()).find(item => item.startsWith('ai_coach_session='));
  return entry ? entry.slice('ai_coach_session='.length) : '';
}
function getSignedInUser(req) {
  const token = cookieToken(req);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return database.users.find(user => user.id === session.userId) || null;
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email }; }
function makeSession(user, res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `ai_coach_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}
function clearSession(req, res) {
  const token = cookieToken(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'ai_coach_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}
function requireUser(req, res) {
  const user = getSignedInUser(req);
  if (!user) sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });
  return user;
}
function validEmail(email) { return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validSport(sport) { return Object.hasOwn(SPORTS, sport); }
function validFocus(focus) { return Object.hasOwn(FOCUSES, focus); }
function validatePlan(data) {
  if (!data || typeof data !== 'object') return 'ข้อมูลแผนฝึกไม่ถูกต้อง';
  if (!validSport(data.sport)) return 'กรุณาเลือกกีฬา';
  if (!validFocus(data.focus)) return 'กรุณาเลือกสิ่งที่ต้องการฝึก';
  if (!Object.hasOwn(LEVELS, data.level)) return 'กรุณาเลือกระดับประสบการณ์';
  if (!Number.isInteger(data.daysPerWeek) || data.daysPerWeek < 1 || data.daysPerWeek > 6) return 'จำนวนวันฝึกต้องอยู่ระหว่าง 1 ถึง 6 วัน';
  if (!Number.isInteger(data.minutesPerSession) || data.minutesPerSession < 15 || data.minutesPerSession > 180) return 'เวลาฝึกต้องอยู่ระหว่าง 15 ถึง 180 นาที';
  if (typeof data.equipment !== 'string' || data.equipment.length > 200) return 'ข้อมูลอุปกรณ์ยาวเกินไป';
  if (typeof data.note !== 'string' || data.note.length > 500) return 'รายละเอียดเพิ่มเติมต้องไม่เกิน 500 ตัวอักษร';
  if (!Number.isFinite(data.sleepHours) || data.sleepHours < 0 || data.sleepHours > 24) return 'ชั่วโมงนอนต้องอยู่ระหว่าง 0 ถึง 24 ชั่วโมง';
  if (!Number.isInteger(data.soreness) || data.soreness < 1 || data.soreness > 10) return 'ระดับความล้าต้องอยู่ระหว่าง 1 ถึง 10';
  return null;
}
function validateWorkout(data) {
  if (!data || !validSport(data.sport)) return 'กรุณาเลือกกีฬา';
  if (typeof data.type !== 'string' || !data.type.trim() || data.type.length > 100) return 'กรุณากรอกประเภทการฝึก (ไม่เกิน 100 ตัวอักษร)';
  if (!Number.isInteger(data.duration) || data.duration < 1 || data.duration > 600) return 'เวลาฝึกต้องอยู่ระหว่าง 1 ถึง 600 นาที';
  if (!Number.isInteger(data.rpe) || data.rpe < 1 || data.rpe > 10) return 'คะแนนความเหนื่อยต้องอยู่ระหว่าง 1 ถึง 10';
  if (data.distance !== null && data.distance !== undefined && (!Number.isFinite(data.distance) || data.distance < 0 || data.distance > 300)) return 'ระยะทางต้องอยู่ระหว่าง 0 ถึง 300 กิโลเมตร';
  if (typeof data.note !== 'string' || data.note.length > 300) return 'บันทึกเพิ่มเติมต้องไม่เกิน 300 ตัวอักษร';
  return null;
}
function buildPrompt(data, recentWorkouts, previousPlan) {
  const history = recentWorkouts.length
    ? recentWorkouts.map((item, index) => `${index + 1}. ${SPORTS[item.sport]} — ${item.type}, ${item.duration} นาที, RPE ${item.rpe}/10${item.distance ? `, ${item.distance} กม.` : ''}${item.note ? `, บันทึก: ${item.note}` : ''}`).join('\n')
    : 'ยังไม่มีประวัติการซ้อม';
  const previous = previousPlan ? `\nแผนล่าสุดที่เคยได้รับ:\nกีฬา: ${SPORTS[previousPlan.sport]} | จุดเน้น: ${FOCUSES[previousPlan.focus]}\n${previousPlan.advice.slice(0, 2500)}` : 'ยังไม่มีแผนก่อนหน้า';
  return `คุณคือ AI Coach ผู้ช่วยวางแผนฝึกกีฬาทั่วไป ตอบภาษาไทยที่เข้าใจง่ายและจัดรูปแบบอ่านง่าย

ข้อมูลที่นักกีฬาเลือก:
- กีฬา: ${SPORTS[data.sport]}
- สิ่งที่ต้องการฝึก: ${FOCUSES[data.focus]}
- ระดับประสบการณ์: ${LEVELS[data.level]}
- ฝึกได้: ${data.daysPerWeek} วันต่อสัปดาห์
- เวลาต่อครั้ง: ประมาณ ${data.minutesPerSession} นาที
- อุปกรณ์ที่มี: ${data.equipment.trim() || 'ไม่ได้ระบุ'}
- ชั่วโมงนอนเมื่อคืน: ${data.sleepHours}
- ความล้าหรือปวดเมื่อยที่ประเมินเอง: ${data.soreness}/10
- สิ่งที่อยากให้ปรับหรือข้อจำกัด: ${data.note.trim() || 'ไม่มี'}
- ประวัติการฝึกล่าสุด:
${history}
${previous}

จัดทำแผนฝึก 1 สัปดาห์ให้ตรงกับกีฬาที่เลือก โดยใส่วันฝึก/วันพัก ประเภทการฝึก ระยะเวลาหรือจำนวนเซต และระดับความหนักแบบคร่าว ๆ อธิบายสั้น ๆ ว่าแผนปรับตามข้อมูลประวัติอย่างไร ถ้าข้อมูลไม่พอให้บอกข้อสมมติที่ใช้ อย่าคิดค้นสถิติหรืออาการที่ไม่ได้ระบุ

ความปลอดภัย: คำแนะนำเป็นข้อมูลทั่วไป ไม่ใช่การวินิจฉัยหรือการรักษา ห้ามแนะนำให้ฝืนซ้อมเมื่อเจ็บหรือปวดมาก หากความล้าสูงหรือผู้ใช้รายงานอาการเจ็บ ให้เน้นพัก/ลดความหนักและแนะนำให้ปรึกษาโค้ชหรือผู้เชี่ยวชาญ อย่าเพิ่มภาระการฝึกอย่างรวดเร็ว`;
}
async function handleAuth(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = getSignedInUser(req);
    return user ? sendJson(res, 200, { user: publicUser(user) }) : sendJson(res, 401, { error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    let data;
    try { data = await readJson(req); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!validEmail(email)) return sendJson(res, 400, { error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    if (password.length < 8 || password.length > 128) return sendJson(res, 400, { error: 'รหัสผ่านต้องมีความยาว 8–128 ตัวอักษร' });

    if (url.pathname.endsWith('/register')) {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 50) return sendJson(res, 400, { error: 'กรุณากรอกชื่อ 1–50 ตัวอักษร' });
      if (database.users.some(user => user.email === email)) return sendJson(res, 409, { error: 'อีเมลนี้มีบัญชีแล้ว ลองเข้าสู่ระบบแทน' });
      const salt = crypto.randomBytes(16).toString('hex');
      const derived = await scrypt(password, salt, 64);
      const user = { id: crypto.randomUUID(), name, email, salt, passwordHash: derived.toString('hex'), createdAt: new Date().toISOString() };
      database.users.push(user);
      saveDatabase();
      makeSession(user, res);
      return sendJson(res, 201, { user: publicUser(user) });
    }

    const user = database.users.find(item => item.email === email);
    if (!user) return sendJson(res, 401, { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    const derived = await scrypt(password, user.salt, 64);
    const stored = Buffer.from(user.passwordHash, 'hex');
    if (stored.length !== derived.length || !crypto.timingSafeEqual(stored, derived)) return sendJson(res, 401, { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    makeSession(user, res);
    return sendJson(res, 200, { user: publicUser(user) });
  }
  return null;
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, { configured: Boolean(GEMINI_API_KEY), model: MODEL });
  const authResponse = await handleAuth(req, res, url);
  if (authResponse) return authResponse;

  if (req.method === 'GET' && url.pathname === '/api/data') {
    const user = requireUser(req, res); if (!user) return;
    return sendJson(res, 200, {
      user: publicUser(user),
      workouts: database.workouts.filter(item => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      plans: database.plans.filter(item => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/workouts') {
    const user = requireUser(req, res); if (!user) return;
    let data; try { data = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
    const error = validateWorkout(data); if (error) return sendJson(res, 400, { error });
    const workout = { id: crypto.randomUUID(), userId: user.id, sport: data.sport, type: data.type.trim(), duration: data.duration, distance: data.distance ?? null, rpe: data.rpe, note: data.note.trim(), createdAt: new Date().toISOString() };
    database.workouts.push(workout); saveDatabase();
    return sendJson(res, 201, { workout });
  }
  const deleteWorkout = url.pathname.match(/^\/api\/workouts\/([a-f0-9-]+)$/i);
  if (req.method === 'DELETE' && deleteWorkout) {
    const user = requireUser(req, res); if (!user) return;
    const index = database.workouts.findIndex(item => item.id === deleteWorkout[1] && item.userId === user.id);
    if (index < 0) return sendJson(res, 404, { error: 'ไม่พบประวัติการซ้อมนี้' });
    database.workouts.splice(index, 1); saveDatabase();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/coach') {
    const user = requireUser(req, res); if (!user) return;
    let data; try { data = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
    const error = validatePlan(data); if (error) return sendJson(res, 400, { error });
    if (!GEMINI_API_KEY) return sendJson(res, 503, { error: 'ยังไม่ได้ตั้งค่า Gemini API key ในไฟล์ .env' });
    const recentWorkouts = database.workouts.filter(item => item.userId === user.id).slice(-14).reverse();
    const lastPlan = database.plans.filter(item => item.userId === user.id).at(-1);
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          model: MODEL,
          input: buildPrompt(data, recentWorkouts, lastPlan),
          store: false,
          generation_config: { thinking_level: 'low', max_output_tokens: 1800 }
        }),
        signal: AbortSignal.timeout(180_000)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const providerMessage = detail.error?.message || '';
        if ([400, 401, 403].includes(response.status)) return sendJson(res, 502, { error: 'Gemini ปฏิเสธคำขอ ตรวจสอบ API key และการเปิดใช้ Gemini API' });
        if (response.status === 404) return sendJson(res, 502, { error: `ไม่พบโมเดล ${MODEL} หรือบัญชีนี้ยังใช้โมเดลไม่ได้` });
        if (response.status === 429) return sendJson(res, 429, { error: 'โควตา Gemini เต็มหรือส่งคำขอถี่เกินไป ตรวจสอบโควตาและค่าใช้บริการ' });
        return sendJson(res, 502, { error: `Gemini API ตอบกลับไม่สำเร็จ (${response.status})${providerMessage ? `: ${providerMessage.slice(0, 220)}` : ''}` });
      }
      const result = await response.json();
      const advice = (result.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text' && part.text).map(part => part.text).join('\n').trim();
      if (!advice) return sendJson(res, 502, { error: 'โมเดลตอบกลับว่างเปล่า ลองอีกครั้งได้เลย' });
      const plan = { id: crypto.randomUUID(), userId: user.id, sport: data.sport, focus: data.focus, level: data.level, daysPerWeek: data.daysPerWeek, minutesPerSession: data.minutesPerSession, advice, createdAt: new Date().toISOString() };
      database.plans.push(plan); saveDatabase();
      return sendJson(res, 200, { plan, model: result.model || MODEL });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') return sendJson(res, 504, { error: 'Gemini ใช้เวลาตอบนานเกินไป ลองอีกครั้งได้เลย' });
      return sendJson(res, 503, { error: 'เชื่อมต่อ Gemini API ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง' });
    }
  }
  return sendJson(res, 404, { error: 'ไม่พบ API นี้' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  let requestedPath;
  try { requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); return res.end('ไม่พบไฟล์'); }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Coach เปิดแล้วที่ http://localhost:${PORT}`);
  console.log(`Gemini API: ${GEMINI_API_KEY ? `พร้อม (${MODEL})` : 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน .env'}`);
});
