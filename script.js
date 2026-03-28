/* ══════════════════════════════════════════════════════
   SEDY — script.js
   Complete application logic
════════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ──────────────────────────────────────── */
const API_BASE   = 'https://sedy-api.onrender.com';

const MODELS = {
  auto:  'llama-3.3-70b-versatile',
  pro:   'llama-3.3-70b-versatile',
  flash: 'llama-3.1-8b-instant',
  smart: 'llama-3.3-70b-versatile'
};

const FREE_MODEL = 'llama-3.1-8b-instant';
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const MAX_FREE_MSGS = 20;
const MAX_CONTEXT_MSGS = 20;

/* ── App State ──────────────────────────────────────── */
let currentUser    = null;
let userProfile    = {};   // { name, class, subjects, lang, theme, school }
let chats          = {};   // { [chatId]: { id, title, messages:[], createdAt } }
let activeChatId   = null;
let selectedModel  = 'auto';
let isFreeMode     = false;
let isStreaming    = false;
let abortController = null;
let rlTimer        = null;
let rlResetAt      = 0;
let freeMsgCount   = 0;

let stagedImages   = [];   // [{dataUrl, mimeType, name}]
let stagedPdfs     = [];   // [{text, name}]
let selContextText = '';
let wbDataUrl      = null;
let scopeDataUrl   = null;
let screenshotDataUrl = null;

let voiceRecognition  = null;
let voiceActive       = false;
let voicePersona      = 'girl';
let voiceSpeed        = 1;
let voiceSynth        = window.speechSynthesis;
let voiceUtterance    = null;
let voiceHistory      = [];

let scopeStream       = null;
let scopeAnalysing    = false;
let scopeMemories     = [];
let scopeFacingMode   = 'environment';
let scopeVoiceActive  = false;

let wbCanvas, wbCtx, wbDrawing = false, wbColor = '#e8edf5', wbSize = 4;
let wbHistory = [], wbEraserMode = false;
let wbpCanvas, wbpCtx, wbpDrawing = false, wbpColor = '#e8edf5', wbpSize = 4;
let wbpHistory = [], wbpEraserMode = false;
let wbpQuestions = [], wbpCurrentQ = 0, wbpTopic = '';

let ideCurrentLang = 'python';
let ideCode = '';

let filesData = { notes: [], formula: [], flowchart: [] };

let cropCanvas, cropCtx, cropStartX, cropStartY, cropEndX, cropEndY, cropDragging = false;

let inlineRenameActive = false;

/* ── Helpers ────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateLabel(ts) {
  const d = new Date(ts), now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function copyText(str) {
  navigator.clipboard.writeText(str).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = str; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${type==='error'?'rgba(255,79,106,.9)':type==='success'?'rgba(0,229,160,.9)':'rgba(79,142,255,.9)'};
    color:white;padding:8px 18px;border-radius:20px;font-size:13px;
    font-family:'DM Sans',sans-serif;z-index:9999;pointer-events:none;
    animation:fadeIn .2s ease;box-shadow:0 4px 16px rgba(0,0,0,.3);
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* Language instruction builder — KEY BUG FIX */
function getLangInstruction() {
  const lang = userProfile.lang || 'English';
  if (lang === 'English') return '';
  return `IMPORTANT: Always respond in ${lang}. This applies to ALL outputs including flashcards, quizzes, notes, formulas, flowcharts, explanations, and every other generated content. Never switch to a different language unless the user explicitly asks you to.`;
}

/* Build system prompt */
function buildSystemPrompt() {
  const name     = userProfile.name     || 'Student';
  const cls      = userProfile.class    || '';
  const subs     = (userProfile.subjects || []).join(', ') || 'general subjects';
  const lang     = userProfile.lang     || 'English';
  const school   = userProfile.school   ? `School: ${userProfile.school.name}` : '';
  const langInst = getLangInstruction();

  return `You are Sedy, a friendly and intelligent AI study companion for Indian students. You help with homework, concepts, exam prep, and learning.

Student profile:
- Name: ${name}
- Class: ${cls || 'Not specified'}
- Favourite subjects: ${subs}
- Preferred language: ${lang}
${school}

${langInst}

Personality & style:
- Be warm, encouraging, and patient — like a smart elder sibling who loves to teach.
- Tailor explanations to the student's class level. Use analogies and examples.
- Use emojis occasionally to make responses feel friendly (not excessive).
- For maths/science, show step-by-step working.
- Format code in proper code blocks with language labels.
- Use LaTeX for math: inline with $...$ and block with $$...$$

Special output formats (use these when the user asks for them):

FLASHCARDS — When asked to create flashcards, output EXACTLY this JSON block:
\`\`\`flashcards
[{"q":"Question text","a":"Answer text"},...]
\`\`\`

QUIZ — When asked to create a quiz/MCQ, output EXACTLY this JSON block:
\`\`\`quiz
{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}
\`\`\`

NOTES — When asked to create/save notes, output EXACTLY this JSON block:
\`\`\`save-note
{"title":"Note title","content":"Full note content in markdown"}
\`\`\`

FORMULA — When asked to create a formula sheet, output EXACTLY this JSON block:
\`\`\`save-formula
{"title":"Formula sheet title","content":"Formulas in markdown with LaTeX"}
\`\`\`

FLOWCHART — When asked to create a flowchart/diagram, output EXACTLY this JSON block:
\`\`\`save-flowchart
{"title":"Flowchart title","content":"ASCII or text-based flowchart"}
\`\`\`

All content in these blocks MUST be in the student's preferred language: ${lang}.

Sedy was built by Ansh Verma. Keep responses focused, helpful, and age-appropriate.`.trim();
}

/* ── Markdown renderer ──────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return '';

  // Detect and handle special JSON blocks FIRST
  text = text.replace(/```flashcards\n([\s\S]*?)```/g, (_, json) => {
    try {
      const cards = JSON.parse(json.trim());
      return buildFlashcardsHTML(cards);
    } catch { return `<pre>${escHtml(json)}</pre>`; }
  });

  text = text.replace(/```quiz\n([\s\S]*?)```/g, (_, json) => {
    try {
      const q = JSON.parse(json.trim());
      return buildQuizHTML(q);
    } catch { return `<pre>${escHtml(json)}</pre>`; }
  });

  text = text.replace(/```save-note\n([\s\S]*?)```/g, (_, json) => {
    try {
      const n = JSON.parse(json.trim());
      autoSaveFile('notes', n);
      return `<div class="ai-action-bar"><span style="font-size:12px;color:var(--success);font-family:'DM Mono',monospace;">📝 Note saved: <strong>${escHtml(n.title)}</strong></span></div>`;
    } catch { return `<pre>${escHtml(json)}</pre>`; }
  });

  text = text.replace(/```save-formula\n([\s\S]*?)```/g, (_, json) => {
    try {
      const f = JSON.parse(json.trim());
      autoSaveFile('formula', f);
      return `<div class="ai-action-bar"><span style="font-size:12px;color:var(--success);font-family:'DM Mono',monospace;">📐 Formula sheet saved: <strong>${escHtml(f.title)}</strong></span></div>`;
    } catch { return `<pre>${escHtml(json)}</pre>`; }
  });

  text = text.replace(/```save-flowchart\n([\s\S]*?)```/g, (_, json) => {
    try {
      const fc = JSON.parse(json.trim());
      autoSaveFile('flowchart', fc);
      return `<div class="ai-action-bar"><span style="font-size:12px;color:var(--success);font-family:'DM Mono',monospace;">🔀 Flowchart saved: <strong>${escHtml(fc.title)}</strong></span></div>`;
    } catch { return `<pre>${escHtml(json)}</pre>`; }
  });

  // Code blocks with syntax highlighting
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const safeCode = escHtml(code.trim());
    const langLabel = lang || '';
    return `<div style="position:relative;margin:10px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;background:#1e2433;padding:6px 12px;border-radius:10px 10px 0 0;border-bottom:1px solid rgba(255,255,255,.08);">
        <span style="font-size:10px;color:rgba(136,153,187,.6);font-family:'DM Mono',monospace;">${langLabel.toUpperCase()}</span>
        <button onclick="copyCodeBlock(this)" style="font-size:10px;color:rgba(136,153,187,.6);background:none;border:none;cursor:pointer;font-family:'DM Mono',monospace;padding:2px 6px;border-radius:4px;transition:color .15s;" onmouseover="this.style.color='#e8edf5'" onmouseout="this.style.color='rgba(136,153,187,.6)'">Copy</button>
      </div>
      <pre style="margin:0;border-radius:0 0 10px 10px;"><code class="language-${langLabel}">${safeCode}</code></pre>
      <button onclick="openIdeWithCode(this)" style="position:absolute;top:36px;right:10px;font-size:10px;background:rgba(79,142,255,.15);border:1px solid rgba(79,142,255,.3);color:var(--accent);padding:3px 8px;border-radius:6px;cursor:pointer;font-family:'DM Mono',monospace;" data-lang="${langLabel}">▶ Run</button>
    </div>`;
  });

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  text = text.replace(/__(.+?)__/g,          '<strong>$1</strong>');
  text = text.replace(/_(.+?)_/g,            '<em>$1</em>');

  // Tables
  text = text.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
    const ths = header.split('|').filter(c=>c.trim()).map(c=>`<th>${c.trim()}</th>`).join('');
    const trs = rows.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });

  // Blockquote
  text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered list
  text = text.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Ordered list
  text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // HR
  text = text.replace(/^---$/gm, '<hr>');

  // Paragraphs
  text = text.split(/\n\n+/).map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|ul|ol|li|table|blockquote|pre|div|hr)/.test(block)) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return text;
}

function buildFlashcardsHTML(cards) {
  const id = uid();
  const items = cards.map((c,i) => `
    <div class="flashcard" onclick="this.classList.toggle('revealed')">
      <div class="flashcard-q">${escHtml(c.q)}</div>
      <div class="flashcard-a">${escHtml(c.a)}</div>
      <div class="flashcard-hint">Tap to reveal answer</div>
    </div>
  `).join('');
  return `<div class="flashcard-container">
    <div class="flashcard-header">📚 FLASHCARDS · ${cards.length} cards</div>
    ${items}
  </div>`;
}

function buildQuizHTML(q) {
  const id = uid();
  const opts = q.options.map((o,i) => `
    <div class="quiz-opt" onclick="quizAnswer(this,'${id}',${i},${q.correct},'${escHtml(q.explanation)}')">${escHtml(o)}</div>
  `).join('');
  return `<div class="quiz-container" id="quiz-${id}">
    <div class="quiz-header">🧠 QUIZ</div>
    <div class="quiz-question">${escHtml(q.question)}</div>
    <div class="quiz-options">${opts}</div>
    <div class="quiz-feedback" id="qfb-${id}" style="display:none;"></div>
  </div>`;
}

window.quizAnswer = function(el, id, chosen, correct, explanation) {
  const container = $(`quiz-${id}`);
  if (!container) return;
  const opts = container.querySelectorAll('.quiz-opt');
  opts.forEach((o,i) => {
    o.classList.add('disabled');
    if (i === correct) o.classList.add('correct');
    else if (i === chosen && chosen !== correct) o.classList.add('wrong');
  });
  const fb = $(`qfb-${id}`);
  if (fb) {
    fb.style.display = 'block';
    fb.className = `quiz-feedback ${chosen === correct ? 'correct' : 'wrong'}`;
    fb.textContent = chosen === correct ? `✓ Correct! ${explanation}` : `✗ Wrong. ${explanation}`;
  }
};

window.copyCodeBlock = function(btn) {
  const pre = btn.closest('div').nextElementSibling;
  if (pre) {
    copyText(pre.textContent);
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  }
};

window.openIdeWithCode = function(btn) {
  const pre = btn.parentElement.querySelector('pre code');
  if (!pre) return;
  const lang = btn.dataset.lang || 'python';
  openIde(pre.textContent, lang);
};

/* ── Firebase helpers ───────────────────────────────── */
function fb() { return window._fb; }

