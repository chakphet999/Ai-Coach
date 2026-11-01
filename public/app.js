const $ = selector => document.querySelector(selector);
const SPORT_NAMES = {
  running: 'วิ่ง', football: 'ฟุตบอล', basketball: 'บาสเกตบอล', badminton: 'แบดมินตัน', fencing: 'ฟันดาบ',
  swimming: 'ว่ายน้ำ', cycling: 'ปั่นจักรยาน', volleyball: 'วอลเลย์บอล', tennis: 'เทนนิส', hyrox: 'HYROX',
  strength: 'เวทเทรนนิง', boxing: 'มวย', table_tennis: 'ปิงปอง', martial_arts: 'ศิลปะการต่อสู้'
};
const FOCUS_NAMES = {
  endurance: 'ความอึด', speed: 'ความเร็ว', strength: 'ความแข็งแรง', technique: 'เทคนิค', agility: 'ความคล่องตัว',
  power: 'พลังระเบิด', flexibility: 'ความยืดหยุ่น', conditioning: 'สมรรถภาพโดยรวม', competition: 'เตรียมแข่งขัน', recovery: 'ฟื้นฟูร่างกาย'
};
let currentUser = null;
let accountData = { plans: [], workouts: [] };
let authMode = 'login';

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function dateLabel(value) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentUser && !url.startsWith('/api/auth/')) {
      currentUser = null; showAuth('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    }
    throw new Error(result.error || `เกิดข้อผิดพลาด (${response.status})`);
  }
  return result;
}
function showAuth(message = '', tone = 'error') {
  currentUser = null;
  $('#appShell').classList.add('hidden');
  $('#authShell').classList.remove('hidden');
  setAuthMode('login');
  $('#authError').textContent = message;
  $('#authError').classList.toggle('success', tone === 'success');
}
function showAuthPanel(panel) {
  $('#authForm').classList.toggle('hidden', panel !== 'auth');
  document.querySelector('.auth-tabs').classList.toggle('hidden', panel !== 'auth');
  $('#forgotPasswordForm').classList.toggle('hidden', panel !== 'forgot');
  $('#resetPasswordForm').classList.toggle('hidden', panel !== 'reset');
}
function setAuthMode(mode) {
  showAuthPanel('auth');
  authMode = mode;
  const registering = mode === 'register';
  $('#authTitle').textContent = registering ? 'สร้างบัญชี AI Coach' : 'ยินดีต้อนรับกลับ';
  $('#authSubtitle').textContent = registering ? 'สร้างบัญชีเพื่อเก็บแผนและประวัติการฝึกของคุณ' : 'เข้าสู่ระบบเพื่อดูแผนและประวัติการฝึกของคุณ';
  $('#authSubmit').textContent = registering ? 'สร้างบัญชีและเริ่มใช้งาน' : 'เข้าสู่ระบบ';
  $('#nameField').classList.toggle('hidden', !registering);
  $('#forgotPasswordLink').classList.toggle('hidden', registering);
  $('#authName').required = registering;
  $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelectorAll('.auth-tab').forEach(button => button.classList.toggle('selected', button.dataset.mode === mode));
  $('#authError').textContent = '';
  $('#authError').classList.remove('success');
}
function showForgotPassword() {
  showAuthPanel('forgot');
  $('#authTitle').textContent = 'ลืมรหัสผ่าน';
  $('#authSubtitle').textContent = 'กรอกอีเมลที่ใช้สมัคร แล้วเราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้';
  $('#forgotEmail').value = $('#authEmail').value.trim();
  $('#forgotPasswordMessage').textContent = '';
  $('#forgotPasswordMessage').classList.remove('success');
}
function showResetPassword(token) {
  currentUser = null;
  $('#appShell').classList.add('hidden');
  $('#authShell').classList.remove('hidden');
  showAuthPanel('reset');
  $('#authTitle').textContent = 'ตั้งรหัสผ่านใหม่';
  $('#authSubtitle').textContent = 'ตั้งรหัสผ่านใหม่เพื่อกลับเข้าสู่ AI Coach';
  $('#resetToken').value = token;
  $('#resetPasswordMessage').textContent = '';
  $('#resetPasswordMessage').classList.remove('success');
}
function setConnection(ready, text) {
  ['#statusDot', '#topStatusDot'].forEach(selector => {
    const dot = $(selector); dot.classList.toggle('online', ready); dot.classList.toggle('offline', !ready);
  });
  $('#statusText').textContent = text;
}
async function refreshStatus() {
  try {
    const result = await api('/api/status');
    setConnection(result.configured, result.configured ? 'Gemini พร้อมใช้งาน' : 'ตั้งค่า Gemini API key');
    $('#modelText').textContent = result.configured ? result.model : 'ยังไม่ได้ตั้งค่า Gemini';
  } catch {
    setConnection(false, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    $('#modelText').textContent = 'Gemini';
  }
}
async function loadData() {
  const result = await api('/api/data');
  currentUser = result.user;
  accountData = { workouts: result.workouts || [], plans: result.plans || [] };
  renderAll();
}
function showApp() {
  $('#authShell').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  const name = currentUser?.name || 'นักกีฬา';
  $('#welcomeName').textContent = name;
  $('#sideUserName').textContent = name;
  $('#topUserName').textContent = name;
  $('#sideUserEmail').textContent = currentUser?.email || '';
  $('#userAvatar').textContent = name.trim().charAt(0).toUpperCase() || 'A';
  $('#todayLabel').textContent = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
  refreshStatus();
}
function gotoPage(name) {
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.page === name));
  const titles = { overview: 'ภาพรวมการฝึก', planner: 'สร้าง / ปรับแผน', log: 'บันทึกการฝึก', history: 'ประวัติของฉัน' };
  $('#pageTitle').textContent = titles[name] || 'AI Coach';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function createWorkoutRow(item, deletable = false) {
  const row = document.createElement('div');
  row.className = 'workout-row';
  const main = document.createElement('div'); main.className = 'workout-main';
  const title = document.createElement('strong'); title.textContent = `${SPORT_NAMES[item.sport] || item.sport} · ${item.type}`;
  const detail = document.createElement('small');
  detail.textContent = `${dateLabel(item.createdAt)} · ${item.duration} นาที${item.distance ? ` · ${item.distance} กม.` : ''} · RPE ${item.rpe}/10${item.note ? ` · ${item.note}` : ''}`;
  main.append(title, detail);
  row.append(main);
  if (deletable) {
    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.type = 'button'; remove.textContent = 'ลบ';
    remove.addEventListener('click', () => deleteWorkout(item.id)); row.append(remove);
  }
  return row;
}
function createEmpty(text) {
  const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = text; return empty;
}
function renderPlanCard(plan, compact = false) {
  const card = document.createElement('article'); card.className = compact ? 'plan-card compact' : 'plan-card';
  const head = document.createElement('div'); head.className = 'plan-card-head';
  const title = document.createElement('strong'); title.textContent = `${SPORT_NAMES[plan.sport] || plan.sport} · ${FOCUS_NAMES[plan.focus] || plan.focus}`;
  const date = document.createElement('small'); date.textContent = dateLabel(plan.createdAt);
  head.append(title, date);
  const meta = document.createElement('div'); meta.className = 'plan-meta'; meta.textContent = `${plan.daysPerWeek} วัน/สัปดาห์ · ครั้งละ ${plan.minutesPerSession} นาที · ${plan.level === 'beginner' ? 'เริ่มต้น' : plan.level === 'intermediate' ? 'ปานกลาง' : 'ระดับสูง'}`;
  const advice = document.createElement('pre'); advice.className = 'plan-advice'; advice.textContent = plan.advice;
  card.append(head, meta, advice);
  return card;
}
function renderAll() {
  const plans = accountData.plans;
  const workouts = accountData.workouts;
  $('#planCount').textContent = plans.length;
  $('#workoutCount').textContent = workouts.length;
  $('#totalMinutes').textContent = workouts.reduce((sum, item) => sum + item.duration, 0);
  const latestSport = plans[0]?.sport || workouts[0]?.sport;
  $('#latestSport').textContent = latestSport ? SPORT_NAMES[latestSport] || latestSport : '—';

  const latestPlan = $('#latestPlan'); latestPlan.replaceChildren();
  if (plans.length) latestPlan.append(renderPlanCard(plans[0], true));
  else latestPlan.append(createEmpty('ยังไม่มีแผน กด “เริ่มสร้างแผน” เพื่อให้ AI Coach ช่วยจัดแผนแรกของคุณ'));

  const recent = $('#recentWorkouts'); recent.replaceChildren();
  if (workouts.length) workouts.slice(0, 4).forEach(item => recent.append(createWorkoutRow(item)));
  else recent.append(createEmpty('ยังไม่มีบันทึกการฝึก'));

  const planHistory = $('#planHistory'); planHistory.replaceChildren();
  if (plans.length) plans.forEach(plan => planHistory.append(renderPlanCard(plan)));
  else planHistory.append(createEmpty('ยังไม่มีประวัติแผน'));

  const workoutHistory = $('#workoutHistory'); workoutHistory.replaceChildren();
  if (workouts.length) workouts.forEach(item => workoutHistory.append(createWorkoutRow(item, true)));
  else workoutHistory.append(createEmpty('ยังไม่มีประวัติการฝึก'));
}