async function loadUserProfile(uid) {
  try {
    const snap = await fb().getDoc(fb().doc(fb().db, 'users', uid));
    if (snap.exists()) {
      userProfile = snap.data();
      return true;
    }
  } catch (e) { console.error('loadProfile', e); }
  return false;
}

async function saveUserProfile() {
  if (!currentUser) return;
  try {
    await fb().setDoc(fb().doc(fb().db, 'users', currentUser.uid), userProfile, { merge: true });
  } catch (e) { console.error('saveProfile', e); }
}

async function loadChats() {
  if (!currentUser) return;
  try {
    const snap = await fb().getDocs(fb().collection(fb().db, 'users', currentUser.uid, 'chats'));
    chats = {};
    snap.forEach(d => { chats[d.id] = d.data(); });
  } catch (e) { console.error('loadChats', e); }
}

async function saveChatToDb(chatId) {
  if (!currentUser || !chats[chatId]) return;
  try {
    const c = chats[chatId];
    await fb().setDoc(
      fb().doc(fb().db, 'users', currentUser.uid, 'chats', chatId),
      { ...c, updatedAt: fb().serverTimestamp() }
    );
  } catch (e) { console.error('saveChat', e); }
}

async function deleteChatFromDb(chatId) {
  if (!currentUser) return;
  try {
    await fb().deleteDoc(fb().doc(fb().db, 'users', currentUser.uid, 'chats', chatId));
  } catch (e) { console.error('deleteChat', e); }
}

/* ── Auth ───────────────────────────────────────────── */
function showAuthLoading(msg = 'Signing in…') {
  $('auth-loading').style.display = 'flex';
  $('auth-loading-text').textContent = msg;
  $('auth-error').style.display = 'none';
}
function hideAuthLoading() { $('auth-loading').style.display = 'none'; }
function showAuthError(msg) {
  $('auth-error').style.display = 'block';
  $('auth-error').textContent = msg;
  $('auth-loading').style.display = 'none';
}
function clearAuthError() {
  const e = $('auth-error'); if (e) e.style.display = 'none';
  const e2 = $('auth-error-ob'); if (e2) e2.style.display = 'none';
}

window.authSignInGoogle = async function() {
  showAuthLoading('Connecting to Google…');
  try {
    const provider = new fb().GoogleAuthProvider();
    await fb().signInWithPopup(fb().auth, provider);
    // onAuthStateChanged will handle the rest
  } catch (e) {
    hideAuthLoading();
    if (e.code !== 'auth/popup-closed-by-user') {
      showAuthError('Sign in failed: ' + (e.message || 'Please try again'));
    }
  }
};

window.authSignOut = async function() {
  hideUserMenu();
  try { await fb().signOut(fb().auth); } catch {}
  currentUser = null;
  userProfile = {};
  chats = {};
  activeChatId = null;
  showAuthScreen();
};

function showAuthScreen() {
  $('auth-screen').classList.add('visible');
  document.querySelector('.app-shell').style.display = 'none';
}
function hideAuthScreen() {
  $('auth-screen').classList.remove('visible');
  document.querySelector('.app-shell').style.display = 'flex';
}

fb().onAuthStateChanged(fb().auth, async (user) => {
  $('session-loader').style.display = 'none';
  if (!user) {
    showAuthScreen();
    return;
  }
  currentUser = user;
  showAuthLoading('Loading your profile…');
  const exists = await loadUserProfile(user.uid);
  hideAuthLoading();
  if (!exists) {
    // New user — start onboarding
    $('auth-step-login').style.display = 'none';
    $('auth-step-onboard').style.display = 'block';
    $('auth-screen').classList.add('visible');
    document.querySelector('.app-shell').style.display = 'none';
    obShowPage(0);
  } else {
    await finishSignIn();
  }
});

async function finishSignIn() {
  await loadChats();
  hideAuthScreen();
  applyTheme(userProfile.theme || 'dark');
  renderChatList();
  updateSidebarUser();
  loadFilesFromProfile();

  if (Object.keys(chats).length === 0) {
    createNewChat();
  } else {
    const sorted = Object.values(chats).sort((a,b) => (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
    switchToChat(sorted[0].id);
  }
}

/* ── Onboarding ─────────────────────────────────────── */
let obData = { name:'', class:'', subjects:[], lang:'English', schoolCode:'', schoolId:'' };
let obCurrentPage = 0;

function obShowPage(n) {
  for (let i = 0; i <= 4; i++) {
    const p = $(`ob-page-${i}`);
    if (p) p.style.display = i === n ? 'flex' : 'none';
    const dot = $(`ob-dot-${i}`);
    if (dot) dot.classList.toggle('active', i === n);
  }
  $('ob-back-btn') && ($('ob-back-btn').style.display = n > 0 ? 'block' : 'none');
  obCurrentPage = n;
  const nextBtn = $('ob-next-btn');
  if (nextBtn) nextBtn.textContent = n === 4 ? 'Get Started 🚀' : 'Next →';
}

window.obSelect = function(el, type) {
  const grid = el.parentElement;
  grid.querySelectorAll('.ob-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  if (type === 'class') obData.class = el.textContent.trim();
  if (type === 'lang')  obData.lang  = el.textContent.replace(/^.*\s/, '').trim();
};

window.obToggle = function(el, type) {
  el.classList.toggle('selected');
  const val = el.textContent.replace(/^[^\s]+\s/, '').trim();
  if (type === 'subject') {
    if (el.classList.contains('selected')) obData.subjects.push(val);
    else obData.subjects = obData.subjects.filter(s => s !== val);
  }
};

window.obNext = function() {
  clearAuthError();
  if (obCurrentPage === 0) {
    const name = $('ob-name').value.trim();
    if (!name) { showObError('Please enter your name 😊'); return; }
    obData.name = name;
  }
  if (obCurrentPage === 1 && !obData.class) {
    showObError('Please select your class'); return;
  }
  if (obCurrentPage === 3 && !obData.lang) {
    showObError('Please pick a language'); return;
  }
  if (obCurrentPage === 4) {
    obFinish(); return;
  }
  obShowPage(obCurrentPage + 1);
};

window.obBack = function() {
  if (obCurrentPage > 0) obShowPage(obCurrentPage - 1);
};

function showObError(msg) {
  const e = $('auth-error-ob');
  if (e) { e.style.display = 'block'; e.textContent = msg; }
}

window.obSchoolChoice = function(choice) {
  $('ob-school-yes').classList.toggle('selected', choice === 'yes');
  $('ob-school-no').classList.toggle('selected', choice === 'no');
  $('ob-school-code-entry').style.display = choice === 'yes' ? 'block' : 'none';
  $('ob-school-skip-note').style.display  = choice === 'no'  ? 'block' : 'none';
};

window.obVerifySchoolCode = async function() {
  const code = $('ob-school-code-input').value.trim().toUpperCase();
  if (!code) { showObError('Enter a school code'); return; }
  $('ob-verify-btn').textContent = 'Checking…';
  try {
    const snap = await fb().getDocs(fb().collection(fb().db, 'schools'));
    let found = null;
    snap.forEach(d => { if (d.data().code === code) found = { id: d.id, ...d.data() }; });
    if (found) {
      obData.schoolCode = code;
      obData.schoolId   = found.id;
      $('ob-school-confirmed').style.display = 'block';
      $('ob-school-name').textContent = found.name;
      $('ob-school-role').textContent = 'STUDENT';
    } else {
      showObError('School code not found. Check with your teacher.');
    }
  } catch { showObError('Failed to verify. Try again.'); }
  $('ob-verify-btn').textContent = 'Verify →';
};

async function obFinish() {
  userProfile = {
    name:     obData.name,
    class:    obData.class,
    subjects: obData.subjects,
    lang:     obData.lang,
    theme:    'dark',
    ...(obData.schoolId ? { school: { id: obData.schoolId, code: obData.schoolCode } } : {})
  };
  await saveUserProfile();
  if (currentUser) {
    try {
      await fb().updateProfile(currentUser, { displayName: obData.name });
    } catch {}
  }
  await finishSignIn();
}

/* ── Theme ──────────────────────────────────────────── */
function applyTheme(theme) {
  const pref = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.setAttribute('data-theme', pref === 'light' ? 'light' : '');
  userProfile.theme = theme;
}

/* ── Sidebar ────────────────────────────────────────── */
window.toggleSidebar = function() {
  const sb = $('sidebar'), ov = $('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
};
window.closeSidebar = function() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
};

function updateSidebarUser() {
  const wrap = $('sb-user');
  if (!wrap) return;
  const photo = currentUser?.photoURL || '';
  const name  = userProfile.name || currentUser?.displayName || 'Student';
  if (photo) {
    $('sb-avatar').src = photo;
    wrap.style.display = 'flex';
  }
}

/* ── Chat Management ────────────────────────────────── */
function createNewChat(title) {
  const id = uid();
  chats[id] = {
    id,
    title: title || 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: { seconds: Date.now() / 1000 }
  };
  switchToChat(id);
  if (window.innerWidth <= 768) closeSidebar();
  return id;
}

function switchToChat(id) {
  if (!chats[id]) return;
  activeChatId = id;
  renderChatList();
  renderMessages();
  $('header-chat-title').textContent = chats[id].title;
  updateMemoryCount();
}

function renderChatList() {
  const list = $('chat-list');
  if (!list) return;
  const sorted = Object.values(chats).sort((a,b) =>
    (b.updatedAt?.seconds || b.createdAt/1000 || 0) - (a.updatedAt?.seconds || a.createdAt/1000 || 0)
  );
  if (sorted.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;">No chats yet<br>Start a new one ✦</div>`;
    return;
  }
  // Group by date
  const groups = {};
  sorted.forEach(c => {
    const ts = (c.updatedAt?.seconds || c.createdAt/1000 || 0) * 1000;
    const label = dateLabel(ts);
    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  });
  let html = '';
  Object.entries(groups).forEach(([label, items]) => {
    html += `<div style="font-size:9px;color:var(--text3);font-family:'DM Mono',monospace;letter-spacing:.6px;padding:8px 10px 4px;text-transform:uppercase;">${label}</div>`;
    items.forEach(c => {
      const active = c.id === activeChatId;
      const icon = getTopicIcon(c.title);
      html += `<div class="chat-item ${active?'active':''}" onclick="switchToChat('${c.id}')" data-id="${c.id}">
        <span class="chat-item-icon">${icon}</span>
        <span class="chat-item-title">${escHtml(c.title)}</span>
        <button class="chat-item-delete" onclick="event.stopPropagation();deleteChat('${c.id}')" title="Delete">🗑</button>
      </div>`;
    });
  });
  list.innerHTML = html;
}

function getTopicIcon(title) {
  const t = title.toLowerCase();
  if (/math|calc|algebra|geometry|trigon/.test(t)) return '🔢';
  if (/physics|force|motion|energy|wave/.test(t)) return '⚛️';
  if (/chem|element|bond|reaction/.test(t)) return '🧪';
  if (/bio|cell|dna|organism|plant/.test(t)) return '🌿';
  if (/code|program|python|java|html|css/.test(t)) return '💻';
  if (/history|war|empire|revolution/.test(t)) return '🏛️';
  if (/geo|map|country|climate/.test(t)) return '🌍';
  if (/english|essay|grammar|poem/.test(t)) return '📖';
  if (/economics|market|gdp/.test(t)) return '🧮';
  return '💬';
}

window.deleteChat = async function(id) {
  if (!chats[id]) return;
  delete chats[id];
  await deleteChatFromDb(id);
  if (activeChatId === id) {
    const remaining = Object.keys(chats);
    if (remaining.length > 0) switchToChat(remaining[0]);
    else createNewChat();
  } else {
    renderChatList();
  }
};

window.filterChats = function(q) {
  const items = $('chat-list').querySelectorAll('.chat-item');
  items.forEach(el => {
    const title = el.querySelector('.chat-item-title')?.textContent.toLowerCase() || '';
    el.style.display = title.includes(q.toLowerCase()) ? '' : 'none';
  });
};

window.clearCurrentChat = function() {
  if (!activeChatId || !chats[activeChatId]) return;
  chats[activeChatId].messages = [];
  renderMessages();
  saveChatToDb(activeChatId);
};

/* Inline rename */
window.startInlineRename = function() {
  if (inlineRenameActive || !activeChatId) return;
  inlineRenameActive = true;
  const title = chats[activeChatId]?.title || 'New Chat';
  const inp = document.createElement('input');
  inp.value = title;
  inp.style.cssText = 'background:none;border:none;outline:none;font-family:Syne,sans-serif;font-size:15px;font-weight:700;color:var(--text);width:100%;';
  const el = $('header-chat-title');
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus(); inp.select();
  const finish = () => {
    inlineRenameActive = false;
    const newTitle = inp.value.trim() || title;
    if (chats[activeChatId]) chats[activeChatId].title = newTitle;
    el.textContent = newTitle;
    renderChatList();
    saveChatToDb(activeChatId);
  };
  inp.addEventListener('blur', finish);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = title; inp.blur(); } });
};

/* ── Message Rendering ──────────────────────────────── */
function renderMessages() {
  const container = $('chat-messages');
  if (!container) return;
  const msgs = chats[activeChatId]?.messages || [];
  if (msgs.length === 0) {
    container.innerHTML = buildWelcomeScreen();
    return;
  }
  container.innerHTML = msgs.map(renderMessage).join('');
  container.scrollTop = container.scrollHeight;
  afterRender(container);
}

function buildWelcomeScreen() {
  const name = userProfile.name || 'there';
  const lang = userProfile.lang || 'English';
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:24px;padding:20px;">
    <div style="text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;">✦</div>
      <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:var(--text);margin-bottom:6px;">Hey ${escHtml(name)}! 👋</div>
      <div style="font-size:14px;color:var(--text2);font-family:'DM Sans',sans-serif;line-height:1.6;max-width:360px;">
        I'm Sedy, your AI study companion.<br>
        Ask me anything — I'll respond in <strong style="color:var(--accent);">${lang}</strong>.
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;width:100%;max-width:420px;">
      ${[
        ['📚','Create flashcards','on any topic'],
        ['🧠','Generate a quiz','to test yourself'],
        ['📝','Explain a concept','step by step'],
        ['💻','Debug my code','and explain errors']
      ].map(([e,t,s]) => `
        <div onclick="quickPrompt('${t} ${s}')" style="background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:14px;cursor:pointer;transition:all .15s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
          <div style="font-size:20px;margin-bottom:6px;">${e}</div>
          <div style="font-size:12px;font-weight:600;color:var(--text);font-family:'DM Sans',sans-serif;">${t}</div>
          <div style="font-size:11px;color:var(--text3);font-family:'DM Sans',sans-serif;margin-top:2px;">${s}</div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

window.quickPrompt = function(text) {
  $('chat-input').value = text;
  sendMessage();
};

function renderMessage(msg) {
  const isUser = msg.role === 'user';
  const bubbleContent = isUser ? buildUserBubble(msg) : buildAssistantBubble(msg);
  return `<div class="message ${msg.role}" data-id="${msg.id||''}">
    <div class="message-avatar">${isUser ? (currentUser?.photoURL ? `<img src="${escHtml(currentUser.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '🧑') : '✦'}</div>
    <div class="message-content">
      <div class="message-bubble">${bubbleContent}</div>
      <div class="message-time">${msg.time || ''}</div>
    </div>
  </div>`;
}

function buildUserBubble(msg) {
  let html = '';
  if (msg.images?.length) {
    html += msg.images.map(img => `<img src="${img}" style="max-width:200px;border-radius:10px;margin-bottom:6px;cursor:pointer;" onclick="openLightbox('${img}')">`).join('');
  }
  if (msg.pdfs?.length) {
    html += msg.pdfs.map(p => `<div style="background:rgba(255,181,71,.1);border:1px solid rgba(255,181,71,.2);border-radius:8px;padding:6px 10px;font-size:11px;color:var(--warning);font-family:'DM Mono',monospace;margin-bottom:6px;">📄 ${escHtml(p.name)}</div>`).join('');
  }
  if (msg.text) html += `<span>${escHtml(msg.text)}</span>`;
  return html;
}

function buildAssistantBubble(msg) {
  if (!msg.text) return '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  const rendered = renderMarkdown(msg.text);
  const actionBar = buildActionBar(msg);
  return rendered + actionBar;
}

function buildActionBar(msg) {
  return `<div class="ai-action-bar" style="margin-top:10px;">
    <button class="ai-action-btn" onclick="copyMsgText(this)">📋 Copy</button>
    <button class="ai-action-btn" onclick="speakMsg(this,'${escHtml(msg.text?.replace(/'/g,"\\'").slice(0,1000))}')">🔊 Speak</button>
    <button class="ai-action-btn" onclick="saveAsNote(this,'${encodeURIComponent(msg.text||'')}')">📝 Save Note</button>
  </div>`;
}

function afterRender(container) {
  // Syntax highlight
  if (window.hljs) {
    container.querySelectorAll('pre code').forEach(el => {
      if (!el.dataset.highlighted) { hljs.highlightElement(el); el.dataset.highlighted = 'yes'; }
    });
  }
  // KaTeX
  if (window.renderMathInElement) {
    try {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false }
        ],
        throwOnError: false
      });
    } catch {}
  }
}

function appendMessage(msg) {
  const container = $('chat-messages');
  if (!container) return;
  // Clear welcome screen if present
  if (container.querySelector('[style*="flex-direction:column;align-items:center"]')) {
    container.innerHTML = '';
  }
  const div = document.createElement('div');
  div.innerHTML = renderMessage(msg);
  container.appendChild(div.firstElementChild);
  container.scrollTop = container.scrollHeight;
  afterRender(container);
}

function updateLastAssistantMessage(text, done = false) {
  const container = $('chat-messages');
  if (!container) return;
  const msgs = container.querySelectorAll('.message.assistant');
  const last = msgs[msgs.length - 1];
  if (!last) return;
  const bubble = last.querySelector('.message-bubble');
  if (!bubble) return;

  if (!done) {
    bubble.innerHTML = renderMarkdown(text) + `<span class="cursor-blink" style="display:inline-block;width:2px;height:1em;background:var(--accent);margin-left:2px;vertical-align:middle;animation:pulse .7s infinite;"></span>`;
  } else {
    bubble.innerHTML = renderMarkdown(text) + buildActionBar({ text });
    afterRender(bubble);
  }
  container.scrollTop = container.scrollHeight;
}

window.copyMsgText = function(btn) {
  const bubble = btn.closest('.message-bubble');
  if (!bubble) return;
  const text = bubble.textContent.replace(/📋 Copy.*/, '').trim();
  copyText(text);
  btn.textContent = '✓ Copied';
  setTimeout(() => btn.textContent = '📋 Copy', 1500);
};

window.speakMsg = function(btn, text) {
  if (voiceSynth.speaking) { voiceSynth.cancel(); return; }
  const decoded = decodeURIComponent(text);
  const utt = new SpeechSynthesisUtterance(decoded);
  utt.rate = voiceSpeed;
  voiceSynth.speak(utt);
};

window.saveAsNote = function(btn, encodedText) {
  const text = decodeURIComponent(encodedText);
  const title = 'Note — ' + new Date().toLocaleDateString();
  autoSaveFile('notes', { title, content: text });
  btn.textContent = '✓ Saved';
  btn.style.color = 'var(--success)';
  setTimeout(() => { btn.textContent = '📝 Save Note'; btn.style.color = ''; }, 1500);
};

function updateMemoryCount() {
  const count = chats[activeChatId]?.messages?.length || 0;
  const el = $('memory-count-sb');
  if (el) el.textContent = `${count} message${count !== 1 ? 's' : ''}`;
}