for (const button of document.querySelectorAll('.auth-tab')) button.addEventListener('click', () => setAuthMode(button.dataset.mode));
$('#forgotPasswordLink').addEventListener('click', showForgotPassword);
$('#backToLogin').addEventListener('click', () => setAuthMode('login'));
$('#resetRequestNewLink').addEventListener('click', showForgotPassword);
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#authSubmit'); button.disabled = true;
  button.textContent = authMode === 'register' ? 'กำลังสร้างบัญชี…' : 'กำลังเข้าสู่ระบบ…';
  $('#authError').textContent = '';
  try {
    const result = await api(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, {
      method: 'POST', body: JSON.stringify({ name: $('#authName').value.trim(), email: $('#authEmail').value.trim(), password: $('#authPassword').value })
    });
    currentUser = result.user;
    showApp(); await loadData(); gotoPage('overview');
  } catch (error) {
    $('#authError').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = authMode === 'register' ? 'สร้างบัญชีและเริ่มใช้งาน' : 'เข้าสู่ระบบ';
  }
});
$('#forgotPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#forgotPasswordSubmit');
  button.disabled = true;
  button.textContent = 'กำลังส่ง…';
  $('#forgotPasswordMessage').textContent = '';
  $('#forgotPasswordMessage').classList.remove('success');
  try {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email: $('#forgotEmail').value.trim() })
    });
    $('#forgotPasswordMessage').textContent = result.message;
    $('#forgotPasswordMessage').classList.add('success');
  } catch (error) {
    $('#forgotPasswordMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'ส่งลิงก์ตั้งรหัสผ่านใหม่';
  }
});
$('#resetPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#newPassword').value;
  const confirmPassword = $('#confirmPassword').value;
  const message = $('#resetPasswordMessage');
  message.textContent = '';
  message.classList.remove('success');
  if (password !== confirmPassword) {
    message.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    return;
  }
  const button = $('#resetPasswordSubmit');
  button.disabled = true;
  button.textContent = 'กำลังบันทึก…';
  try {
    const result = await api('/api/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ token: $('#resetToken').value, password })
    });
    window.history.replaceState(null, '', window.location.pathname);
    $('#newPassword').value = '';
    $('#confirmPassword').value = '';
    showAuth(result.message, 'success');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'บันทึกรหัสผ่านใหม่';
  }
});
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  accountData = { plans: [], workouts: [] }; showAuth('ออกจากระบบแล้ว');
});
for (const button of document.querySelectorAll('.nav-link')) button.addEventListener('click', () => gotoPage(button.dataset.page));
for (const button of document.querySelectorAll('[data-goto]')) button.addEventListener('click', () => gotoPage(button.dataset.goto));