/* ── Typing Indicator ───────────────────────────────── */
function showTyping() {
  const container = $('chat-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.id = 'typing-msg';
  div.className = 'message assistant';
  div.innerHTML = `<div class="message-avatar">✦</div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function hideTyping() {
  const el = $('typing-msg');
  if (el) el.remove();
}

/* ── Model & Free Mode ──────────────────────────────── */
window.setModel = function(m) {
  selectedModel = m;
  document.querySelectorAll('.model-btn').forEach(b => b.classList.toggle('active', b.dataset.model === m));
};

window.enableFreeMode = function() {
  isFreeMode = true;
  $('freemode-banner').classList.add('active');
  closeRateLimit();
  freeMsgCount = 0;
};

window.disableFreeMode = function() {
  isFreeMode = false;
  $('freemode-banner').classList.remove('active');
};

/* ── Rate Limit UI ──────────────────────────────────── */
function showRateLimit(msg) {
  $('rl-overlay').style.display = 'flex';
  $('rl-subtitle').textContent = msg || "You've reached the usage limit.";
  rlResetAt = Date.now() + RATE_LIMIT_MS;
  startRlCountdown();
}

window.closeRateLimit = function() {
  $('rl-overlay').style.display = 'none';
  if (rlTimer) { clearInterval(rlTimer); rlTimer = null; }
};

function startRlCountdown() {
  updateRlTimer();
  rlTimer = setInterval(updateRlTimer, 1000);
}

function updateRlTimer() {
  const remaining = Math.max(0, rlResetAt - Date.now());
  if (remaining === 0) { closeRateLimit(); return; }
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const el = $('rl-timer');
  if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const bar = $('rl-bar');
  if (bar) bar.style.width = ((remaining / RATE_LIMIT_MS) * 100) + '%';
}

/* ── Send Message ───────────────────────────────────── */
window.handleKey = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

window.autoResize = function(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
};

window.sendMessage = async function() {
  if (isStreaming) {
    // Cancel current stream
    abortController?.abort();
    isStreaming = false;
    return;
  }

  const input = $('chat-input');
  const text  = input.value.trim();
  const hasAttachment = stagedImages.length > 0 || stagedPdfs.length > 0 || wbDataUrl || scopeDataUrl || screenshotDataUrl;

  if (!text && !hasAttachment) return;
  if (!activeChatId) createNewChat();

  // Gather context
  const contextNote = selContextText ? `[Selected text for context: "${selContextText}"]` : '';
  const fullText = contextNote ? `${contextNote}\n\n${text}` : text;

  // Build user message
  const userMsg = {
    id: uid(),
    role: 'user',
    text: text,
    time: timeStr(),
    images: [...stagedImages.map(i => i.dataUrl)],
    pdfs:   [...stagedPdfs.map(p => ({ name: p.name }))],
  };

  // Add to chat
  chats[activeChatId].messages.push(userMsg);
  if (chats[activeChatId].messages.length === 1) {
    // Auto-title from first message
    const autoTitle = text.slice(0, 40) || 'New Chat';
    chats[activeChatId].title = autoTitle;
    $('header-chat-title').textContent = autoTitle;
    renderChatList();
  }

  appendMessage(userMsg);

  // Clear inputs
  input.value = '';
  input.style.height = 'auto';
  clearStagedImages();
  clearStagedPdfs();
  clearSelContext();
  const wb = wbDataUrl; wbDataUrl = null;
  const sc = scopeDataUrl; scopeDataUrl = null;
  const ss = screenshotDataUrl; screenshotDataUrl = null;

  updateMemoryCount();
  await callAI(fullText, wb || sc || ss);
};

async function callAI(userText, imageDataUrl = null) {
  if (!activeChatId) return;
  const chat = chats[activeChatId];

  // Build messages array for API
  const systemMsg = { role: 'system', content: buildSystemPrompt() };

  // Get recent context
  const history = chat.messages.slice(-MAX_CONTEXT_MSGS);
  const apiMessages = history.map(m => {
    if (m.role === 'user') {
      // Build content parts
      const parts = [];
      // Add PDF text
      if (stagedPdfs.length > 0) {
        stagedPdfs.forEach(p => parts.push({ type: 'text', text: `[PDF: ${p.name}]\n${p.text}` }));
      }
      // Add images
      if (m.images?.length) {
        m.images.forEach(img => {
          const mime = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          parts.push({ type: 'image_url', image_url: { url: img } });
        });
      }
      parts.push({ type: 'text', text: m.text || '' });
      return { role: 'user', content: parts.length > 1 ? parts : m.text || '' };
    }
    return { role: m.role, content: m.text || '' };
  });

  // If there's an image to send right now
  if (imageDataUrl) {
    const last = apiMessages[apiMessages.length - 1];
    if (last && last.role === 'user') {
      if (typeof last.content === 'string') {
        last.content = [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: last.content }
        ];
      } else if (Array.isArray(last.content)) {
        last.content.unshift({ type: 'image_url', image_url: { url: imageDataUrl } });
      }
    }
  }

  const model = isFreeMode ? FREE_MODEL : MODELS[selectedModel] || MODELS.auto;

  // Add placeholder assistant message
  const assistantMsg = { id: uid(), role: 'assistant', text: '', time: timeStr() };
  chat.messages.push(assistantMsg);
  showTyping();

  isStreaming = true;
  abortController = new AbortController();
  $('send-btn')?.setAttribute('title', 'Stop');

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [systemMsg, ...apiMessages],
        stream: true,
        max_tokens: 2048,
        temperature: 0.7
      }),
      signal: abortController.signal
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const status = resp.status;
      if (status === 429) {
        showRateLimit('Too many requests. Please wait before trying again.');
        hideTyping();
        chat.messages.pop();
        isStreaming = false;
        return;
      }
      throw new Error(err.error?.message || `HTTP ${status}`);
    }

    hideTyping();

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          fullText += delta;
          updateLastAssistantMessage(fullText, false);
        } catch {}
      }
    }

    updateLastAssistantMessage(fullText, true);
    assistantMsg.text = fullText;

    // Auto-save files detected in response
    // (handled inside renderMarkdown already via autoSaveFile)

    saveChatToDb(activeChatId);
    updateMemoryCount();

    if (isFreeMode) {
      freeMsgCount++;
      if (freeMsgCount >= MAX_FREE_MSGS) {
        showRateLimit('Free mode limit reached. Please wait or upgrade.');
        disableFreeMode();
      }
    }

  } catch (e) {
    hideTyping();
    if (e.name === 'AbortError') {
      updateLastAssistantMessage(assistantMsg.text || '*(stopped)*', true);
    } else {
      const errMsg = e.message?.includes('Failed to fetch')
        ? 'Network error. Check your connection.'
        : (e.message || 'Something went wrong.');
      const errBubble = `<div style="color:var(--danger);font-size:13px;font-family:'DM Mono',monospace;">⚠ ${errMsg}</div>`;
      const last = $('chat-messages')?.querySelectorAll('.message.assistant');
      if (last?.length) last[last.length-1].querySelector('.message-bubble').innerHTML = errBubble;
      chat.messages.pop();
    }
  }

  isStreaming = false;
  abortController = null;
  $('send-btn')?.setAttribute('title', 'Send');
}

/* ── Text Selection Popup ───────────────────────────── */
document.addEventListener('mouseup', e => {
  if (e.target.closest('#sel-popup')) return;
  const sel = window.getSelection();
  if (sel && sel.toString().trim().length > 10) {
    const popup = $('sel-popup');
    popup.classList.add('visible');
    popup.style.left = Math.min(e.pageX, window.innerWidth - 200) + 'px';
    popup.style.top  = (e.pageY - 48) + 'px';
  } else {
    $('sel-popup')?.classList.remove('visible');
  }
});

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#sel-popup')) $('sel-popup')?.classList.remove('visible');
});

window.addSelectionToContext = function() {
  const sel = window.getSelection()?.toString().trim();
  if (!sel) return;
  selContextText = sel;
  renderSelContext();
  $('sel-popup')?.classList.remove('visible');
};

window.askSelectionNow = function() {
  const sel = window.getSelection()?.toString().trim();
  if (!sel) return;
  $('chat-input').value = `Explain this: "${sel}"`;
  sendMessage();
  $('sel-popup')?.classList.remove('visible');
};

function renderSelContext() {
  const row = $('sel-context-row');
  if (!row) return;
  if (!selContextText) { row.innerHTML = ''; return; }
  row.innerHTML = `<div class="sel-context-chip">
    <span>📎 "${escHtml(selContextText.slice(0,50))}${selContextText.length > 50 ? '…' : ''}"</span>
    <button onclick="clearSelContext()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;line-height:1;">✕</button>
  </div>`;
}

window.clearSelContext = function() {
  selContextText = '';
  renderSelContext();
};

/* ── File Staging ───────────────────────────────────── */
window.toggleAttachMenu = function(e) {
  e.stopPropagation();
  const menu = $('attach-menu');
  menu.classList.toggle('open');
};

document.addEventListener('click', e => {
  if (!e.target.closest('#attach-wrap')) $('attach-menu')?.classList.remove('open');
});

window.pickAnyFile = function() {
  $('attach-menu')?.classList.remove('open');
  $('file-input').click();
};

window.handleAnyFile = function(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      handleImageFile(file);
    } else if (file.type === 'application/pdf') {
      handlePdfFile(file);
    } else {
      // Treat as text
      const reader = new FileReader();
      reader.onload = ev => {
        stagedPdfs.push({ name: file.name, text: ev.target.result.slice(0, 8000) });
        renderStagedPdfs();
      };
      reader.readAsText(file);
    }
  });
  e.target.value = '';
};

window.handlePdfSelect = function(e) {
  Array.from(e.target.files).forEach(handlePdfFile);
  e.target.value = '';
};

async function handlePdfFile(file) {
  if (!window.pdfjsLib) return;
  try {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(s => s.str).join(' ') + '\n';
    }
    stagedPdfs.push({ name: file.name, text: text.slice(0, 12000) });
    renderStagedPdfs();
  } catch { showToast('Failed to read PDF', 'error'); }
}

window.handleImgSelect = function(e) {
  Array.from(e.target.files).forEach(handleImageFile);
  e.target.value = '';
};

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    stagedImages.push({ dataUrl: ev.target.result, mimeType: file.type, name: file.name });
    renderStagedImages();
  };
  reader.readAsDataURL(file);
}

function renderStagedImages() {
  const row = $('img-staged-row');
  if (!row) return;
  row.innerHTML = stagedImages.map((img, i) => `
    <div style="position:relative;display:inline-block;margin-right:8px;">
      <img src="${img.dataUrl}" style="height:64px;width:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border2);">
      <button onclick="removeStagedImage(${i})" style="position:absolute;top:-6px;right:-6px;background:var(--danger);border:none;color:white;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;">✕</button>
    </div>
  `).join('');
}

window.removeStagedImage = function(i) {
  stagedImages.splice(i, 1);
  renderStagedImages();
};

function clearStagedImages() { stagedImages = []; renderStagedImages(); }

function renderStagedPdfs() {
  const row = $('pdf-staged-row');
  if (!row) return;
  row.innerHTML = stagedPdfs.map((p,i) => `
    <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,181,71,.1);border:1px solid rgba(255,181,71,.2);border-radius:8px;padding:5px 10px;margin-right:8px;">
      <span style="font-size:12px;color:var(--warning);font-family:'DM Mono',monospace;">📄 ${escHtml(p.name)}</span>
      <button onclick="removeStagedPdf(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;">✕</button>
    </div>
  `).join('');
}

window.removeStagedPdf = function(i) {
  stagedPdfs.splice(i, 1);
  renderStagedPdfs();
};

function clearStagedPdfs() { stagedPdfs = []; renderStagedPdfs(); }

/* ── Screenshot / Crop ──────────────────────────────── */
window.startScreenshot = function() {
  $('attach-menu')?.classList.remove('open');
  const overlay = $('crop-overlay');
  overlay.classList.add('active');
  cropCanvas = $('crop-canvas');
  cropCtx = cropCanvas.getContext('2d');
  cropCanvas.width = window.innerWidth;
  cropCanvas.height = window.innerHeight;
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

  overlay.addEventListener('mousedown', cropStart);
  overlay.addEventListener('mousemove', cropMove);
  overlay.addEventListener('mouseup', cropEnd);
  overlay.addEventListener('touchstart', cropStartT, { passive: false });
  overlay.addEventListener('touchmove', cropMoveT, { passive: false });
  overlay.addEventListener('touchend', cropEndT);
};

function cropStart(e) { cropDragging = true; cropStartX = e.clientX; cropStartY = e.clientY; $('crop-confirm').style.display = 'none'; }
function cropMove(e) {
  if (!cropDragging) return;
  cropEndX = e.clientX; cropEndY = e.clientY;
  const sel = $('crop-selection');
  const x = Math.min(cropStartX, cropEndX), y = Math.min(cropStartY, cropEndY);
  const w = Math.abs(cropEndX - cropStartX), h = Math.abs(cropEndY - cropStartY);
  sel.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  if (w > 10 && h > 10) $('crop-confirm').style.display = 'inline-flex';
}
function cropEnd() { cropDragging = false; }
function cropStartT(e) { e.preventDefault(); cropStart(e.touches[0]); }
function cropMoveT(e)  { e.preventDefault(); cropMove(e.touches[0]); }
function cropEndT()    { cropEnd(); }

window.captureFullScreen = async function() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    screenshotDataUrl = c.toDataURL('image/png');
    cancelCrop();
    stagedImages.push({ dataUrl: screenshotDataUrl, mimeType: 'image/png', name: 'screenshot.png' });
    renderStagedImages();
    showToast('Screenshot captured!', 'success');
  } catch { showToast('Screen capture cancelled', 'info'); cancelCrop(); }
};

window.cropAndSend = function() {
  const x = Math.min(cropStartX, cropEndX), y = Math.min(cropStartY, cropEndY);
  const w = Math.abs(cropEndX - cropStartX), h = Math.abs(cropEndY - cropStartY);
  if (w < 10 || h < 10) return;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // Use html2canvas-like approach — just capture region as dataURL via getDisplayMedia
  screenshotDataUrl = null;
  // Fallback: show the region with screenshot
  captureFullScreen();
  cancelCrop();
};

window.cancelCrop = function() {
  const overlay = $('crop-overlay');
  overlay.classList.remove('active');
  $('crop-selection').style.cssText = '';
  $('crop-confirm').style.display = 'none';
  cropDragging = false;
};

/* ── Lightbox ───────────────────────────────────────── */
window.openLightbox = function(src) {
  $('lightbox-img').src = src;
  $('lightbox').classList.add('open');
};
window.closeLightbox = function() { $('lightbox').classList.remove('open'); };

/* ── Voice Input (in chat) ──────────────────────────── */
window.toggleVoice = function() {
  if (voiceActive) {
    voiceRecognition?.stop();
    voiceActive = false;
    $('mic-btn').style.color = '';
    return;
  }
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('Voice not supported in this browser', 'error');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceRecognition = new SR();
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = true;
  voiceRecognition.lang = getLangCode(userProfile.lang);
  voiceRecognition.onresult = e => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    $('chat-input').value = transcript;
    autoResize($('chat-input'));
  };
  voiceRecognition.onend = () => {
    voiceActive = false;
    $('mic-btn').style.color = '';
  };
  voiceRecognition.start();
  voiceActive = true;
  $('mic-btn').style.color = 'var(--danger)';
};

function getLangCode(lang) {
  const map = { Hindi:'hi-IN', Bengali:'bn-IN', Tamil:'ta-IN', Telugu:'te-IN', Marathi:'mr-IN', Kannada:'kn-IN', Gujarati:'gu-IN', Punjabi:'pa-IN', Malayalam:'ml-IN', Hinglish:'hi-IN' };
  return map[lang] || 'en-US';
}

/* ── Voice Chat Overlay ─────────────────────────────── */
window.openVoiceChat = function() {
  $('voice-overlay').style.display = 'flex';
  $('voice-live-indicator').style.display = 'flex';
  voiceHistory = [];
  renderVoiceHistory();
};

window.closeVoiceChat = function() {
  $('voice-overlay').style.display = 'none';
  $('voice-live-indicator').style.display = 'none';
  if (voiceSynth.speaking) voiceSynth.cancel();
  voiceRecognition?.stop();
};

window.selectPersona = function(p) {
  voicePersona = p;
  $('vpersona-girl').classList.toggle('active', p === 'girl');
  $('vpersona-boy').classList.toggle('active', p === 'boy');
  const orb = $('voice-main-orb');
  orb.className = `voice-main-orb ${p}`;
  orb.style.background = p === 'girl'
    ? 'linear-gradient(135deg,#7c5cfc,#e879f9)'
    : 'linear-gradient(135deg,#4f8eff,#00e5c0)';
  $('voice-name-display').textContent = p === 'girl' ? 'Aria' : 'Nova';
};

window.setVoiceSpeed = function(speed, btn) {
  voiceSpeed = speed;
  document.querySelectorAll('.voice-speed-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};

let voiceHoldRec = null;
window.voiceHoldStart = function(e) {
  if (e) e.preventDefault();
  const btn = $('voice-hold-btn');
  btn.classList.add('active');
  $('voice-status').textContent = 'Listening…';
  $('voice-orb-icon').textContent = '🎤';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  voiceHoldRec = new SR();
  voiceHoldRec.lang = getLangCode(userProfile.lang);
  voiceHoldRec.interimResults = true;
  voiceHoldRec.onresult = e => {
    const t = Array.from(e.results).map(r=>r[0].transcript).join('');
    $('voice-transcript').textContent = t;
    // Detect language
    detectAndShowLang(t);
  };
  voiceHoldRec.start();
};

window.voiceHoldEnd = async function(e) {
  if (e) e.preventDefault();
  const btn = $('voice-hold-btn');
  btn.classList.remove('active');
  const transcript = $('voice-transcript').textContent.trim();
  if (!transcript) { $('voice-status').textContent = 'Hold the mic to speak'; return; }
  $('voice-status').textContent = 'Thinking…';
  $('voice-orb-icon').textContent = '⏳';
  voiceHoldRec?.stop();

  const reply = await getVoiceReply(transcript);
  voiceHistory.push({ role:'user', text:transcript });
  voiceHistory.push({ role:'assistant', text:reply });
  renderVoiceHistory();
  $('voice-transcript').textContent = '';
  speakVoiceReply(reply);
};

async function getVoiceReply(userText) {
  const systemMsg = { role:'system', content: buildSystemPrompt() + '\n\nKeep voice responses concise (2-3 sentences max). Be conversational.' };
  const histMsgs = voiceHistory.slice(-6).map(m => ({ role:m.role, content:m.text }));
  histMsgs.push({ role:'user', content:userText });

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: isFreeMode ? FREE_MODEL : MODELS.flash, messages:[systemMsg,...histMsgs], max_tokens:300 })
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || 'Sorry, I couldn\'t get a response.';
  } catch { return 'Network error. Please try again.'; }
}

function speakVoiceReply(text) {
  if (voiceSynth.speaking) voiceSynth.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = voiceSpeed;
  utt.lang = getLangCode(userProfile.lang);
  // Try to match persona voice
  const voices = voiceSynth.getVoices();
  const target = voicePersona === 'girl'
    ? voices.find(v => v.name.includes('Female') || v.name.includes('Google UK English Female') || v.name.includes('Samantha'))
    : voices.find(v => v.name.includes('Male') || v.name.includes('Daniel'));
  if (target) utt.voice = target;

  const orb = $('voice-main-orb');
  utt.onstart = () => { orb.classList.add('speaking'); $('voice-orb-icon').textContent = '🔊'; $('voice-status').textContent = 'Speaking…'; };
  utt.onend   = () => { orb.classList.remove('speaking'); $('voice-orb-icon').textContent = '🎙'; $('voice-status').textContent = 'Hold the mic to speak'; };
  voiceSynth.speak(utt);
}

function detectAndShowLang(text) {
  const badge = $('voice-lang-badge');
  if (!badge) return;
  const devanagari = /[\u0900-\u097F]/.test(text);
  const bengali    = /[\u0980-\u09FF]/.test(text);
  if (devanagari) { $('voice-lang-flag').textContent='🇮🇳'; $('voice-lang-name').textContent='Hindi'; badge.style.display='flex'; }
  else if (bengali) { $('voice-lang-flag').textContent='🇮🇳'; $('voice-lang-name').textContent='Bengali'; badge.style.display='flex'; }
  else { badge.style.display='none'; }
}

function renderVoiceHistory() {
  const row = $('voice-history-row');
  if (!row) return;
  row.innerHTML = voiceHistory.slice(-4).map(m =>
    `<div class="voice-history-item ${m.role}">${escHtml(m.text.slice(0,120))}</div>`
  ).join('');
}

/* ── Files Panel ────────────────────────────────────── */
window.openFilesPanel = function() {
  $('files-overlay').classList.add('open');
  $('files-panel').classList.add('open');
  renderFilesList();
  updateFilesCount();
};
window.closeFilesPanel = function() {
  $('files-overlay').classList.remove('open');
  $('files-panel').classList.remove('open');
};

let activeFilesTab = 'notes';
window.switchFilesTab = function(tab) {
  activeFilesTab = tab;
  ['notes','formula','flowchart'].forEach(t => {
    $(`ftab-${t}`)?.classList.toggle('active', t === tab);
  });
  renderFilesList();
};

function renderFilesList() {
  const list = $('files-list');
  if (!list) return;
  const items = filesData[activeFilesTab] || [];
  if (items.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;">No ${activeFilesTab} saved yet.<br>Ask Sedy to create some! ✦</div>`;
    return;
  }
  list.innerHTML = items.map((item, i) => `
    <div class="file-item" onclick="viewFile('${activeFilesTab}',${i})">
      <div class="file-item-title">${escHtml(item.title)}</div>
      <div class="file-item-date">${item.date || ''}</div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button onclick="event.stopPropagation();deleteFile('${activeFilesTab}',${i})" style="background:none;border:none;color:var(--danger);font-size:11px;cursor:pointer;font-family:'DM Mono',monospace;">Delete</button>
        <button onclick="event.stopPropagation();copyFile('${activeFilesTab}',${i})" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;font-family:'DM Mono',monospace;">Copy</button>
      </div>
    </div>
  `).join('');
}

function autoSaveFile(type, item) {
  if (!filesData[type]) filesData[type] = [];
  // Avoid duplicates
  const exists = filesData[type].find(f => f.title === item.title);
  if (!exists) {
    filesData[type].push({ ...item, date: new Date().toLocaleDateString() });
    saveFilesToProfile();
    updateFilesCount();
    showToast(`Saved to ${type}!`, 'success');
  }
}

window.deleteFile = function(type, i) {
  filesData[type].splice(i, 1);
  renderFilesList();
  saveFilesToProfile();
  updateFilesCount();
};

window.copyFile = function(type, i) {
  const item = filesData[type][i];
  if (item) copyText(item.content || item.title);
};

window.viewFile = function(type, i) {
  const item = filesData[type][i];
  if (!item) return;
  // Open in a modal-style view by sending to chat
  $('chat-input').value = `Show me my saved ${type === 'notes' ? 'note' : type === 'formula' ? 'formula sheet' : 'flowchart'}: "${item.title}"`;
  closeFilesPanel();
};

function updateFilesCount() {
  const total = (filesData.notes?.length || 0) + (filesData.formula?.length || 0) + (filesData.flowchart?.length || 0);
  const el = $('files-count');
  if (el) el.textContent = total;
}

async function saveFilesToProfile() {
  if (!currentUser) return;
  try {
    await fb().setDoc(fb().doc(fb().db, 'users', currentUser.uid), { filesData }, { merge: true });
  } catch {}
}