$('#planSoreness').addEventListener('input', () => $('#sorenessNumber').textContent = $('#planSoreness').value);
$('#workoutRpe').addEventListener('input', () => $('#rpeNumber').textContent = $('#workoutRpe').value);
$('#planForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#generatePlan');
  const resultBox = $('#planResult');
  button.disabled = true; button.textContent = 'กำลังให้ AI Coach วางแผน…';
  $('#planSaveStatus').textContent = '';
  resultBox.innerHTML = '<div class="result-placeholder"><span class="spinner">◌</span><strong>AI Coach กำลังวิเคราะห์ข้อมูล</strong><small>อาจใช้เวลาสักครู่</small></div>';
  const payload = {
    sport: $('#planSport').value,
    focus: $('#planFocus').value,
    level: $('#planLevel').value,
    daysPerWeek: Number($('#planDays').value),
    minutesPerSession: Number($('#planMinutes').value),
    equipment: $('#planEquipment').value.trim(),
    sleepHours: Number($('#planSleep').value),
    soreness: Number($('#planSoreness').value),
    note: $('#planNote').value.trim()
  };
  try {
    const response = await api('/api/coach', { method: 'POST', body: JSON.stringify(payload) });
    resultBox.replaceChildren(renderPlanCard(response.plan));
    $('#planSaveStatus').textContent = `บันทึกแผนในประวัติแล้ว · ${response.model || 'Gemini'}`;
    await loadData();
    gotoPage('planner');
  } catch (error) {
    resultBox.textContent = `สร้างแผนไม่สำเร็จ: ${error.message}`;
  } finally {
    button.disabled = false; button.textContent = '✦ ให้ AI Coach ช่วยจัดแผน';
  }
});
$('#workoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  $('#workoutMessage').textContent = 'กำลังบันทึก…';
  const distance = $('#workoutDistance').value;
  const payload = {
    sport: $('#workoutSport').value,
    type: $('#workoutType').value.trim(),
    duration: Number($('#workoutDuration').value),
    distance: distance === '' ? null : Number(distance),
    rpe: Number($('#workoutRpe').value),
    note: $('#workoutNote').value.trim()
  };
  try {
    await api('/api/workouts', { method: 'POST', body: JSON.stringify(payload) });
    await loadData();
    $('#workoutForm').reset(); $('#workoutDuration').value = 45; $('#workoutRpe').value = 5; $('#rpeNumber').textContent = '5';
    $('#workoutMessage').textContent = 'บันทึกแล้ว';
  } catch (error) {
    $('#workoutMessage').textContent = error.message;
  } finally { button.disabled = false; }
});
async function deleteWorkout(id) {
  if (!confirm('ลบประวัติการฝึกนี้ใช่ไหม?')) return;
  try { await api(`/api/workouts/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadData(); }
  catch (error) { alert(error.message); }
}

async function start() {
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken !== null) { showResetPassword(resetToken); return; }
  try {
    const result = await api('/api/me');
    currentUser = result.user; showApp(); await loadData();
  } catch { showAuth(); }
}
start();