function loadFilesFromProfile() {
  if (userProfile.filesData) filesData = userProfile.filesData;
  updateFilesCount();
}

/* ── Scope ──────────────────────────────────────────── */
window.openScope = window.openScopeFromMenu = async function() {
  $('attach-menu')?.classList.remove('open');
  const overlay = $('scope-overlay');
  overlay.classList.add('open');
  await startScopeCamera();
  renderScopeMemories();
};

window.closeScope = function() {
  $('scope-overlay').classList.remove('open');
  scopeStream?.getTracks().forEach(t => t.stop());
  scopeStream = null;
  const video = $('scope-video');
  if (video) video.srcObject = null;
};

async function startScopeCamera() {
  try {
    scopeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: scopeFacingMode }, audio: false });
    const video = $('scope-video');
    video.srcObject = scopeStream;
  } catch { showToast('Camera access denied', 'error'); }
}

window.scopeFlipCamera = async function() {
  scopeStream?.getTracks().forEach(t => t.stop());
  scopeFacingMode = scopeFacingMode === 'environment' ? 'user' : 'environment';
  await startScopeCamera();
};

window.scopeCapture = async function() {
  if (scopeAnalysing) return;
  const video = $('scope-video');
  const freeze = $('scope-freeze');
  freeze.width = video.videoWidth;
  freeze.height = video.videoHeight;
  freeze.getContext('2d').drawImage(video, 0, 0);
  freeze.style.display = 'block';
  scopeDataUrl = freeze.toDataURL('image/jpeg', 0.85);

  $('scope-scan-overlay').classList.add('active');
  $('scope-scan-label').textContent = 'Analysing…';
  scopeAnalysing = true;

  const input = $('scope-text-input').value.trim();
  const prompt = input || 'Identify and explain what you see in this image. If it is a diagram, equation, or text — explain it in detail.';
  $('scope-text-input').value = '';

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
      body:JSON.stringify({
        model: MODELS.auto,
        messages:[
          { role:'system', content: buildSystemPrompt() },
          { role:'user', content:[
            { type:'image_url', image_url:{ url:scopeDataUrl } },
            { type:'text', text:prompt }
          ]}
        ],
        max_tokens: 800
      })
    });
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || 'Could not analyse image.';
    showScopeAnswer(answer);
  } catch { showToast('Analysis failed', 'error'); }

  $('scope-scan-overlay').classList.remove('active');
  scopeAnalysing = false;
  freeze.style.display = 'none';
};

function showScopeAnswer(text) {
  $('scope-answer-body').innerHTML = renderMarkdown(text);
  $('scope-answer-card').classList.add('open');
  $('scope-save-btn').style.display = 'inline-flex';
}

window.closeScopeAnswer = function() { $('scope-answer-card').classList.remove('open'); };

window.speakScopeAnswer = function() {
  const text = $('scope-answer-body').textContent;
  speakMsg(null, encodeURIComponent(text.slice(0,800)));
};

window.sendScopeToMain = function() {
  const text = $('scope-answer-body').textContent;
  closeScope();
  if (text) {
    $('chat-input').value = `I have a question about this:\n\n${text.slice(0,300)}`;
    setTimeout(() => $('chat-input').focus(), 300);
  }
};

window.scopeSaveFromAnswer = function() {
  const text = $('scope-answer-body').textContent;
  autoSaveFile('notes', { title: 'Scope Note — ' + new Date().toLocaleDateString(), content: text });
};

window.scopeSend = function() {
  scopeCapture();
};

window.scopeToggleMemories = function() {
  $('scope-memories-panel').classList.toggle('open');
};

function renderScopeMemories() {
  const list = $('scope-memories-list');
  if (!list) return;
  const badge = $('scope-mem-badge');
  if (scopeMemories.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:rgba(255,255,255,.4);font-family:'DM Mono',monospace;">No memories yet.<br>Say "Remember [name]" while pointing at something.</div>`;
    if (badge) badge.style.display = 'none';
    return;
  }
  list.innerHTML = scopeMemories.map((m,i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.05);margin-bottom:6px;">
      <img src="${m.image}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;color:white;font-family:'Syne',sans-serif;">${escHtml(m.name)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.4);font-family:'DM Mono',monospace;">${m.date}</div>
      </div>
      <button onclick="deleteScopeMemory(${i})" style="background:none;border:none;color:rgba(255,79,106,.7);cursor:pointer;font-size:14px;">✕</button>
    </div>
  `).join('');
  if (badge) { badge.style.display = 'flex'; $('scope-mem-count').textContent = scopeMemories.length; }
}

window.deleteScopeMemory = function(i) {
  scopeMemories.splice(i, 1);
  renderScopeMemories();
};

let scopeVoiceRec = null;
window.toggleScopeVoice = function() {
  if (scopeVoiceActive) {
    scopeVoiceRec?.stop();
    scopeVoiceActive = false;
    $('scope-voice-btn').style.color = '';
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  scopeVoiceRec = new SR();
  scopeVoiceRec.lang = getLangCode(userProfile.lang);
  scopeVoiceRec.onresult = e => {
    const t = Array.from(e.results).map(r=>r[0].transcript).join('');
    $('scope-text-input').value = t;
    if (e.results[0].isFinal) scopeCapture();
  };
  scopeVoiceRec.onend = () => { scopeVoiceActive = false; $('scope-voice-btn').style.color = ''; };
  scopeVoiceRec.start();
  scopeVoiceActive = true;
  $('scope-voice-btn').style.color = 'var(--danger)';
};

/* ── Whiteboard ─────────────────────────────────────── */
window.openWhiteboard = window.openWhiteboardFromMenu = function() {
  $('attach-menu')?.classList.remove('open');
  $('wb-overlay').classList.add('open');
  initWbCanvas();
};
window.closeWhiteboard = function() { $('wb-overlay').classList.remove('open'); };

window.wbSwitchTab = function(tab) {
  $('wb-tab-draw').classList.toggle('active', tab === 'draw');
  $('wb-tab-practice').classList.toggle('active', tab === 'practice');
  $('wb-draw-pane').style.display = tab === 'draw' ? 'flex' : 'none';
  $('wb-practice-pane').style.display = tab === 'practice' ? 'flex' : 'none';
  if (tab === 'practice') initWbpCanvas();
};

function initWbCanvas() {
  const canvas = $('wb-canvas');
  if (!canvas) return;
  wbCanvas = canvas;
  wbCtx = canvas.getContext('2d');
  const wrap = $('wb-canvas-wrap');
  canvas.width = wrap.offsetWidth;
  canvas.height = wrap.offsetHeight;
  wbCtx.fillStyle = '#111827';
  wbCtx.fillRect(0,0,canvas.width,canvas.height);
  wbHistory = [canvas.toDataURL()];

  const draw = (e, type) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = ((e.clientX || e.touches?.[0]?.clientX || 0) - rect.left) * scaleX;
    const cy = ((e.clientY || e.touches?.[0]?.clientY || 0) - rect.top)  * scaleY;
    if (type === 'start') { wbDrawing = true; wbCtx.beginPath(); wbCtx.moveTo(cx,cy); }
    else if (type === 'move' && wbDrawing) {
      wbCtx.lineTo(cx,cy);
      wbCtx.strokeStyle = wbEraserMode ? '#111827' : wbColor;
      wbCtx.lineWidth   = wbEraserMode ? wbSize * 3 : wbSize;
      wbCtx.lineCap = 'round'; wbCtx.lineJoin = 'round';
      wbCtx.stroke();
    }
    else if (type === 'end' && wbDrawing) {
      wbDrawing = false;
      wbHistory.push(canvas.toDataURL());
      if (wbHistory.length > 30) wbHistory.shift();
    }
  };

  canvas.onmousedown  = e => draw(e,'start');
  canvas.onmousemove  = e => draw(e,'move');
  canvas.onmouseup    = e => draw(e,'end');
  canvas.onmouseleave = e => draw(e,'end');
  canvas.ontouchstart = e => { e.preventDefault(); draw(e,'start'); };
  canvas.ontouchmove  = e => { e.preventDefault(); draw(e,'move'); };
  canvas.ontouchend   = e => { e.preventDefault(); draw(e,'end'); };
}

window.setWbColor = function(el) {
  wbColor = el.dataset.color;
  wbEraserMode = false;
  $('wb-eraser-btn').classList.remove('active');
  document.querySelectorAll('#wb-draw-tools .wb-color').forEach(c => c.classList.toggle('active', c === el));
};

window.setWbEraser = function() {
  wbEraserMode = !wbEraserMode;
  $('wb-eraser-btn').classList.toggle('active', wbEraserMode);
};

window.wbUndo = function() {
  if (wbHistory.length <= 1) return;
  wbHistory.pop();
  const img = new Image();
  img.onload = () => { wbCtx.clearRect(0,0,wbCanvas.width,wbCanvas.height); wbCtx.drawImage(img,0,0); };
  img.src = wbHistory[wbHistory.length-1];
};

window.wbClear = function() {
  wbCtx.fillStyle = '#111827';
  wbCtx.fillRect(0,0,wbCanvas.width,wbCanvas.height);
  wbHistory = [wbCanvas.toDataURL()];
};

window.wbAsk = async function() {
  if (!wbCanvas) return;
  wbDataUrl = wbCanvas.toDataURL('image/png');
  const panel = $('wb-answer-panel');
  panel.classList.add('open');
  $('wb-ans-body').innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  const prompt = $('wb-prompt-input').value.trim() || 'What is drawn on this whiteboard? Identify and explain any equations, diagrams, or text you see.';

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
      body:JSON.stringify({
        model: MODELS.auto,
        messages:[
          { role:'system', content: buildSystemPrompt() },
          { role:'user', content:[
            { type:'image_url', image_url:{ url:wbDataUrl } },
            { type:'text', text:prompt }
          ]}
        ],
        max_tokens:1000
      })
    });
    const data = await resp.json();
    const ans = data.choices?.[0]?.message?.content || 'Could not analyse whiteboard.';
    $('wb-ans-body').innerHTML = renderMarkdown(ans);
    afterRender($('wb-ans-body'));
  } catch { $('wb-ans-body').innerHTML = '<span style="color:var(--danger);">Analysis failed.</span>'; }
};

window.wbAskPrompt = function() { wbAsk(); };

window.collapseWbPanel = function() { $('wb-answer-panel').classList.remove('open'); };

/* Whiteboard Practice */
function initWbpCanvas() {
  const canvas = $('wbp-canvas');
  if (!canvas) return;
  wbpCanvas = canvas;
  wbpCtx = canvas.getContext('2d');
  const wrap = $('wbp-canvas-wrap');
  canvas.width = wrap.offsetWidth;
  canvas.height = wrap.offsetHeight;
  wbpCtx.fillStyle = '#111827';
  wbpCtx.fillRect(0,0,canvas.width,canvas.height);
  wbpHistory = [canvas.toDataURL()];

  const draw = (e, type) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = ((e.clientX || e.touches?.[0]?.clientX || 0) - rect.left) * scaleX;
    const cy = ((e.clientY || e.touches?.[0]?.clientY || 0) - rect.top)  * scaleY;
    if (type === 'start') { wbpDrawing = true; wbpCtx.beginPath(); wbpCtx.moveTo(cx,cy); }
    else if (type === 'move' && wbpDrawing) {
      wbpCtx.lineTo(cx,cy);
      wbpCtx.strokeStyle = wbpEraserMode ? '#111827' : wbpColor;
      wbpCtx.lineWidth   = wbpEraserMode ? wbpSize * 3 : wbpSize;
      wbpCtx.lineCap = 'round'; wbpCtx.lineJoin = 'round';
      wbpCtx.stroke();
    }
    else if (type === 'end') { wbpDrawing = false; wbpHistory.push(canvas.toDataURL()); }
  };
  canvas.onmousedown  = e => draw(e,'start');
  canvas.onmousemove  = e => draw(e,'move');
  canvas.onmouseup    = e => draw(e,'end');
  canvas.onmouseleave = e => draw(e,'end');
  canvas.ontouchstart = e => { e.preventDefault(); draw(e,'start'); };
  canvas.ontouchmove  = e => { e.preventDefault(); draw(e,'move'); };
  canvas.ontouchend   = e => { e.preventDefault(); draw(e,'end'); };
}

window.setWbpColor = function(el) {
  wbpColor = el.dataset.color; wbpEraserMode = false;
  $('wbp-eraser-btn')?.classList.remove('active');
  document.querySelectorAll('#wbp-tool-bar .wb-color').forEach(c => c.classList.toggle('active', c===el));
};
window.setWbpEraser = function() { wbpEraserMode = !wbpEraserMode; $('wbp-eraser-btn')?.classList.toggle('active',wbpEraserMode); };
window.wbpUndo = function() {
  if (wbpHistory.length <= 1) return;
  wbpHistory.pop();
  const img = new Image();
  img.onload = () => { wbpCtx.clearRect(0,0,wbpCanvas.width,wbpCanvas.height); wbpCtx.drawImage(img,0,0); };
  img.src = wbpHistory[wbpHistory.length-1];
};
window.wbpClear = function() {
  wbpCtx.fillStyle = '#111827';
  wbpCtx.fillRect(0,0,wbpCanvas.width,wbpCanvas.height);
  wbpHistory = [wbpCanvas.toDataURL()];
};

window.wbpStartPractice = async function() {
  const topic = $('wbp-topic-input').value.trim();
  const diff  = $('wbp-diff-select').value;
  if (!topic) { showToast('Enter a topic first', 'error'); return; }
  wbpTopic = topic;
  wbpCurrentQ = 0;

  $('wbp-setup').style.display = 'none';
  $('wbp-session').style.display = 'flex';
  $('wbp-tool-bar').style.display = 'flex';
  $('wbp-q-text').textContent = 'Generating questions…';
  initWbpCanvas();

  try {
    const langInst = getLangInstruction();
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
      body:JSON.stringify({
        model:MODELS.auto,
        messages:[
          { role:'system', content:`Generate 5 ${diff} practice questions on "${topic}" for a ${userProfile.class||'student'} student. ${langInst} Return ONLY a JSON array like: [{"q":"question text","hint":"brief hint","answer":"full step-by-step solution"}]. No extra text.` },
          { role:'user', content:`Generate questions now.` }
        ],
        max_tokens:1200
      })
    });
    const data = await resp.json();
    let raw = data.choices?.[0]?.message?.content || '[]';
    raw = raw.replace(/```json\n?|```/g,'').trim();
    wbpQuestions = JSON.parse(raw);
    showWbpQuestion();
  } catch { $('wbp-q-text').textContent = 'Failed to load questions. Try again.'; }
};

function showWbpQuestion() {
  const q = wbpQuestions[wbpCurrentQ];
  if (!q) return;
  $('wbp-q-num').textContent  = `Q${wbpCurrentQ+1}`;
  $('wbp-q-topic').textContent = wbpTopic;
  $('wbp-q-diff').textContent  = $('wbp-diff-select')?.value || 'Medium';
  $('wbp-q-text').textContent  = q.q;
  $('wbp-result-badge').style.display = 'none';
  $('wbp-explain-panel').classList.remove('open');
  $('wbp-check-btn').style.display = 'inline-flex';
  $('wbp-see-btn').style.display   = 'none';
  wbpClear();
}

window.wbpNextQuestion = function() {
  wbpCurrentQ = (wbpCurrentQ + 1) % wbpQuestions.length;
  showWbpQuestion();
};

window.wbpCheckAnswer = async function() {
  if (!wbpCanvas) return;
  const imgData = wbpCanvas.toDataURL('image/jpeg', 0.8);
  const q = wbpQuestions[wbpCurrentQ];
  $('wbp-check-btn').textContent = 'Checking…';

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
      body:JSON.stringify({
        model:MODELS.auto,
        messages:[
          { role:'system', content: buildSystemPrompt() + '\nYou are checking a student\'s handwritten answer. Be encouraging but accurate.' },
          { role:'user', content:[
            { type:'image_url', image_url:{ url:imgData } },
            { type:'text', text:`Question: ${q.q}\n\nIs the student's work on the whiteboard correct? Reply with CORRECT or WRONG followed by a brief explanation.` }
          ]}
        ],
        max_tokens:200
      })
    });
    const data = await resp.json();
    const ans = data.choices?.[0]?.message?.content || '';
    const isCorrect = /^correct/i.test(ans.trim());
    const badge = $('wbp-result-badge');
    badge.textContent = isCorrect ? '✅' : '❌';
    badge.style.display = 'block';
    flashWbp(isCorrect ? 'rgba(0,229,160,.3)' : 'rgba(255,79,106,.3)');
    $('wbp-see-btn').style.display = 'inline-flex';
  } catch {}

  $('wbp-check-btn').textContent = '✓ Check Answer';
};

window.wbpSeeAnswer = function() {
  const q = wbpQuestions[wbpCurrentQ];
  if (!q) return;
  $('wbp-explain-body').innerHTML = renderMarkdown(q.answer);
  $('wbp-explain-panel').classList.add('open');
  afterRender($('wbp-explain-body'));
};

window.wbpCloseExplain = function() { $('wbp-explain-panel').classList.remove('open'); };

function flashWbp(color) {
  const fl = $('wbp-flash');
  fl.style.background = color;
  fl.classList.add('flash');
  setTimeout(() => fl.classList.remove('flash'), 200);
}

/* ── IDE ─────────────────────────────────────────────── */
window.openIde = function(code, lang = 'python') {
  ideCurrentLang = lang;
  $('ide-textarea').value = code || '';
  $('ide-lang-badge').textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
  $('ide-lang-badge').className = `ide-lang-badge ${lang}`;
  $('ide-title-text').textContent = lang === 'python' ? 'Python Runner' : `${lang.toUpperCase()} Runner`;
  $('ide-overlay').classList.add('open');
  $('ide-output').textContent = 'Run your code to see output here…';
};

window.closeIde = function() { $('ide-overlay').classList.remove('open'); };

window.ideRun = function() {
  const code = $('ide-textarea').value;
  const lang = ideCurrentLang;
  $('ide-output').textContent = 'Running…';

  if (lang === 'javascript') {
    try {
      const logs = [];
      const consoleLog = (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
      const fn = new Function('console', code);
      fn({ log: consoleLog, error: consoleLog, warn: consoleLog, info: consoleLog });
      $('ide-output').textContent = logs.join('\n') || '(no output)';
    } catch (e) {
      $('ide-output').textContent = `Error: ${e.message}`;
      $('ide-output').style.color = 'var(--danger)';
    }
  } else if (lang === 'python') {
    $('ide-output').textContent = 'Python execution requires a backend.\nYou can copy this code and run it at:\nhttps://replit.com or https://colab.research.google.com';
  } else {
    $('ide-output').textContent = `${lang} execution is not supported in-browser.\nCopy and run in your local environment.`;
  }
};

window.ideClearOutput = function() {
  $('ide-output').textContent = '';
  $('ide-output').style.color = '';
  $('ide-ai-row').innerHTML = '';
};

window.ideAiExplain = async function() {
  const code = $('ide-textarea').value;
  const output = $('ide-output').textContent;
  if (!code) return;
  $('ide-ai-row').innerHTML = '<span style="color:var(--accent);font-family:\'DM Mono\',monospace;font-size:11px;">Analysing…</span>';
  const prompt = `Explain this ${ideCurrentLang} code and its output:\n\nCode:\n${code}\n\nOutput:\n${output}`;
  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
      body:JSON.stringify({ model:MODELS.flash, messages:[{role:'system',content:buildSystemPrompt()},{role:'user',content:prompt}], max_tokens:500 })
    });
    const data = await resp.json();
    const ans = data.choices?.[0]?.message?.content || '';
    $('ide-ai-row').innerHTML = `<div style="font-size:12px;color:var(--text2);line-height:1.6;">${renderMarkdown(ans)}</div>`;
    afterRender($('ide-ai-row'));
  } catch { $('ide-ai-row').innerHTML = '<span style="color:var(--danger);">Failed.</span>'; }
};

window.ideSendToChat = function() {
  const code = $('ide-textarea').value;
  closeIde();
  $('chat-input').value = `Here is my ${ideCurrentLang} code:\n\`\`\`${ideCurrentLang}\n${code}\n\`\`\`\n\nPlease explain it.`;
  $('chat-input').focus();
};

/* ── User Menu ──────────────────────────────────────── */
window.showUserMenu = function() {
  const avatar = $('sb-avatar');
  const menu = $('user-menu');
  const rect = avatar.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 8) + 'px';
  menu.style.left = Math.max(8, rect.left - 160) + 'px';
  menu.style.display = 'block';
  $('user-menu-overlay').style.display = 'block';
  // Fill profile info
  $('um-name').textContent  = userProfile.name || currentUser?.displayName || 'Student';
  $('um-email').textContent = currentUser?.email || '';
  $('um-avatar').src        = currentUser?.photoURL || '';
};

window.hideUserMenu = function() {
  $('user-menu').style.display = 'none';
  $('user-menu-overlay').style.display = 'none';
};

/* ── Settings Panel ─────────────────────────────────── */
window.openSettings = function() {
  $('settings-overlay').classList.add('open');
  // Populate fields
  $('settings-name-input').value     = userProfile.name || '';
  $('settings-user-name').textContent  = userProfile.name || 'Student';
  $('settings-user-email').textContent = currentUser?.email || '';
  const img = $('settings-avatar-img');
  if (currentUser?.photoURL) { img.src = currentUser.photoURL; img.style.display = 'block'; }
  else img.style.display = 'none';

  // Language
  const langSel = $('settings-lang-select');
  if (langSel) langSel.value = userProfile.lang || 'English';

  // Theme
  ['dark','light','system'].forEach(t => $(`theme-opt-${t}`)?.classList.toggle('active', (userProfile.theme||'dark') === t));

  // Subjects
  document.querySelectorAll('#settings-subjects-chips .settings-chip').forEach(chip => {
    chip.classList.toggle('active', (userProfile.subjects||[]).includes(chip.dataset.sub));
  });

  // School
  if (userProfile.school?.id) {
    $('settings-no-school').style.display  = 'none';
    $('settings-has-school').style.display = 'flex';
    $('settings-school-name-label').textContent = userProfile.school.name || 'Your School';
    $('settings-school-role-label').textContent = userProfile.school.role || 'Student';
    $('settings-school-code-label').textContent = userProfile.school.code || '';
  } else {
    $('settings-no-school').style.display  = 'flex';
    $('settings-has-school').style.display = 'none';
  }
};

window.closeSettings = function() { $('settings-overlay').classList.remove('open'); };

window.settingsSelectTheme = function(theme) {
  applyTheme(theme);
  ['dark','light','system'].forEach(t => $(`theme-opt-${t}`)?.classList.toggle('active', t === theme));
};

window.settingsToggleSubject = function(chip) { chip.classList.toggle('active'); };

window.settingsSave = async function() {
  const name = $('settings-name-input').value.trim();
  if (name) {
    userProfile.name = name;
    $('settings-user-name').textContent = name;
    try { await fb().updateProfile(currentUser, { displayName: name }); } catch {}
  }
  const langSel = $('settings-lang-select');
  if (langSel) userProfile.lang = langSel.value;

  userProfile.subjects = Array.from(document.querySelectorAll('#settings-subjects-chips .settings-chip.active'))
    .map(c => c.dataset.sub);

  await saveUserProfile();
  updateSidebarUser();
  $('settings-user-name').textContent = userProfile.name;
  showToast('Settings saved!', 'success');
};

window.settingsChangePic = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const dataUrl = ev.target.result;
    const img = $('settings-avatar-img');
    img.src = dataUrl; img.style.display = 'block';
    $('sb-avatar').src = dataUrl;
    try { await fb().updateProfile(currentUser, { photoURL: dataUrl }); } catch {}
    showToast('Photo updated!', 'success');
  };
  reader.readAsDataURL(file);
};

window.settingsJoinSchool = async function() {
  const code = $('settings-school-code-input').value.trim().toUpperCase();
  if (!code) return;
  const err = $('settings-school-error');
  err.style.display = 'none';
  try {
    const snap = await fb().getDocs(fb().collection(fb().db, 'schools'));
    let found = null;
    snap.forEach(d => { if (d.data().code === code) found = { id:d.id, ...d.data() }; });
    if (found) {
      userProfile.school = { id:found.id, name:found.name, code:found.code, role:'student' };
      await saveUserProfile();
      $('settings-no-school').style.display  = 'none';
      $('settings-has-school').style.display = 'flex';
      $('settings-school-name-label').textContent = found.name;
      $('settings-school-role-label').textContent = 'Student';
      $('settings-school-code-label').textContent = found.code;
      showToast(`Joined ${found.name}!`, 'success');
    } else {
      err.style.display = 'block';
      err.textContent   = 'School code not found.';
    }
  } catch { err.style.display = 'block'; err.textContent = 'Failed to join school.'; }
};

/* ── Upgrades & School Setup ────────────────────────── */
window.openUpgrades = function() { $('upgrades-overlay').classList.add('open'); };
window.closeUpgrades = function() { $('upgrades-overlay').classList.remove('open'); };

let schoolSetupRole = 'principal';
window.openSchoolSetup = function() {
  $('school-setup-overlay').classList.add('open');
  $('school-setup-step1').style.display = 'flex';
  $('school-setup-step2').style.display = 'none';
  $('school-setup-btn').textContent = 'Create School →';
  $('school-setup-error').style.display = 'none';
};
window.closeSchoolSetup = function() { $('school-setup-overlay').classList.remove('open'); };

window.schoolSetupSelectRole = function(role) {
  schoolSetupRole = role;
  $('school-role-principal').classList.toggle('selected', role === 'principal');
  $('school-role-teacher').classList.toggle('selected',   role === 'teacher');
};

window.schoolSetupNext = async function() {
  const step1 = $('school-setup-step1');
  if (step1.style.display !== 'none') {
    const name = $('school-setup-name').value.trim();
    if (!name) { $('school-setup-error').style.display='block'; $('school-setup-error').textContent='Enter school name'; return; }
    const code = 'SEDY-' + Math.random().toString(36).slice(2,6).toUpperCase();
    try {
      const docRef = fb().doc(fb().collection(fb().db, 'schools'));
      await fb().setDoc(docRef, {
        name, code, role: schoolSetupRole,
        ownerId: currentUser.uid,
        createdAt: fb().serverTimestamp()
      });
      userProfile.school = { id: docRef.id, name, code, role: schoolSetupRole };
      await saveUserProfile();
      $('school-setup-code-name').textContent = name;
      $('school-setup-code-value').textContent = code;
      step1.style.display = 'none';
      $('school-setup-step2').style.display = 'flex';
      $('school-setup-btn').textContent = 'Done ✓';
    } catch { $('school-setup-error').style.display='block'; $('school-setup-error').textContent='Failed to create school. Try again.'; }
  } else {
    closeSchoolSetup();
    closeUpgrades();
    openSettings();
  }
};

window.schoolCopyCode = function() {
  const code = $('school-setup-code-value').textContent;
  copyText(code);
  $('school-copy-btn').textContent = '✓ Copied!';
  $('school-copy-btn').classList.add('copied');
  setTimeout(() => { $('school-copy-btn').textContent = '📋 Copy Code'; $('school-copy-btn').classList.remove('copied'); }, 2000);
};

window.openClassroom = function() {
  showToast('Classroom feature coming soon!', 'info');
};

/* ── Auto-save logic in renderMarkdown ──────────────── */
/* (handled inline above in renderMarkdown special blocks) */

/* ── Keyboard Shortcuts ─────────────────────────────── */
document.addEventListener('keydown', e => {
  // Escape closes overlays
  if (e.key === 'Escape') {
    if ($('wb-overlay').classList.contains('open'))    { closeWhiteboard(); return; }
    if ($('scope-overlay').classList.contains('open')) { closeScope(); return; }
    if ($('ide-overlay').classList.contains('open'))   { closeIde(); return; }
    if ($('voice-overlay').style.display === 'flex')   { closeVoiceChat(); return; }
    if ($('files-panel').classList.contains('open'))   { closeFilesPanel(); return; }
    if ($('settings-overlay').classList.contains('open')) { closeSettings(); return; }
    if ($('upgrades-overlay').classList.contains('open')) { closeUpgrades(); return; }
    closeSidebar();
  }
  // Ctrl+N = new chat
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); createNewChat(); }
  // Ctrl+/ = focus input
  if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); $('chat-input')?.focus(); }
});

/* ── Responsive: adjust on resize ──────────────────── */
window.addEventListener('resize', () => {
  if (wbCanvas && $('wb-overlay').classList.contains('open')) {
    // Preserve drawing by saving + restoring
    const dataUrl = wbCanvas.toDataURL();
    const wrap = $('wb-canvas-wrap');
    wbCanvas.width  = wrap.offsetWidth;
    wbCanvas.height = wrap.offsetHeight;
    const img = new Image();
    img.onload = () => { wbCtx.drawImage(img,0,0); };
    img.src = dataUrl;
  }
});

/* ── Init ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Session loader is hidden by auth state listener
  // Set up voice overlay display
  $('voice-overlay').style.display = 'none';
  // Ensure overlays start closed
  ['wb-overlay','ide-overlay','scope-overlay'].forEach(id => {
    $('id') && $('id').classList.remove('open');
  });
});
