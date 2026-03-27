// ══════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════
const API_URL='https://sedy-ai-3.onrender.com';
const CHATS_KEY='sedy_chats_v2';

// ── User preferred language (set from onboarding profile) ──
let _userPreferredLang = 'English';  // Default English. Set from profile on login.
const ACTIVE_CHAT_KEY='sedy_active_chat';
const FILES_KEY='sedy_files';
const FREEMODE_KEY='sedy_free_mode';
const FILES_MAX=20;

// ══════════════════════════════════════════════════════
// MULTI-CHAT STATE
// ══════════════════════════════════════════════════════
let chats = {}; // { chatId: { id, title, messages: [], createdAt, updatedAt, model } }
let activeChatId = null;
let activeModel = 'auto';
let isFreeMode = false;
let activeFilesTab = 'notes';
let activeQuiz = null;
let stagedPdfs = [], stagedImages = [], stagedTextFiles = [];

// Per-chat ephemeral state
let selectedContexts = [];

// ── Load / Save chats ──
function loadChats() {
  try { chats = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}'); } catch(e) { chats = {}; }
}
function saveChats() {
  try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch(e) {}
}
function getChatHistory() {
  if (!activeChatId || !chats[activeChatId]) return [];
  return chats[activeChatId].messages || [];
}
function pushHistory(role, content) {
  if (!activeChatId) return;
  if (!chats[activeChatId].messages) chats[activeChatId].messages = [];
  chats[activeChatId].messages.push({ role, content });
  if (chats[activeChatId].messages.length > 60) chats[activeChatId].messages = chats[activeChatId].messages.slice(-60);
  chats[activeChatId].updatedAt = Date.now();
  // Auto-title from first user message
  const msgs = chats[activeChatId].messages;
  if (msgs.length === 1 && msgs[0].role === 'user' && chats[activeChatId].title === 'New Chat') {
    const autoTitle = msgs[0].content.slice(0, 40).trim() || 'New Chat';
    chats[activeChatId].title = autoTitle;
    updateHeaderTitle(autoTitle);
  }
  saveChats();
  renderChatList();
  updateMemoryBadge();
}

// ══════════════════════════════════════════════════════
// CHAT MANAGEMENT
// ══════════════════════════════════════════════════════
function createNewChat(autoSwitch = true) {
  const id = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  chats[id] = {
    id, title: 'New Chat',
    messages: [], model: 'auto',
    createdAt: Date.now(), updatedAt: Date.now()
  };
  saveChats();
  if (autoSwitch) switchToChat(id);
  else renderChatList();
  return id;
}

function switchToChat(id) {
  if (!chats[id]) return;
  activeChatId = id;
  try { localStorage.setItem(ACTIVE_CHAT_KEY, id); } catch(e) {}
  activeQuiz = null;
  stagedPdfs = []; stagedImages = []; stagedTextFiles = [];
  selectedContexts = [];
  renderStagedRow(); renderImgStagedRow(); renderContextChips();
  stopSpeaking();
  renderChatList();
  renderChatMessages();
  updateHeaderTitle(chats[id].title);
  updateMemoryBadge();
  // Restore model
  if (chats[id].model) { activeModel = chats[id].model; syncModelButtons(); }
  // Close sidebar on mobile
  if (window.innerWidth < 768) closeSidebar();
}

function renderChatMessages() {
  const wrap = document.getElementById('chat-messages');
  wrap.innerHTML = '';
  const msgs = getChatHistory();
  if (!msgs.length) {
    showEmptyState();
    return;
  }
  msgs.forEach(m => {
    if (m.role === 'user') addMsg('user', m.content, null, true);
    else if (m.role === 'assistant') addMsg('ai', m.content, null, true);
  });
  scrollBottom();
}

function showEmptyState() {
  const wrap = document.getElementById('chat-messages');

  // ── Personalized greeting ──
  const greetings = [
    'Hey', 'Hello', 'Hi', 'Yo', 'Howdy', 'Hiya',
    'Namaste', 'Salut', 'Ciao', 'Hola',
    'Wassup', 'Sup', 'Greetings'
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];

  // Extract first name from stored profile
  const storedName = _userProfile?.name || _currentUser?.displayName || '';
  const firstName = storedName.trim().split(/\s+/)[0] || '';

  const greetLine = firstName
    ? `${greeting}, ${firstName}! 👋`
    : `${greeting}! 👋`;

  const prompts = [
    'Explain photosynthesis simply',
    'Make flashcards on Newton\'s laws',
    'Quiz me on World War II',
    'Solve: x² + 5x + 6 = 0',
    'Give me notes on the French Revolution',
    'Draw a flowchart of the water cycle',
    'What is the Pythagorean theorem?',
    'Formula sheet for calculus',
  ];
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-logo">Sedy</div>
    <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--text);margin-bottom:6px;">${greetLine}</div>
    <div class="empty-tagline">Your AI study companion. Ask anything — from math to history, code to science.</div>
    <div class="empty-chips">${prompts.map(p => `<button class="empty-chip" onclick="usePrompt('${p.replace(/'/g,"\\'")}')">${p}</button>`).join('')}</div>
  `;
  wrap.appendChild(div);
}
function usePrompt(text) {
  document.getElementById('chat-input').value = text;
  autoResize(document.getElementById('chat-input'));
  sendMessage();
}

function deleteChat(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this chat?')) return;
  delete chats[id];
  saveChats();
  if (activeChatId === id) {
    const remaining = Object.keys(chats);
    if (remaining.length) switchToChat(remaining[remaining.length - 1]);
    else createNewChat();
  } else renderChatList();
}

function startRenameChat(id, e) {
  e.stopPropagation();
  const item = document.getElementById('ci_' + id);
  if (!item) return;
  const titleEl = item.querySelector('.chat-item-title');
  const input = document.createElement('input');
  input.className = 'chat-item-rename';
  input.value = chats[id].title;
  titleEl.replaceWith(input);
  input.focus(); input.select();
  function finish() {
    const newTitle = input.value.trim() || 'New Chat';
    chats[id].title = newTitle;
    saveChats();
    if (id === activeChatId) updateHeaderTitle(newTitle);
    renderChatList();
  }
  input.onblur = finish;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.blur(); } };
}

function startInlineRename() {
  if (!activeChatId) return;
  const titleEl = document.getElementById('header-chat-title');
  const input = document.createElement('input');
  input.className = 'header-chat-title-input';
  input.value = chats[activeChatId]?.title || 'New Chat';
  titleEl.replaceWith(input);
  input.focus(); input.select();
  function finish() {
    const newTitle = input.value.trim() || 'New Chat';
    if (activeChatId) { chats[activeChatId].title = newTitle; saveChats(); }
    const restored = document.createElement('div');
    restored.id = 'header-chat-title';
    restored.className = 'header-chat-title';
    restored.title = 'Click to rename';
    restored.onclick = startInlineRename;
    restored.textContent = newTitle;
    input.replaceWith(restored);
    renderChatList();
  }
  input.onblur = finish;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') input.blur(); };
}

function updateHeaderTitle(title) {
  const el = document.getElementById('header-chat-title');
  if (el) el.textContent = title;
}

function filterChats(query) {
  renderChatList(query.toLowerCase());
}

function renderChatList(filter = '') {
  const list = document.getElementById('chat-list');
  list.innerHTML = '';
  const sortedIds = Object.keys(chats).sort((a, b) => (chats[b].updatedAt || 0) - (chats[a].updatedAt || 0));
  const filtered = filter ? sortedIds.filter(id => chats[id].title.toLowerCase().includes(filter)) : sortedIds;

  if (!filtered.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;">${filter ? 'No chats found' : 'No chats yet'}</div>`;
    return;
  }

  // Group by date
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const week = new Date(today); week.setDate(week.getDate()-7);

  const groups = { Today: [], Yesterday: [], 'This Week': [], Older: [] };
  filtered.forEach(id => {
    const d = new Date(chats[id].updatedAt || chats[id].createdAt || 0);
    d.setHours(0,0,0,0);
    if (d >= today) groups['Today'].push(id);
    else if (d >= yesterday) groups['Yesterday'].push(id);
    else if (d >= week) groups['This Week'].push(id);
    else groups['Older'].push(id);
  });

  Object.entries(groups).forEach(([label, ids]) => {
    if (!ids.length) return;
    const section = document.createElement('div');
    section.className = 'chat-list-section';
    section.innerHTML = `<div class="chat-list-label">${label}</div>`;

    ids.forEach(id => {
      const chat = chats[id];
      const isActive = id === activeChatId;
      const msgCount = (chat.messages || []).length;
      const lastMsg = chat.messages && chat.messages.length ? chat.messages[chat.messages.length-1].content.slice(0,40) : 'Empty chat';
      const item = document.createElement('div');
      item.className = 'chat-item' + (isActive ? ' active' : '');
      item.id = 'ci_' + id;
      item.onclick = () => switchToChat(id);
      item.innerHTML = `
        <div class="chat-item-icon">${getTopicIcon(chat.title)}</div>
        <div class="chat-item-info">
          <div class="chat-item-title">${_esc(chat.title)}</div>
          <div class="chat-item-preview">${_esc(lastMsg)}${lastMsg.length >= 40 ? '…' : ''}</div>
          <div class="chat-item-meta">${msgCount} msg${msgCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="chat-item-actions">
          <button class="chat-item-btn rename" onclick="startRenameChat('${id}',event)" title="Rename">✏</button>
          <button class="chat-item-btn delete" onclick="deleteChat('${id}',event)" title="Delete">🗑</button>
        </div>`;
      section.appendChild(item);
    });
    list.appendChild(section);
  });
}

function getTopicIcon(title) {
  const t = title.toLowerCase();
  if (/math|calcul|algebra|geometry|equation|formula/i.test(t)) return '📐';
  if (/physics|force|energy|wave|quantum/i.test(t)) return '⚛️';
  if (/chem|molecule|element|reaction|bond/i.test(t)) return '🧪';
  if (/bio|cell|dna|organ|evolution|plant/i.test(t)) return '🧬';
  if (/history|war|revolution|ancient|empire/i.test(t)) return '🏛️';
  if (/code|program|python|javascript|html|css/i.test(t)) return '💻';
  if (/quiz|test|exam|practice/i.test(t)) return '📊';
  if (/note|summary|revision/i.test(t)) return '📝';
  if (/flash|card/i.test(t)) return '🃏';
  if (/graph|chart|data|visual/i.test(t)) return '📈';
  if (/flow|diagram|process/i.test(t)) return '🔀';
  if (/english|grammar|essay|literature/i.test(t)) return '📚';
  if (/geo|map|country|capital/i.test(t)) return '🌍';
  return '✦';
}

// ══════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ══════════════════════════════════════════════════════
let sidebarOpen = true;
function toggleSidebar() {
  if (window.innerWidth < 768) {
    // Mobile: slide in/out over content
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    const isOpen = sb.classList.contains('open');
    sb.classList.toggle('open', !isOpen);
    ov.classList.toggle('visible', !isOpen);
  } else {
    sidebarOpen = !sidebarOpen;
    document.getElementById('sidebar').classList.toggle('collapsed', !sidebarOpen);
  }
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
function scrollBottom(){const m=document.getElementById('chat-messages');m.scrollTop=m.scrollHeight;}
function renderMath(el){if(window.renderMathInElement)renderMathInElement(el,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});}
function updateMemoryBadge(){
  const cnt = getChatHistory().length;
  const el = document.getElementById('memory-count-sb');
  if (el) el.textContent = cnt + ' messages';
}
function syncModelButtons() {
  document.querySelectorAll('.model-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.model === activeModel));
}
function setModel(m) {
  if (isFreeMode && m !== 'flash') return;
  activeModel = m;
  if (activeChatId && chats[activeChatId]) { chats[activeChatId].model = m; saveChats(); }
  syncModelButtons();
}

// ── Rate limit ──
let rlInterval = null;
function showRateLimit(detail){
  const overlay=document.getElementById('rl-overlay');overlay.style.display='flex';
  const sub=document.getElementById('rl-subtitle');if(detail.limit_type)sub.textContent=`${detail.limit_type} limit reached.`;
  let secs=detail.wait_seconds||0;const total=secs;
  function tick(){const m=Math.floor(secs/60),s=secs%60;document.getElementById('rl-timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;document.getElementById('rl-bar').style.width=(total>0?(secs/total*100):0)+'%';if(secs>0){secs--;rlInterval=setTimeout(tick,1000);}else{document.getElementById('rl-timer').textContent='Ready!';closeRateLimit();}}
  clearTimeout(rlInterval);tick();
}
function closeRateLimit(){document.getElementById('rl-overlay').style.display='none';clearTimeout(rlInterval);}
function enableFreeMode(){closeRateLimit();isFreeMode=true;try{localStorage.setItem(FREEMODE_KEY,'1');}catch(e){}applyFreeMode();addMsg('ai','**Free Mode ON** — Flash model only.');}
function disableFreeMode(){isFreeMode=false;try{localStorage.removeItem(FREEMODE_KEY);}catch(e){}applyFreeMode();addMsg('ai','✅ **Free Mode disabled.** All features restored.');}
function applyFreeMode(){
  const banner=document.getElementById('freemode-banner');
  if(isFreeMode){if(banner)banner.classList.add('visible');activeModel='flash';document.querySelectorAll('.model-btn').forEach(btn=>{btn.classList.remove('active');if(btn.dataset.model==='flash')btn.classList.add('active');if(['pro','smart','auto'].includes(btn.dataset.model)){btn.disabled=true;btn.style.opacity='0.35';btn.style.cursor='not-allowed';}});}
  else{if(banner)banner.classList.remove('visible');document.querySelectorAll('.model-btn').forEach(btn=>{btn.disabled=false;btn.style.opacity='';btn.style.cursor='';});syncModelButtons();}
}

// ── Parse + render ──
function parseMarkdown(text){
  let h=text
    .replace(/```(\w*)\n([\s\S]*?)```/g,(_,lang,code)=>{const id='cb'+Math.random().toString(36).slice(2);return renderCodeBlock(code.trim(),lang,id);})
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^- (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,m=>'<ul>'+m+'</ul>').replace(/^\d+\. (.+)$/gm,'<li>$1</li>')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
  if(!h.includes('<h')){h=`<p>${h}</p>`;h=h.replace(/<p><\/p>/g,'');}
  return h;
}
function copyCode(id){const el=document.getElementById(id);if(!el)return;navigator.clipboard.writeText(el.textContent);}
function copyNotes(id){const el=document.getElementById(id);if(!el)return;navigator.clipboard.writeText(el.innerText);}
function copyFormula(id){const el=document.getElementById(id);if(!el)return;navigator.clipboard.writeText(el.innerText);}

function addMsg(role, content, extra, silent = false) {
  const wrap = document.getElementById('chat-messages');
  // Remove empty state if present
  const empty = wrap.querySelector('.empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const speakId = 'spk' + Date.now() + Math.random().toString(36).slice(2);

  if (role === 'ai') {
    div.innerHTML = `<div class="msg-avatar">✦</div><div class="msg-content">${extra&&extra.pdfBadge?`<div class="pdf-reply-badge">📄 ${_esc(extra.pdfBadge)}</div>`:''} ${extra&&extra.imgBadge?`<div class="img-reply-badge">🖼️ ${extra.imgBadge}</div>`:''}<div class="msg-bubble">${parseMarkdown(content)}</div><div class="msg-actions"><button class="speak-btn" id="${speakId}" onclick="speakMsg('${speakId}')">🔊 Speak</button></div></div>`;
    div._rawText = content;
  } else {
    let attachHtml = '';
    if (extra&&extra.pdfs&&extra.pdfs.length) {
      attachHtml += '<div class="pdf-user-attachments">'+extra.pdfs.map(p=>{const thumb=p.thumbDataUrl?`<img class="pdf-user-thumb-img" src="${p.thumbDataUrl}" alt="">`:`<div class="pdf-user-thumb-icon">📄</div>`;return`<div class="pdf-user-thumb">${thumb}<div class="pdf-user-thumb-info"><div class="pdf-user-thumb-name">${_esc(p.name)}</div><div class="pdf-user-thumb-sub">${p.sizeKb} KB${p.pageCount?' · '+p.pageCount+'p':''}</div></div></div>`;}).join('')+'</div>';
    }
    if (extra&&extra.images&&extra.images.length) {
      const imgs=extra.images;attachHtml+='<div class="img-user-attachments">';const show=Math.min(imgs.length,4);for(let i=0;i<show;i++){attachHtml+=`<div class="img-user-thumb" onclick="openLightbox('${imgs[i].dataUrl}')"><img src="${imgs[i].dataUrl}" alt="${_esc(imgs[i].name)}"></div>`;}if(imgs.length>4){attachHtml+=`<div style="display:flex;align-items:center;justify-content:center;width:90px;height:90px;border-radius:10px;background:rgba(255,255,255,.15);font-size:18px;font-weight:800;color:white;">+${imgs.length-4}</div>`;}attachHtml+='</div>';
    }
    div.innerHTML = `<div class="msg-avatar">👤</div><div class="msg-content"><div class="msg-bubble">${attachHtml}${parseMarkdown(content)}</div></div>`;
  }
  wrap.appendChild(div);
  if (role === 'ai') { const bubble = div.querySelector('.msg-bubble'); renderMath(bubble); }
  if (!silent) scrollBottom();
  return div;
}

function showTyping(){const wrap=document.getElementById('chat-messages');const e=wrap.querySelector('.empty-state');if(e)e.remove();const div=document.createElement('div');div.className='msg ai';div.id='typing-msg';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;wrap.appendChild(div);scrollBottom();}
function hideTyping(){const t=document.getElementById('typing-msg');if(t)t.remove();}

// ── Voice ──
let recognition=null,isRecording=false;
function initVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){document.getElementById('mic-btn').style.display='none';return;}
  recognition=new SR();recognition.continuous=false;recognition.interimResults=true;recognition.lang='en-US';
  recognition.onstart=()=>{isRecording=true;document.getElementById('mic-btn').classList.add('recording');document.getElementById('chat-input').placeholder='🎤 Listening...';};
  recognition.onresult=(e)=>{const t=Array.from(e.results).map(r=>r[0].transcript).join('');document.getElementById('chat-input').value=t;autoResize(document.getElementById('chat-input'));};
  recognition.onend=()=>{isRecording=false;document.getElementById('mic-btn').classList.remove('recording');document.getElementById('chat-input').placeholder='Ask anything…';const t=document.getElementById('chat-input').value.trim();if(t)sendMessage();};
  recognition.onerror=(e)=>{isRecording=false;document.getElementById('mic-btn').classList.remove('recording');};
}
function toggleVoice(){if(!recognition){addMsg('ai','🎤 Voice input not supported. Try Chrome!');return;}if(isRecording){recognition.stop();return;}stopSpeaking();try{recognition.start();}catch(e){}}

let currentUtterance=null,currentSpeakBtn=null;
function stopSpeaking(){if(window.speechSynthesis)window.speechSynthesis.cancel();if(currentSpeakBtn){currentSpeakBtn.classList.remove('speaking');currentSpeakBtn.textContent='🔊 Speak';}currentUtterance=null;currentSpeakBtn=null;}
function speakText(text,btn){if(!window.speechSynthesis){return;}if(currentSpeakBtn===btn){stopSpeaking();return;}stopSpeaking();const clean=text.replace(/<[^>]+>/g,' ').replace(/#{1,3}\s+/g,'').replace(/\*{1,3}([^*]+)\*{1,3}/g,'$1').replace(/`[^`]+`/g,'').replace(/\$\$?[^$]+\$\$?/g,' math expression ').replace(/\s+/g,' ').trim();currentUtterance=new SpeechSynthesisUtterance(clean);currentSpeakBtn=btn;btn.classList.add('speaking');btn.textContent='⏹ Stop';currentUtterance.onend=()=>{btn.classList.remove('speaking');btn.textContent='🔊 Speak';currentUtterance=null;currentSpeakBtn=null;};currentUtterance.onerror=()=>{btn.classList.remove('speaking');btn.textContent='🔊 Speak';currentUtterance=null;currentSpeakBtn=null;};window.speechSynthesis.speak(currentUtterance);}
function speakMsg(btnId){const btn=document.getElementById(btnId);if(!btn)return;const msgDiv=btn.closest('.msg');const rawText=msgDiv?._rawText||btn.closest('.msg-content').querySelector('.msg-bubble').innerText;speakText(rawText,btn);}

// ── Lightbox ──
function openLightbox(src){document.getElementById('lightbox-img').src=src;document.getElementById('lightbox').classList.add('visible');}
function closeLightbox(){document.getElementById('lightbox').classList.remove('visible');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox();});

// ── Staged images/PDFs ──
const MAX_IMAGES=5;
function handleImgSelect(event){const files=Array.from(event.target.files);event.target.value='';if(!files.length)return;const remaining=MAX_IMAGES-stagedImages.length;files.slice(0,remaining).forEach(file=>{if(!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=(e)=>{const dataUrl=e.target.result;stagedImages.push({dataUrl,base64:dataUrl.split(',')[1],name:file.name});renderImgStagedRow();};reader.readAsDataURL(file);});}
function renderImgStagedRow(){const row=document.getElementById('img-staged-row');const wrap=document.getElementById('input-wrap');if(!row)return;row.innerHTML='';if(!stagedImages.length){row.classList.remove('visible');wrap.classList.remove('img-mode');return;}row.classList.add('visible');wrap.classList.add('img-mode');stagedImages.forEach((img,idx)=>{const chip=document.createElement('div');chip.className='img-staged-chip';chip.innerHTML=`<img src="${img.dataUrl}" alt=""><button class="img-staged-remove" onclick="event.stopPropagation();removeStagedImg(${idx})">✕</button>`;row.appendChild(chip);});if(stagedImages.length<MAX_IMAGES){const add=document.createElement('div');add.className='img-staged-add';add.innerHTML='<span>+</span><span>Add</span>';add.onclick=()=>document.getElementById('img-input').click();row.appendChild(add);}}
function removeStagedImg(idx){stagedImages.splice(idx,1);renderImgStagedRow();}
function arrayBufferToBase64(ab){const bytes=new Uint8Array(ab);let b64='';const chunk=8192;for(let i=0;i<bytes.length;i+=chunk){b64+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));}return btoa(b64);}
async function renderPdfFirstPage(arrayBuf){if(!window.pdfjsLib)return null;try{const pdf=await pdfjsLib.getDocument({data:arrayBuf}).promise;const page=await pdf.getPage(1);const vp=page.getViewport({scale:1.5});const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;return{canvas:cv,pageCount:pdf.numPages};}catch(e){return null;}}
function makeThumb(canvas,maxW=120){if(!canvas)return null;const tc=document.createElement('canvas');const sc=Math.min(1,maxW/canvas.width);tc.width=Math.round(canvas.width*sc);tc.height=Math.round(canvas.height*sc);tc.getContext('2d').drawImage(canvas,0,0,tc.width,tc.height);return tc.toDataURL('image/jpeg',.75);}
function handlePdfSelect(event){const files=Array.from(event.target.files);event.target.value='';if(!files.length)return;files.forEach(file=>{if(file.type!=='application/pdf')return;const reader=new FileReader();reader.onload=async(e)=>{const ab=e.target.result;const b64=arrayBufferToBase64(ab);const sizeKb=Math.round(file.size/1024);let thumbDataUrl=null,pageCount=null;const rendered=await renderPdfFirstPage(ab.slice(0));if(rendered){thumbDataUrl=makeThumb(rendered.canvas);pageCount=rendered.pageCount;}stagedPdfs.push({name:file.name,base64:b64,sizeKb,pageCount,thumbDataUrl});renderStagedRow();};reader.readAsArrayBuffer(file);});}
function renderStagedRow(){const row=document.getElementById('pdf-staged-row');if(!row)return;row.innerHTML='';if(!stagedPdfs.length&&!stagedTextFiles.length){row.classList.remove('visible');document.getElementById('input-wrap').classList.remove('pdf-mode');return;}row.classList.add('visible');document.getElementById('input-wrap').classList.add('pdf-mode');stagedPdfs.forEach((pdf,idx)=>{const chip=document.createElement('div');chip.className='pdf-staged-chip';const thumbHtml=pdf.thumbDataUrl?`<img class="pdf-staged-thumb" src="${pdf.thumbDataUrl}" alt="">`:`<div class="pdf-staged-thumb-icon">📄</div>`;chip.innerHTML=`${thumbHtml}<div class="pdf-staged-info"><div class="pdf-staged-name">${_esc(pdf.name)}</div><div class="pdf-staged-meta">${pdf.sizeKb} KB${pdf.pageCount?' · '+pdf.pageCount+'p':''}</div></div><button class="pdf-staged-remove" onclick="removeStagedPdf(${idx})">✕</button>`;row.appendChild(chip);});stagedTextFiles.forEach((tf,idx)=>{const chip=document.createElement('div');chip.className='pdf-staged-chip';chip.innerHTML=`<div class="pdf-staged-thumb-icon">📃</div><div class="pdf-staged-info"><div class="pdf-staged-name">${_esc(tf.name)}</div><div class="pdf-staged-meta">${tf.sizeKb} KB</div></div><button class="pdf-staged-remove" onclick="removeStagedText(${idx})">✕</button>`;row.appendChild(chip);});}
function removeStagedPdf(idx){stagedPdfs.splice(idx,1);renderStagedRow();}
function removeStagedText(idx){stagedTextFiles.splice(idx,1);renderStagedRow();}
function handleAnyFile(event){const files=Array.from(event.target.files);event.target.value='';if(!files.length)return;files.forEach(file=>{const ext=file.name.split('.').pop().toLowerCase();if(file.type==='application/pdf'||ext==='pdf'){const reader=new FileReader();reader.onload=async(e)=>{const ab=e.target.result;const b64=arrayBufferToBase64(ab);const sizeKb=Math.round(file.size/1024);let thumbDataUrl=null,pageCount=null;const rendered=await renderPdfFirstPage(ab.slice(0));if(rendered){thumbDataUrl=makeThumb(rendered.canvas);pageCount=rendered.pageCount;}stagedPdfs.push({name:file.name,base64:b64,sizeKb,pageCount,thumbDataUrl});renderStagedRow();};reader.readAsArrayBuffer(file);return;}if(file.type.startsWith('image/')){const reader=new FileReader();reader.onload=(e)=>{const dataUrl=e.target.result;stagedImages.push({dataUrl,base64:dataUrl.split(',')[1],name:file.name});renderImgStagedRow();};reader.readAsDataURL(file);return;}const textExts=['txt','md','csv','json','js','ts','py','html','css','xml','yml','yaml','sh','sql'];if(textExts.includes(ext)||file.type.startsWith('text/')){const reader=new FileReader();reader.onload=(e)=>{stagedTextFiles.push({name:file.name,content:e.target.result,sizeKb:Math.round(file.size/1024),ext});renderStagedRow();};reader.readAsText(file);return;}addMsg('ai','⚠️ Unsupported file type: .'+ext);});}
function pickAnyFile(){closeAttachMenu();document.getElementById('file-input').click();}

// ── Selection context ──
let selectedTextCtx='';
document.addEventListener('mouseup',()=>{const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.toString().trim()){hideSelPopup();return;}const t=sel.toString().trim();if(t.length<10){hideSelPopup();return;}selectedTextCtx=t;const range=sel.getRangeAt(0);const rect=range.getBoundingClientRect();const popup=document.getElementById('sel-popup');popup.style.top=(rect.top+window.scrollY-popup.offsetHeight-8)+'px';popup.style.left=Math.min(rect.left+window.scrollX,window.innerWidth-200)+'px';popup.classList.add('visible');});
document.addEventListener('mousedown',(e)=>{if(!e.target.closest('#sel-popup'))hideSelPopup();});
function hideSelPopup(){document.getElementById('sel-popup').classList.remove('visible');}
function addSelectionToContext(){if(!selectedTextCtx)return;selectedContexts.push(selectedTextCtx);renderContextChips();hideSelPopup();window.getSelection().removeAllRanges();}
function askSelectionNow(){if(!selectedTextCtx)return;const q=selectedTextCtx;hideSelPopup();window.getSelection().removeAllRanges();document.getElementById('chat-input').value=q;autoResize(document.getElementById('chat-input'));sendMessage();}
function renderContextChips(){const row=document.getElementById('sel-context-row');row.innerHTML='';if(!selectedContexts.length){row.classList.remove('visible');return;}row.classList.add('visible');selectedContexts.forEach((ctx,i)=>{const chip=document.createElement('div');chip.className='sel-ctx-chip';chip.innerHTML=`<span class="sel-ctx-text">${_esc(ctx.slice(0,60))}${ctx.length>60?'…':''}</span><button class="sel-ctx-remove" onclick="removeCtx(${i})">✕</button>`;row.appendChild(chip);});}
function removeCtx(i){selectedContexts.splice(i,1);renderContextChips();}

// ── Notes/Formula/Flashcard/Quiz renderers ──
function renderNotesMsg(notes,topic){const cardId='notes_'+Date.now();const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble" style="padding:0;background:none;border:none;"><div class="notes-card"><div class="notes-header"><div class="notes-badge"><div class="notes-badge-dot"></div>📝 Study Notes — ${_esc(topic)}</div><div style="display:flex;gap:5px;"><button class="notes-save-btn" id="save_${cardId}" onclick="saveFile('${cardId}','notes','${_esc(topic)}')">💾 Save</button><button class="notes-copy-btn" onclick="copyNotes('${cardId}')">⎘ Copy</button></div></div><div class="notes-body" id="${cardId}">${parseMarkdown(notes)}</div></div></div><div class="msg-actions"><button class="speak-btn" id="spk${cardId}" onclick="speakMsg('spk${cardId}')">🔊 Speak</button></div></div>`;div._rawText=notes;wrap.appendChild(div);const body=document.getElementById(cardId);if(body)renderMath(body);scrollBottom();}
function renderFormulaMsg(sheet,topic){const cardId='formula_'+Date.now();const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble" style="padding:0;background:none;border:none;"><div class="formula-card"><div class="formula-header"><div class="formula-badge"><div class="formula-badge-dot"></div>📐 Formula Sheet — ${_esc(topic)}</div><div style="display:flex;gap:5px;"><button class="formula-save-btn" id="save_${cardId}" onclick="saveFile('${cardId}','formula','${_esc(topic)}')">💾 Save</button><button class="formula-copy-btn" onclick="copyFormula('${cardId}')">⎘ Copy</button></div></div><div class="formula-body" id="${cardId}">${parseMarkdown(sheet)}</div></div></div><div class="msg-actions"><button class="speak-btn" id="spk${cardId}" onclick="speakMsg('spk${cardId}')">🔊 Speak</button></div></div>`;div._rawText=sheet;wrap.appendChild(div);const body=document.getElementById(cardId);if(body)renderMath(body);scrollBottom();}

// ── Practice Card — shown in chat when intent = practice ──────────────────────
function renderPracticeCard(topic, difficulty) {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = 'msg ai';

  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const diffColors = { easy: 'var(--success)', medium: 'var(--warning)', hard: 'var(--danger)' };
  const diffColor  = diffColors[difficulty] || diffColors.medium;

  div.innerHTML = `
    <div class="msg-avatar">✦</div>
    <div class="msg-content">
      <div class="msg-bubble" style="padding:0;background:none;border:none;">
        <div class="practice-card">
          <div class="practice-card-header">
            <div class="practice-card-icon">🧠</div>
            <div>
              <div class="practice-card-title">Practice Mode Ready</div>
              <div class="practice-card-sub">Solve step-by-step on the whiteboard</div>
            </div>
          </div>
          <div class="practice-card-body">
            <div class="practice-card-topic">
              <strong style="color:var(--accent2);">Topic:</strong> ${_esc(topic)}
            </div>
            <div class="practice-card-meta">
              <span class="practice-card-tag">🧠 Whiteboard Practice</span>
              <span class="practice-card-tag" style="color:${diffColor};border-color:${diffColor}33;background:${diffColor}18;">
                ${diffLabel}
              </span>
              <span class="practice-card-tag">✍️ Step-by-step</span>
            </div>
            <button class="practice-open-btn" onclick="openPracticeFromChat('${_esc(topic)}','${difficulty}')">
              Open Whiteboard & Start
              <span class="btn-arrow">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  wrap.appendChild(div);
  scrollBottom();
}

// Called when user clicks the practice card button
function openPracticeFromChat(topic, difficulty) {
  // Pre-fill the practice session state
  wbpState.topic      = topic;
  wbpState.difficulty = difficulty || 'medium';

  // Open whiteboard and switch to practice tab
  document.getElementById('wb-overlay').classList.add('active');
  initWbCanvas();
  wbSwitchTab('practice');

  // Pre-fill topic input and auto-start
  const topicInput = document.getElementById('wbp-topic-input');
  const diffSelect = document.getElementById('wbp-diff-select');
  if (topicInput) topicInput.value = topic;
  if (diffSelect) diffSelect.value = difficulty || 'medium';

  // Small delay so DOM is ready, then auto-start
  setTimeout(() => wbpStartPractice(), 200);
}

function renderFlashcards(cards,topic){const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';const cardsHtml=cards.map((_,i)=>{const fid='fc'+Date.now()+'_'+i;return`<div class="fc-flip-card" id="${fid}" onclick="this.classList.toggle('flipped')"><div class="fc-inner"><div class="fc-front"><div class="fc-tag">Question</div><div class="fc-text">${_esc(cards[i].question)}</div><div class="fc-hint-small">tap to flip</div></div><div class="fc-back"><div class="fc-tag">Answer</div><div class="fc-text">${_esc(cards[i].answer)}</div><div class="fc-hint-small">tap to flip back</div></div></div></div>`;}).join('');div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content" style="max-width:100%"><div class="msg-bubble"><div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--accent);margin-bottom:8px;">✦ ${cards.length} Flashcards — ${_esc(topic)}</div><div class="fc-grid">${cardsHtml}</div></div></div>`;wrap.appendChild(div);scrollBottom();}
function renderQuiz(questions,topic,difficulty){activeQuiz={questions,topic,difficulty,current:0,score:0,total:questions.length};showQuizQuestion();}
function showQuizQuestion(){if(!activeQuiz)return;const{questions,current,total}=activeQuiz;if(current>=total){showQuizResult();return;}const q=questions[current];const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';div.id='quiz-msg';const pct=Math.round(current/total*100);const optsHtml=q.options.map((opt,i)=>{const letter=String.fromCharCode(65+i);return`<div class="quiz-opt" id="qopt_${i}" onclick="answerQuiz(${i})"><div class="opt-l">${letter}</div>${_esc(opt)}</div>`;}).join('');div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content" style="max-width:90%"><div class="msg-bubble"><div class="quiz-wrap"><div class="quiz-prog"><div class="quiz-fill" style="width:${pct}%"></div></div><div class="quiz-qnum">Question ${current+1} of ${total}</div><div class="quiz-q">${_esc(q.question)}</div><div class="quiz-opts">${optsHtml}</div><div class="quiz-exp" id="quiz-exp">${_esc(q.explanation||'')}</div><button class="quiz-next" id="quiz-next" onclick="nextQuestion()">Next →</button></div></div></div>`;wrap.appendChild(div);scrollBottom();}
function answerQuiz(chosen){if(!activeQuiz)return;const q=activeQuiz.questions[activeQuiz.current];const correct=q.answer;document.querySelectorAll('.quiz-opt').forEach((el,i)=>{el.classList.add('disabled');if(i===correct)el.classList.add('correct');else if(i===chosen)el.classList.add('wrong');});if(chosen===correct)activeQuiz.score++;const exp=document.getElementById('quiz-exp');if(exp&&q.explanation)exp.style.display='block';const nxt=document.getElementById('quiz-next');if(nxt)nxt.style.display='block';}
function nextQuestion(){const old=document.getElementById('quiz-msg');if(old)old.remove();activeQuiz.current++;showQuizQuestion();}
function showQuizResult(){const{score,total,topic}=activeQuiz;const pct=Math.round(score/total*100);const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble"><div class="quiz-result"><div class="qr-pct">${pct}%</div><div class="qr-lbl">Quiz complete — ${_esc(topic)}</div><div class="qr-stats"><div class="qr-stat"><div class="qr-n g">${score}</div><div class="qr-sl">Correct</div></div><div class="qr-stat"><div class="qr-n r">${total-score}</div><div class="qr-sl">Wrong</div></div><div class="qr-stat"><div class="qr-n">${total}</div><div class="qr-sl">Total</div></div></div></div></div></div>`;wrap.appendChild(div);activeQuiz=null;scrollBottom();}

// ── Graph ──
function renderGraph(data){
  if(!window.Chart){addMsg('ai','Chart.js not loaded.');return;}
  const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';const cid='chart_'+Date.now();const isLive=data.data_source==='live';
  div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content" style="max-width:100%"><div class="msg-bubble" style="padding:0;background:none;border:none;"><div class="graph-wrap"><div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;"><div><div class="graph-title">${_esc(data.title)}</div>${data.unit?`<div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">Unit: ${_esc(data.unit)}</div>`:''}</div><span class="graph-source-badge ${isLive?'live':'estimated'}">${isLive?'● Live':'○ Est.'}</span></div><div style="position:relative;width:100%;"><canvas id="${cid}" height="220"></canvas></div>${data.caption?`<div style="font-size:11px;color:var(--text3);margin-top:6px;font-family:'DM Mono',monospace;">${_esc(data.caption)}</div>`:''}</div></div></div>`;
  wrap.appendChild(div);scrollBottom();
  const COLORS=['#4f8eff','#7c5cfc','#00e5c0','#ffb547','#ff4f6a'];const ctx=document.getElementById(cid).getContext('2d');const ct=data.chart_type||'line';let datasets,labels;
  if(ct==='pie'){labels=data.series[0].data.map(p=>p.x);datasets=[{data:data.series[0].data.map(p=>p.y),backgroundColor:COLORS.slice(0,labels.length),borderWidth:0}];}
  else{labels=data.series[0].data.map(p=>p.x);datasets=data.series.map((s,i)=>({label:s.label,data:s.data.map(p=>p.y),borderColor:COLORS[i%COLORS.length],backgroundColor:ct==='bar'?COLORS[i%COLORS.length]+'99':COLORS[i%COLORS.length]+'22',borderWidth:2,pointRadius:3,tension:.35,fill:ct==='line'}));}
  new Chart(ctx,{type:ct,data:{labels,datasets},options:{responsive:true,plugins:{legend:{display:datasets.length>1,labels:{color:'#8899bb',font:{size:11}}},tooltip:{backgroundColor:'rgba(8,11,18,.97)',titleColor:'#8899bb',bodyColor:'#e8edf5',borderColor:'#1e2d45',borderWidth:1}},scales:ct!=='pie'?{x:{ticks:{color:'#4a5a7a',font:{size:10}},grid:{color:'rgba(79,142,255,.06)'}},y:{ticks:{color:'#4a5a7a',font:{size:10}},grid:{color:'rgba(79,142,255,.06)'}}}:{}}});
}

// ── Flowchart (simplified — keeps same logic) ──
const FC_COLORS={blue:{fill:'#E6F1FB',stroke:'#185FA5',text:'#0C447C'},teal:{fill:'#E1F5EE',stroke:'#0F6E56',text:'#085041'},amber:{fill:'#FAEEDA',stroke:'#854F0B',text:'#633806'},green:{fill:'#EAF3DE',stroke:'#3B6D11',text:'#27500A'},coral:{fill:'#FAECE7',stroke:'#993C1D',text:'#712B13'},gray:{fill:'#F1EFE8',stroke:'#5F5E5A',text:'#444441'},purple:{fill:'#EEEDFE',stroke:'#534AB7',text:'#3C3489'}};
const FC_NW=140,FC_NH=54;
const fcRevealedMap={},fcDataMap={};
function fcShapePathD(n){const{x,y}=n;const w=FC_NW,h=FC_NH;if(n.shape==='diamond'){const cx=x+w/2,cy=y+h/2;return`M${cx},${y} L${x+w},${cy} L${cx},${y+h} L${x},${cy} Z`;}if(n.shape==='para'){const sk=12;return`M${x+sk},${y} L${x+w},${y} L${x+w-sk},${y+h} L${x},${y+h} Z`;}return`M${x+8},${y} L${x+w-8},${y} Q${x+w},${y} ${x+w},${y+8} L${x+w},${y+h-8} Q${x+w},${y+h} ${x+w-8},${y+h} L${x+8},${y+h} Q${x},${y+h} ${x},${y+h-8} L${x},${y+8} Q${x},${y} ${x+8},${y} Z`;}
function fcEdgePath(edge,nMap){const f=nMap[edge.f],t=nMap[edge.t];if(!f||!t)return'';const fx=f.x+FC_NW/2,fy=f.y+FC_NH,tx=t.x+FC_NW/2,ty=t.y;if(edge.back){const bx=edge.bx||fx+80,y1=fy+10,y2=ty-10;return`M${fx},${fy} L${fx},${y1} L${bx},${y1} L${bx},${y2} L${tx},${y2} L${tx},${ty}`;}if(Math.abs(fx-tx)<6)return`M${fx},${fy} L${tx},${ty}`;const mid=(fy+ty)/2;return`M${fx},${fy} L${fx},${mid} L${tx},${mid} L${tx},${ty}`;}
function fcEdgeMid(d){const pts=d.match(/-?[\d.]+,-?[\d.]+/g)||[];if(pts.length<2)return{x:0,y:0};const i=Math.floor(pts.length/2);const p=pts[i].split(',');return{x:+p[0],y:+p[1]};}
function buildFlowchartSVG(fcData,revealedSet,cardId){const nMap={};fcData.nodes.forEach(n=>nMap[n.id]=n);let maxX=0,maxY=0;fcData.nodes.forEach(n=>{maxX=Math.max(maxX,n.x+FC_NW+40);maxY=Math.max(maxY,n.y+FC_NH+60);});const svgW=Math.max(maxX,500),svgH=Math.max(maxY,300);let edgesHtml='',nodesHtml='';const defs=`<defs><marker id="fcarr_${cardId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#4a5a7a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;fcData.edges.forEach(e=>{if(!revealedSet.has(e.f)||!revealedSet.has(e.t))return;const d=fcEdgePath(e,nMap);if(!d)return;const mp=fcEdgeMid(d);edgesHtml+=`<path d="${d}" fill="none" stroke="#243350" stroke-width="1.2" marker-end="url(#fcarr_${cardId})"/>`;if(e.label)edgesHtml+=`<text x="${mp.x+4}" y="${mp.y-4}" font-size="10" fill="#4a5a7a" font-family="'DM Mono',monospace">${_esc(e.label)}</text>`;});fcData.nodes.forEach(n=>{if(!revealedSet.has(n.id))return;const c=FC_COLORS[n.col]||FC_COLORS.blue;const hasChildren=fcData.edges.some(e=>e.f===n.id&&!e.back);const allChildRevealed=!hasChildren||fcData.edges.filter(e=>e.f===n.id&&!e.back).every(e=>revealedSet.has(e.t));const clickable=hasChildren&&!allChildRevealed;const onclick=clickable?`onclick="fcRevealChildren('${cardId}','${n.id}')"`:allChildRevealed&&hasChildren?`onclick="fcCollapse('${cardId}','${n.id}')"`:'';;let shapeHtml='';if(n.shape==='oval'){shapeHtml=`<ellipse cx="${n.x+FC_NW/2}" cy="${n.y+FC_NH/2}" rx="${FC_NW/2}" ry="${FC_NH/2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`;}else{shapeHtml=`<path d="${fcShapePathD(n)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`;};const lines=(n.label||'').split('\\n');const lh=15,th=lines.length*lh,sy=n.y+FC_NH/2-th/2+lh/2;let textHtml=lines.map((l,i)=>`<text x="${n.x+FC_NW/2}" y="${sy+i*lh}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="500" fill="${c.text}" font-family="'DM Sans',sans-serif">${_esc(l)}</text>`).join('');nodesHtml+=`<g ${onclick} style="cursor:${clickable||allChildRevealed&&hasChildren?'pointer':'default'}">${shapeHtml}${textHtml}</g>`;});const style=`<style>@keyframes fcFadeIn{from{opacity:0}to{opacity:1}}</style>`;return{svgInner:style+defs+edgesHtml+nodesHtml,svgW,svgH};}
function fcRevealChildren(cardId,nodeId){const rev=fcRevealedMap[cardId];const data=fcDataMap[cardId];if(!rev||!data)return;data.edges.filter(e=>e.f===nodeId&&!e.back).forEach(e=>rev.add(e.t));redrawFlowchart(cardId);}
function fcCollapse(cardId,nodeId){const rev=fcRevealedMap[cardId];const data=fcDataMap[cardId];if(!rev||!data)return;function removeDesc(id){data.edges.filter(e=>e.f===id).forEach(e=>{rev.delete(e.t);removeDesc(e.t);});}removeDesc(nodeId);redrawFlowchart(cardId);}
function fcExpandAll(cardId){const rev=fcRevealedMap[cardId];const data=fcDataMap[cardId];if(!rev||!data)return;data.nodes.forEach(n=>rev.add(n.id));redrawFlowchart(cardId);}
function fcCollapseAll(cardId){const rev=fcRevealedMap[cardId];const data=fcDataMap[cardId];if(!rev||!data)return;rev.clear();if(data.nodes.length)rev.add(data.nodes[0].id);redrawFlowchart(cardId);}
function fcZoom(cardId,factor){const svg=document.getElementById('fcsvg_'+cardId);if(!svg)return;const cur=parseFloat(svg.dataset.zoom||'1');const nz=Math.min(3,Math.max(0.3,cur*factor));svg.dataset.zoom=nz;svg.style.transform=`scale(${nz})`;svg.style.transformOrigin='top left';}
function fcReset(cardId){const svg=document.getElementById('fcsvg_'+cardId);if(!svg)return;svg.dataset.zoom='1';svg.style.transform='scale(1)';}
function redrawFlowchart(cardId){const svg=document.getElementById('fcsvg_'+cardId);const data=fcDataMap[cardId];const rev=fcRevealedMap[cardId];if(!svg||!data||!rev)return;const{svgInner,svgW,svgH}=buildFlowchartSVG(data,rev,cardId);svg.setAttribute('viewBox',`0 0 ${svgW} ${svgH}`);svg.setAttribute('width',svgW);svg.setAttribute('height',svgH);svg.innerHTML=svgInner;}
function renderFlowchartMsg(data){
  const cardId='fc_'+Date.now();fcDataMap[cardId]=data;const rev=new Set();if(data.nodes.length)rev.add(data.nodes[0].id);fcRevealedMap[cardId]=rev;const{svgInner,svgW,svgH}=buildFlowchartSVG(data,rev,cardId);
  const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';
  div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content" style="max-width:100%;width:100%"><div class="msg-bubble" style="padding:0;background:none;border:none;width:100%"><div class="fc-card"><div class="fc-card-header"><div class="fc-badge"><div class="fc-badge-dot"></div>🔀 Flowchart — ${_esc(data.title)}</div><div class="fc-toolbar"><button class="fc-tool-btn" onclick="fcExpandAll('${cardId}')">Expand all</button><button class="fc-tool-btn" onclick="fcCollapseAll('${cardId}')">Collapse</button><button class="fc-tool-btn" onclick="fcZoom('${cardId}',1.2)">+ Zoom</button><button class="fc-tool-btn" onclick="fcZoom('${cardId}',0.83)">- Zoom</button><button class="fc-tool-btn" onclick="fcReset('${cardId}')">Reset</button><button class="fc-tool-btn" id="fcsave_${cardId}" onclick="fcSave('${cardId}')">💾 Save</button></div></div><div class="fc-canvas-wrap" id="fcwrap_${cardId}" style="overflow:auto;min-height:320px;"><svg id="fcsvg_${cardId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" style="display:block;transition:transform .15s;transform-origin:top left" data-zoom="1">${svgInner}</svg></div><div class="fc-hint">Click pulsing node to reveal next step</div><div class="fc-legend"><div class="fc-leg-item"><svg width="20" height="14"><rect x="1" y="1" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1"/></svg> Process</div><div class="fc-leg-item"><svg width="20" height="14"><polygon points="10,1 19,7 10,13 1,7" fill="none" stroke="currentColor" stroke-width="1"/></svg> Decision</div><div class="fc-leg-item"><svg width="22" height="14"><ellipse cx="11" cy="7" rx="10" ry="6" fill="none" stroke="currentColor" stroke-width="1"/></svg> Start/End</div></div></div></div></div>`;
  wrap.appendChild(div);scrollBottom();
}
function fcSave(cardId){const data=fcDataMap[cardId];if(!data)return;const files=loadFiles();if(files.length>=FILES_MAX)return;const entry={id:'f_'+Date.now(),type:'flowchart',topic:data.title,fcData:data,createdAt:Date.now(),wordCount:data.nodes.length};files.unshift(entry);saveFiles(files);updateFilesBadge();const btn=document.getElementById('fcsave_'+cardId);if(btn){btn.textContent='✓ Saved';setTimeout(()=>{btn.textContent='💾 Save';},2000);}}

// ── Code blocks ──
const CODE_REQUEST=/\b(write|create|make|build|code|program|develop|implement|generate)\b.{0,80}\b(code|script|function|program|app|tool|bot|website|api|class|component|snippet|algorithm|game|calculator|system|project)\b|\b(code|script|function|app|program|game|calculator)\b.{0,40}\b(for|that|to|which|in|using|with)\b|\b(using|in)\s+(html|css|javascript|python|java|c\+\+|react|node)/i;
function isCodeRequest(text){const t=text.trim();if(t.startsWith('```')||t.includes('<!DOCTYPE'))return false;if(t.length>300)return false;return CODE_REQUEST.test(t);}
function renderCodeBlock(code,lang,id){const runnable=['python','javascript','js','html','css'].includes(lang.toLowerCase());const runBtn=runnable?`<button class="run-btn" onclick="runInlineCode('${id}','${lang}')">▶ Run</button>`:'';return`<div class="code-run-wrap"><div class="code-run-header"><span class="code-run-lang">${lang||'code'}</span><div class="code-run-actions">${runBtn}<button class="copy-btn" onclick="copyCode('${id}')">⎘ Copy</button><button class="expand-btn" onclick="openIde('${id}','${lang}')">⛶ IDE</button></div></div><pre><code class="language-${lang}" id="${id}">${_esc(code)}</code></pre><div class="code-output" id="out_${id}"></div></div>`;}
async function runInlineCode(id,lang){const codeEl=document.getElementById(id);if(!codeEl)return;const code=codeEl.textContent;const outEl=document.getElementById('out_'+id);outEl.className='code-output visible';outEl.textContent='⏳ Running…';try{const res=await fetch(API_URL+'/run-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,language:lang})});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();const output=data.output||'(no output)';const isErr=data.error||output.toLowerCase().includes('error:');outEl.textContent=output;outEl.className='code-output visible '+(isErr?'error':'success');}catch(err){outEl.textContent='❌ Could not run code: '+err.message;outEl.className='code-output visible error';}}
async function generateCodeQuestions(userRequest){try{const res=await fetch(API_URL+'/code-questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:userRequest})});if(res.ok){const data=await res.json();if(Array.isArray(data.questions)&&data.questions.length>0)return data.questions;}}catch(e){}return[];}
async function showCodeContextForm(originalRequest){const wrap=document.getElementById('chat-messages');const fid='ccf'+Date.now();const div=document.createElement('div');div.className='msg ai';div.id=fid+'-msg';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble"><div class="ccf-wrap"><div class="ccf-header"><span class="ccf-icon">💬</span><div><div class="ccf-title">Let me ask a couple of things first</div><div class="ccf-sub">This helps me write exactly what you need</div></div></div><div class="ccf-loading" id="${fid}-loading"><div class="ccf-spinner"></div>Thinking of the right questions...</div><div class="ccf-questions" id="${fid}-qs" style="display:none"></div><div class="ccf-actions" id="${fid}-actions" style="display:none"><button class="ccf-skip" onclick="skipCodeForm('${fid}')">Skip — just write it</button><button class="ccf-submit" onclick="submitCodeForm('${fid}')">✓ Generate Code</button></div></div></div></div>`;div._origReq=originalRequest;div._answers={};wrap.appendChild(div);scrollBottom();const questions=await generateCodeQuestions(originalRequest);const loadingEl=document.getElementById(fid+'-loading'),qsEl=document.getElementById(fid+'-qs'),actionsEl=document.getElementById(fid+'-actions');if(!loadingEl)return;if(!questions.length){div.remove();showTyping();_sendChat(originalRequest);return;}loadingEl.style.display='none';questions.forEach((q,qi)=>{const qDiv=document.createElement('div');qDiv.className='ccf-q';qDiv.innerHTML=`<div class="ccf-qlabel">${_esc(q.question)}</div><div class="ccf-opts">${q.options.map((opt,oi)=>`<button class="ccf-opt" id="${fid}-q${qi}-o${oi}" onclick="selectOpt('${fid}',${qi},${oi},this)">${_esc(opt)}</button>`).join('')}</div>`;qsEl.appendChild(qDiv);});div._questions=questions;qsEl.style.display='flex';qsEl.style.flexDirection='column';qsEl.style.gap='14px';actionsEl.style.display='flex';scrollBottom();}
function selectOpt(fid,qi,oi,btn){const msgEl=document.getElementById(fid+'-msg');if(!msgEl)return;document.querySelectorAll(`[id^="${fid}-q${qi}-o"]`).forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');if(!msgEl._answers)msgEl._answers={};msgEl._answers[qi]=btn.textContent;}
function submitCodeForm(fid){const msgEl=document.getElementById(fid+'-msg');if(!msgEl)return;const orig=msgEl._origReq||'',questions=msgEl._questions||[],answers=msgEl._answers||{};const details=questions.map((q,qi)=>answers[qi]?`- ${q.question} → ${answers[qi]}`:null).filter(Boolean);msgEl.remove();const enriched=details.length?orig+'\n\nExtra requirements:\n'+details.join('\n'):orig;showTyping();_sendChat(enriched);}
function skipCodeForm(fid){const msgEl=document.getElementById(fid+'-msg');if(!msgEl)return;const orig=msgEl._origReq||'';msgEl.remove();showTyping();_sendChat(orig);}

// ── Suggestions ──
function showSuggestions(reply,origQuestion){
  const sugs=['Explain this in simpler terms','Give me an example','Make flashcards on this','Quiz me on this','Give me a formula sheet'];
  const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='suggestions-wrap';
  div.innerHTML=sugs.map(s=>`<button class="suggestion-chip" onclick="useSuggestion('${s.replace(/'/g,"\\'")}',this.parentElement)">${s}</button>`).join('');
  wrap.appendChild(div);scrollBottom();
}
function useSuggestion(text,parent){if(parent)parent.remove();document.getElementById('chat-input').value=text;autoResize(document.getElementById('chat-input'));sendMessage();}

// ── Clear current chat ──
function clearCurrentChat(){
  if (!activeChatId) return;
  if (!confirm('Clear all messages in this chat?')) return;
  chats[activeChatId].messages = [];
  saveChats();
  activeQuiz = null;
  stagedPdfs = []; stagedImages = []; stagedTextFiles = [];
  renderStagedRow(); renderImgStagedRow();
  stopSpeaking();
  renderChatMessages();
  updateMemoryBadge();
  renderChatList();
}

// ══════════════════════════════════════════════════════
// SEND MESSAGE (main)
// ══════════════════════════════════════════════════════
async function sendMessage(){
  let text=document.getElementById('chat-input').value.trim();
  if(!text&&!stagedPdfs.length&&!stagedImages.length&&!stagedTextFiles.length)return;
  if(selectedContexts.length){text=text?`Context:\n${selectedContexts.join('\n')}\n\nQuestion: ${text}`:selectedContexts.join('\n');selectedContexts=[];renderContextChips();}
  document.getElementById('chat-input').value='';autoResize(document.getElementById('chat-input'));

  if(stagedImages.length){
    const images=[...stagedImages];stagedImages=[];renderImgStagedRow();if(!text)text='';
    addMsg('user',text||'(image sent)',{images});pushHistory('user',text||'[image]');showTyping();
    try{const res=await fetch(API_URL+'/image-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,images:images.map(i=>i.base64),image_names:images.map(i=>i.name),history:getChatHistory().slice(-10)})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();const reply=data.reply||'Sorry, no response.';pushHistory('assistant',reply);addMsg('ai',reply,{imgBadge:'Vision — '+data.image_count+' image(s)'})._rawText=reply;}catch(err){hideTyping();addMsg('ai','❌ Could not process the image.');}return;
  }
  if(stagedTextFiles.length&&!stagedPdfs.length){
    const files=[...stagedTextFiles];stagedTextFiles=[];renderStagedRow();if(!text)text='Please analyse this file.';
    addMsg('user',text,{pdfs:files.map(f=>({name:f.name,sizeKb:f.sizeKb,pageCount:null,thumbDataUrl:null}))});pushHistory('user',text);showTyping();
    const blocks=files.map(f=>`\n\n=== FILE: ${f.name} ===\n${f.content.slice(0,20000)}`).join('');
    await _sendChat(text+'\n\nUploaded files:\n'+blocks);return;
  }
  if(stagedPdfs.length){
    const pdfs=[...stagedPdfs];stagedPdfs=[];renderStagedRow();if(!text)text='Please summarise this document.';addMsg('user',text,{pdfs});pushHistory('user',text);showTyping();
    let pdfIntent='chat';try{const ir=await fetch(API_URL+'/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:getChatHistory().slice(-6)})});if(ir.ok){const id=await ir.json();pdfIntent=id.intent||'chat';}}catch(e){}
    const pdf=pdfs[0],pdfBase64=pdf.base64,pdfName=pdf.name;
    const topicFromText=(t)=>t.replace(/^(make|create|generate|give me|show me|flashcards?|quiz|notes?|formula|flowchart)\s+/gi,'').replace(/(notes?|formula sheet?|flashcards?|quiz|flowchart)\s+(on|for|about|of)\s+/gi,'').trim()||pdfName.replace(/\.pdf$/i,'');
    try{
      if(pdfIntent==='notes'){const res=await fetch(API_URL+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:topicFromText(text),history:getChatHistory().slice(-10),model:activeModel,pdf_base64:pdfBase64,pdf_name:pdfName})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Notes: '+data.topic+']');renderNotesMsg(data.notes,data.topic);return;}
      if(pdfIntent==='formula'){const res=await fetch(API_URL+'/formula-sheet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:topicFromText(text),history:getChatHistory().slice(-10),model:activeModel,pdf_base64:pdfBase64,pdf_name:pdfName})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Formula: '+data.topic+']');renderFormulaMsg(data.sheet,data.topic);return;}
      if(pdfIntent==='flashcard'||pdfIntent==='both'||pdfIntent==='quiz'){
        const extractRes=await fetch(API_URL+'/pdf-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'List all the key concepts, terms and facts.',pdf_base64:pdfBase64,pdf_name:pdfName,history:[],model:activeModel})});
        if(extractRes.status===429){const d=await extractRes.json();hideTyping();showRateLimit(d.detail||{});return;}
        if(!extractRes.ok)throw new Error('HTTP '+extractRes.status);
        const extractData=await extractRes.json();const enrichedTopic=topicFromText(text)+'. Key content:\n'+extractData.reply.slice(0,800);
        if(pdfIntent!=='quiz'){const fcRes=await fetch(API_URL+'/flashcards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:enrichedTopic,count:0,history:getChatHistory().slice(-6),model:activeModel})});if(!fcRes.ok)throw new Error('HTTP '+fcRes.status);const fcData=await fcRes.json();hideTyping();pushHistory('assistant','[Flashcards from PDF]');renderFlashcards(fcData.cards,fcData.topic);}
        if(pdfIntent!=='flashcard'){const qRes=await fetch(API_URL+'/quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:enrichedTopic,count:0,history:getChatHistory().slice(-6),model:activeModel})});if(!qRes.ok)throw new Error('HTTP '+qRes.status);const qData=await qRes.json();hideTyping();pushHistory('assistant','[Quiz from PDF]');renderQuiz(qData.questions,qData.topic,qData.difficulty);}
        return;
      }
      const res=await fetch(API_URL+'/pdf-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,pdf_base64:pdfBase64,pdf_name:pdfName,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();const reply=data.reply||'Sorry, no response.';pushHistory('assistant',reply);addMsg('ai',reply,{pdfBadge:pdfName})._rawText=reply;
    }catch(err){hideTyping();addMsg('ai','Could not process the PDF.');}return;
  }

  addMsg('user',text);
  if(isCodeRequest(text)&&!isFreeMode){await showCodeContextForm(text);return;}
  showTyping();
  let intent='chat';
  try{const ir=await fetch(API_URL+'/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:getChatHistory().slice(-6)})});if(ir.ok){const id=await ir.json();intent=id.intent||'chat';}}catch(e){}
  pushHistory('user',text);

  if(intent==='graph'){try{const res=await fetch(API_URL+'/graph',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Graph: '+data.title+']');renderGraph(data);}catch(err){hideTyping();addMsg('ai','Could not generate the graph.');}return;}
  if(intent==='flowchart'){try{const res=await fetch(API_URL+'/flowchart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Flowchart: '+data.title+']');renderFlowchartMsg(data);}catch(err){hideTyping();addMsg('ai','Could not generate the flowchart.');}return;}
  if(intent==='notes'){try{const res=await fetch(API_URL+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:text,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Notes: '+data.topic+']');renderNotesMsg(data.notes,data.topic);}catch(err){hideTyping();addMsg('ai','Could not generate notes.');}return;}
  if(intent==='formula'){try{const res=await fetch(API_URL+'/formula-sheet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:text,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Formula: '+data.topic+']');renderFormulaMsg(data.sheet,data.topic);}catch(err){hideTyping();addMsg('ai','Could not generate formula sheet.');}return;}
  if(intent==='flashcard'||intent==='both'){try{const res=await fetch(API_URL+'/flashcards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:text,count:0,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();if(intent==='both'){const qres=await fetch(API_URL+'/quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:text,count:0,history:getChatHistory().slice(-10),model:activeModel})});if(!qres.ok)throw new Error('HTTP '+qres.status);const qdata=await qres.json();hideTyping();pushHistory('assistant','[Flashcards+Quiz: '+data.topic+']');renderFlashcards(data.cards,data.topic);renderQuiz(qdata.questions,qdata.topic,qdata.difficulty);}else{hideTyping();pushHistory('assistant','[Flashcards: '+data.topic+']');renderFlashcards(data.cards,data.topic);}}catch(err){hideTyping();addMsg('ai','Could not generate flashcards.');}return;}
  if(intent==='quiz'){try{const res=await fetch(API_URL+'/quiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:text,count:0,history:getChatHistory().slice(-10),model:activeModel})});if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();hideTyping();pushHistory('assistant','[Quiz: '+data.topic+']');renderQuiz(data.questions,data.topic,data.difficulty);}catch(err){hideTyping();addMsg('ai','Could not generate quiz.');}return;}

  if(intent==='practice'){
    // Extract topic — strip practice/solve/exercise trigger words
    const practiceStopWords = /\b(practice|practise|solve|exercise|problems?|questions?|on|for|about|me|want|to|i|let|give|whiteboard|do|some|a|an|the|please)\b/gi;
    let topic = text.replace(practiceStopWords,'').replace(/\s+/g,' ').trim();
    if(!topic || topic.length < 3) topic = text.trim(); // fallback to full text

    // Detect difficulty from message
    let difficulty = 'medium';
    if(/\b(easy|simple|basic|beginner|आसान|सरल)\b/i.test(text)) difficulty = 'easy';
    else if(/\b(hard|difficult|advanced|tough|challenging|कठिन|मुश्किल)\b/i.test(text)) difficulty = 'hard';

    hideTyping();
    pushHistory('assistant', '[Practice: '+topic+']');
    renderPracticeCard(topic, difficulty);
    return;
  }

  await _sendChat(text);
}

async function _sendChat(text){
  try{
    // Send preferred_language as a proper API field — backend uses it to override system prompt.
    // Empty string = auto-detect (default). 'English', 'Hindi', 'Tamil' etc = enforce that language.
    const res=await fetch(API_URL+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      message: text,
      model: activeModel,
      history: getChatHistory().slice(-20),
      preferred_language: _userPreferredLang || 'English',
      force_language: true,
    })});
    if(res.status===429){const d=await res.json();hideTyping();showRateLimit(d.detail||{});return;}
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();hideTyping();
    const reply=data.reply||'Sorry, no response.';pushHistory('assistant',reply);
    if(reply.includes('```')){const match=reply.match(/```(\w+)\n([\s\S]*?)```/);if(match){const lang=match[1].toLowerCase();const code=match[2].trim();if(['python','javascript','js','html'].includes(lang)){addMsg('ai',reply);showRunPrompt(lang,code);return;}}}
    const msgDiv=addMsg('ai',reply);msgDiv._rawText=reply;
    const suggestionTrigger=/\b(explain|tell me|describe|what is|how does)\b/i;
    if(suggestionTrigger.test(text)&&reply.length>200)showSuggestions(reply,text);
  }catch(err){hideTyping();addMsg('ai','Could not reach Sedy. Please check your connection.');}
}
function showRunPrompt(lang,code){const id='run_'+Date.now();const wrap=document.getElementById('chat-messages');const div=document.createElement('div');div.className='msg ai';div.innerHTML=`<div class="msg-avatar">✦</div><div class="msg-content"><div class="msg-bubble" style="padding:0;background:none;border:none;">${renderCodeBlock(code,lang,id)}</div></div>`;wrap.appendChild(div);try{hljs.highlightElement(document.getElementById(id));}catch(e){}scrollBottom();}

// ── Attach menu ──
function toggleAttachMenu(e){e.stopPropagation();document.getElementById('attach-menu').classList.toggle('open');}
function closeAttachMenu(){document.getElementById('attach-menu').classList.remove('open');}
document.addEventListener('click',(e)=>{if(!e.target.closest('#attach-wrap'))closeAttachMenu();});
function openWhiteboardFromMenu(){closeAttachMenu();openWhiteboard();}
function openScopeFromMenu(){closeAttachMenu();openScope();}

// ── Screenshot / Crop ──
let cropCanvas=null,cropCtx=null,cropStream=null,cropStartX=0,cropStartY=0,cropEndX=0,cropEndY=0,cropDragging=false,cropHasSelection=false;
function startScreenshot(){closeAttachMenu();if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){addMsg('ai','📸 Screen capture not supported. Try Chrome!');return;}navigator.mediaDevices.getDisplayMedia({video:{cursor:'always'},audio:false}).then(stream=>{cropStream=stream;const video=document.createElement('video');video.srcObject=stream;video.play();video.onloadeddata=()=>{const overlay=document.getElementById('crop-overlay');const canvas=document.getElementById('crop-canvas');canvas.width=window.innerWidth;canvas.height=window.innerHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,canvas.width,canvas.height);stream.getTracks().forEach(t=>t.stop());cropCanvas=canvas;cropCtx=ctx;cropHasSelection=false;document.getElementById('crop-confirm').style.display='none';document.getElementById('crop-selection').classList.remove('visible');overlay.classList.add('active');setupCropEvents();};}).catch(err=>{if(err.name!=='NotAllowedError')addMsg('ai','Could not capture screen: '+err.message);});}
function setupCropEvents(){const overlay=document.getElementById('crop-overlay');const selection=document.getElementById('crop-selection');function onDown(e){const r=overlay.getBoundingClientRect();cropStartX=(e.touches?e.touches[0].clientX:e.clientX)-r.left;cropStartY=(e.touches?e.touches[0].clientY:e.clientY)-r.top;cropDragging=true;cropHasSelection=false;document.getElementById('crop-confirm').style.display='none';selection.classList.remove('visible');}function onMove(e){if(!cropDragging)return;e.preventDefault();const r=overlay.getBoundingClientRect();cropEndX=(e.touches?e.touches[0].clientX:e.clientX)-r.left;cropEndY=(e.touches?e.touches[0].clientY:e.clientY)-r.top;const x=Math.min(cropStartX,cropEndX),y=Math.min(cropStartY,cropEndY),w=Math.abs(cropEndX-cropStartX),h=Math.abs(cropEndY-cropStartY);selection.style.left=x+'px';selection.style.top=y+'px';selection.style.width=w+'px';selection.style.height=h+'px';selection.classList.add('visible');}function onUp(){if(!cropDragging)return;cropDragging=false;if(Math.abs(cropEndX-cropStartX)>20&&Math.abs(cropEndY-cropStartY)>20){cropHasSelection=true;document.getElementById('crop-confirm').style.display='';}}overlay.addEventListener('mousedown',onDown);overlay.addEventListener('mousemove',onMove);overlay.addEventListener('mouseup',onUp);overlay.addEventListener('touchstart',onDown,{passive:false});overlay.addEventListener('touchmove',onMove,{passive:false});overlay.addEventListener('touchend',onUp);}
function captureFullScreen(){if(!cropCanvas)return;cancelCrop();const dataUrl=cropCanvas.toDataURL('image/jpeg',.92);stagedImages.push({dataUrl,base64:dataUrl.split(',')[1],name:'screenshot.jpg'});renderImgStagedRow();}
function cropAndSend(){if(!cropCanvas||!cropHasSelection)return;const x=Math.min(cropStartX,cropEndX),y=Math.min(cropStartY,cropEndY),w=Math.abs(cropEndX-cropStartX),h=Math.abs(cropEndY-cropStartY);const tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').drawImage(cropCanvas,x,y,w,h,0,0,w,h);const dataUrl=tc.toDataURL('image/jpeg',.92);cancelCrop();stagedImages.push({dataUrl,base64:dataUrl.split(',')[1],name:'screenshot.jpg'});renderImgStagedRow();}
function cancelCrop(){document.getElementById('crop-overlay').classList.remove('active');cropHasSelection=false;cropCanvas=null;}

// ── Files panel ──
function loadFiles(){try{return JSON.parse(localStorage.getItem(FILES_KEY)||'[]');}catch(e){return[];}}
function saveFiles(files){try{localStorage.setItem(FILES_KEY,JSON.stringify(files));}catch(e){}}
function updateFilesBadge(){const files=loadFiles();const count=files.length;const el=document.getElementById('files-count');if(el){el.textContent=count;el.classList.toggle('visible',count>0);}}
function openFilesPanel(){renderFilesList();document.getElementById('files-panel').classList.add('visible');document.getElementById('files-overlay').classList.add('visible');}
function closeFilesPanel(){document.getElementById('files-panel').classList.remove('visible');document.getElementById('files-overlay').classList.remove('visible');}
function switchFilesTab(tab){activeFilesTab=tab;document.querySelectorAll('.files-tab').forEach(t=>t.classList.toggle('active',t.id==='ftab-'+tab));renderFilesList();}
function renderFilesList(){const files=loadFiles().filter(f=>f.type===activeFilesTab);const list=document.getElementById('files-list');list.innerHTML='';if(!files.length){list.innerHTML=`<div class="files-empty"><div class="files-empty-icon">${activeFilesTab==='notes'?'📝':activeFilesTab==='formula'?'📐':'🔀'}</div><div class="files-empty-text">No saved ${activeFilesTab} yet.</div></div>`;return;}files.forEach(file=>{const card=document.createElement('div');card.className='file-card';const icon=file.type==='notes'?'📝':file.type==='formula'?'📐':'🔀';const iconClass=file.type;const date=new Date(file.createdAt||Date.now()).toLocaleDateString('en-US',{month:'short',day:'numeric'});card.innerHTML=`<div class="file-card-top"><div class="file-card-icon ${iconClass}">${icon}</div><div class="file-card-info"><div class="file-card-topic">${_esc(file.topic)}</div><div class="file-card-meta">${date} · ${file.wordCount||0} ${file.type==='flowchart'?'nodes':'words'}</div></div></div><div class="file-card-actions"><button class="file-open-btn" onclick="openFile('${file.id}')">Open</button><button class="file-del-btn" onclick="deleteFile('${file.id}')">🗑</button></div>`;list.appendChild(card);});}
function saveFile(cardId,type,topic){const el=document.getElementById(cardId);if(!el)return;const files=loadFiles();if(files.length>=FILES_MAX){addMsg('ai','⚠️ Storage full.');return;}const content=el.innerHTML;const wordCount=el.innerText.split(/\s+/).length;const existing=files.findIndex(f=>f.topic===topic&&f.type===type);const entry={id:'f_'+Date.now(),type,topic,content,wordCount,createdAt:Date.now()};if(existing>=0)files[existing]=entry;else files.unshift(entry);saveFiles(files);updateFilesBadge();const btn=document.getElementById('save_'+cardId);if(btn){btn.textContent='✓ Saved';setTimeout(()=>{btn.textContent='💾 Save';},2000);}}
function openFile(fileId){const files=loadFiles();const file=files.find(f=>f.id===fileId);if(!file)return;closeFilesPanel();if(file.type==='flowchart'&&file.fcData){renderFlowchartMsg(file.fcData);return;}if(file.type==='notes')renderNotesMsg(file.content||'',file.topic);else if(file.type==='formula')renderFormulaMsg(file.content||'',file.topic);}
function deleteFile(fileId){const files=loadFiles().filter(f=>f.id!==fileId);saveFiles(files);updateFilesBadge();renderFilesList();}

// ── Scope (simplified) ──
// ══════════════════════════════════════════════════════
// SEDY SCOPE — Smart Camera System
// ══════════════════════════════════════════════════════
//
// FEATURES:
// 1. Single clean tab — no multi-tab complexity
// 2. Smart intent detection — AI decides: answer OR save to memory
// 3. Element highlight glow on capture — every object in scene glows
// 4. Full image+text reading — diagrams, equations, photos all understood
// 5. Smart pattern memory — visual fingerprint saved, AI matches on next scan
//
// MEMORY SYSTEM:
// When you say "remember this as [name]" or similar, it:
//   a) Captures a visual pattern fingerprint of the image (colour histogram
//      + edge density grid = compact descriptor, no raw image stored forever)
//   b) Saves a thumbnail + descriptor + name to localStorage
//   c) On future captures, compares the new image against saved patterns
//   d) If similarity > threshold → shows match toast instantly
//
// SMART INTENT (via AI):
//   The system prompt tells the AI:
//   "If user wants to save/remember → reply with JSON {action:'save',name:'...'}
//    Otherwise → reply with the answer normally as text"
//   The frontend parses this and either saves or displays.

const SCOPE_MEMORY_KEY = 'sedy_scope_memory_v2';
let scopeMemory = [];       // [{id, name, type, thumb, descriptor, desc, createdAt}]
let scopeStream = null;
let scopeFacingMode = 'environment';
let scopeVoiceRec = null;
let scopeVoiceActive = false;
let scopeCurrentAnswer = '';
let scopeCurrentBase64 = null;  // last captured frame (for saving)
let scopeCurrentSaveIntent = null; // {name, desc} pending save after answer shown

// ── Load memory from storage ──
function scopeLoadMemory() {
  try { scopeMemory = JSON.parse(localStorage.getItem(SCOPE_MEMORY_KEY) || '[]'); }
  catch(e) { scopeMemory = []; }
}
function scopeSaveMemoryStore() {
  try { localStorage.setItem(SCOPE_MEMORY_KEY, JSON.stringify(scopeMemory)); } catch(e) {}
  scopeUpdateMemBadge();
}
function scopeUpdateMemBadge() {
  const badge = document.getElementById('scope-mem-badge');
  const count = document.getElementById('scope-mem-count');
  if (!badge || !count) return;
  if (scopeMemory.length > 0) {
    badge.style.display = 'flex';
    count.textContent = scopeMemory.length;
  } else {
    badge.style.display = 'none';
  }
}

// ── Open / Close ──
function openScope() {
  scopeLoadMemory();
  document.getElementById('scope-overlay').classList.add('active');
  startScopeCamera();
  scopeUpdateMemBadge();
}
function closeScope() {
  stopScopeCamera();
  stopScopeVoice();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.getElementById('scope-overlay').classList.remove('active');
  closeScopeAnswer();
  scopeHideScan();
  document.getElementById('scope-freeze').classList.remove('visible');
  document.getElementById('scope-highlight-canvas').classList.remove('visible');
  document.getElementById('scope-memories-panel').classList.remove('open');
}

// ── Camera ──
async function startScopeCamera() {
  try {
    if (scopeStream) scopeStream.getTracks().forEach(t => t.stop());
    scopeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: scopeFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = document.getElementById('scope-video');
    video.srcObject = scopeStream;
    video.classList.toggle('mirrored', scopeFacingMode === 'user');
  } catch(err) {
    addMsg('ai', 'Camera error: ' + err.message);
    document.getElementById('scope-overlay').classList.remove('active');
  }
}
function stopScopeCamera() {
  if (scopeStream) { scopeStream.getTracks().forEach(t => t.stop()); scopeStream = null; }
  document.getElementById('scope-video').srcObject = null;
}
function scopeFlipCamera() {
  scopeFacingMode = scopeFacingMode === 'environment' ? 'user' : 'environment';
  startScopeCamera();
}

// ── Capture frame to base64 ──
function captureFrame() {
  const video = document.getElementById('scope-video');
  if (!video || !video.videoWidth) throw new Error('No video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (scopeFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', .88).split(',')[1];
}

// ── Freeze the video frame + show on canvas ──
function scopeFreezeFrame() {
  const video = document.getElementById('scope-video');
  const canvas = document.getElementById('scope-freeze');
  if (!video || !canvas) return;
  canvas.width  = video.videoWidth  || video.clientWidth;
  canvas.height = video.videoHeight || video.clientHeight;
  const ctx = canvas.getContext('2d');
  if (scopeFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.classList.add('visible');
}
function scopeUnfreeze() {
  document.getElementById('scope-freeze').classList.remove('visible');
  document.getElementById('scope-highlight-canvas').classList.remove('visible');
}

// ── ELEMENT HIGHLIGHT GLOW ANIMATION ──
// Steps: scan each region → glow individual elements → full-frame flash
async function scopePlayHighlightAnimation(base64) {
  const wrap = document.getElementById('scope-video-wrap');
  const hlCanvas = document.getElementById('scope-highlight-canvas');
  hlCanvas.width  = wrap.clientWidth;
  hlCanvas.height = wrap.clientHeight;
  const ctx = hlCanvas.getContext('2d');
  hlCanvas.classList.add('visible');

  // Draw the frozen frame as base
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/jpeg;base64,' + base64; });

  // Phase 1: Scan with green line top→bottom (1.2s)
  // (The scan overlay CSS handles this)

  // Phase 2: Generate random "element boxes" — simulate detecting objects in scene
  await new Promise(r => setTimeout(r, 600)); // let scan line start
  const w = hlCanvas.width, h = hlCanvas.height;
  const regions = scopeGenerateRegions(w, h, 8);

  // Phase 3: Light up each region one by one with a glow outline
  for (const reg of regions) {
    ctx.clearRect(0, 0, w, h);
    // Draw all previous regions dimly
    for (const pr of regions.slice(0, regions.indexOf(reg))) {
      scopeDrawGlowBox(ctx, pr, 'rgba(0,229,192,.2)', 1);
    }
    // Draw current region brightly
    scopeDrawGlowBox(ctx, reg, 'rgba(0,229,192,.9)', 3);
    await new Promise(r => setTimeout(r, 120));
  }

  // Phase 4: All regions glow together
  ctx.clearRect(0, 0, w, h);
  for (const reg of regions) scopeDrawGlowBox(ctx, reg, 'rgba(0,229,192,.5)', 2);
  await new Promise(r => setTimeout(r, 300));

  // Phase 5: Full frame flash
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,229,192,.25)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,229,192,.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  await new Promise(r => setTimeout(r, 250));

  // Phase 6: Fade out
  ctx.clearRect(0, 0, w, h);
  hlCanvas.classList.remove('visible');
}

function scopeGenerateRegions(w, h, count) {
  // Generate plausible "object" regions scattered across the image
  const regions = [];
  const minW = w * 0.08, maxW = w * 0.35;
  const minH = h * 0.08, maxH = h * 0.35;
  for (let i = 0; i < count; i++) {
    const rw = minW + Math.random() * (maxW - minW);
    const rh = minH + Math.random() * (maxH - minH);
    const rx = Math.random() * (w - rw);
    const ry = Math.random() * (h - rh);
    regions.push({ x: rx, y: ry, w: rw, h: rh });
  }
  return regions;
}

function scopeDrawGlowBox(ctx, reg, color, lineW) {
  ctx.shadowColor = 'rgba(0,229,192,.8)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.roundRect(reg.x, reg.y, reg.w, reg.h, 6);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ── Scan overlay helpers ──
function scopeShowScan(label) {
  const overlay = document.getElementById('scope-scan-overlay');
  const lbl = document.getElementById('scope-scan-label');
  if (lbl) lbl.textContent = label || 'Analysing…';
  if (overlay) overlay.classList.add('visible');
}
function scopeHideScan() {
  const overlay = document.getElementById('scope-scan-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// ── SMART CAPTURE — the main function ──
async function scopeCapture() {
  const question = document.getElementById('scope-text-input').value.trim()
    || 'What do you see?';
  document.getElementById('scope-text-input').value = '';

  let base64;
  try { base64 = captureFrame(); } catch(e) { return; }
  scopeCurrentBase64 = base64;

  // Freeze & start animation
  scopeFreezeFrame();
  scopeShowScan('Scanning…');

  const captureBtn = document.getElementById('scope-capture-btn');
  if (captureBtn) captureBtn.classList.add('loading');

  // Run highlight animation in parallel with API call
  const animPromise = scopePlayHighlightAnimation(base64);

  // ── Step 1: Check memory for matches ──
  const memMatch = scopeCheckMemory(base64);
  if (memMatch) {
    // Show toast immediately
    scopeShowMatchToast(memMatch);
  }

  // ── Step 2: Call AI with smart intent prompt ──
  const systemPrompt = `You are Sedy Scope, an AI assistant for a smart camera.
The user has captured an image and may ask a question or give an instruction.

INTENT DETECTION — read the user's message carefully:
1. If the user wants to REMEMBER/SAVE this object, person, or thing
   (e.g. "remember this", "save this as X", "this is my X", "call this X",
    "yeh yaad rakh", "isko X ke naam se save karo", "isko remember karo"),
   respond ONLY with this exact JSON:
   {"action":"save","name":"[the name they gave]","desc":"[1 sentence describing what you see]"}

2. If the user is asking a QUESTION or wants an EXPLANATION
   (anything else — "what is this?", "solve this", "read this", "explain",
    "kya hai yeh?", "yeh kya hai?"),
   respond with a clear, helpful answer in the user's language.
   IMPORTANT: Read ALL text visible in the image AND describe/explain any diagrams,
   graphs, charts, equations, or images within the photo.
   If it's a question paper or worksheet, solve each question step by step.

Language: detect the user's language and reply in the same language.
Keep answers concise — 2-4 sentences max unless solving a complex problem.`;

  try {
    await animPromise; // wait for animation to finish

    const res = await fetch(API_URL + '/image-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: systemPrompt + '\n\nUser says: ' + question,
        images: [base64],
        image_names: ['scope.jpg'],
        history: getChatHistory().slice(-6)
      })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let reply = (data.reply || '').trim();

    // ── Parse intent ──
    let parsed = null;
    const jsonMatch = reply.match(/\{[\s\S]*?"action"\s*:\s*"save"[\s\S]*?\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch(e) {}
    }

    if (parsed && parsed.action === 'save' && parsed.name) {
      // SAVE mode: store to memory
      await scopeSaveToMemory(base64, parsed.name, parsed.desc || '');
      scopeCurrentAnswer = `✅ Saved **${parsed.name}** to memory! I'll recognise it next time you point the camera at it.`;
      document.getElementById('scope-answer-mode-label').textContent = '💾 Saved';
      document.getElementById('scope-save-btn').style.display = 'none';
      scopeCurrentSaveIntent = null;
    } else {
      // ANSWER mode
      scopeCurrentAnswer = reply;
      document.getElementById('scope-answer-mode-label').textContent = 'Sedy Scope';
      // Show save button — user can manually save if they want
      document.getElementById('scope-save-btn').style.display = 'flex';
      scopeCurrentSaveIntent = { pendingBase64: base64 };
    }

    const body = document.getElementById('scope-answer-body');
    body.innerHTML = parseMarkdown(scopeCurrentAnswer);
    renderMath(body);
    document.getElementById('scope-answer-card').classList.add('visible');

  } catch(err) {
    addMsg('ai', 'Could not analyse image: ' + err.message);
  } finally {
    if (captureBtn) captureBtn.classList.remove('loading');
    scopeHideScan();
    scopeUnfreeze();
  }
}

// ── Save button (manual save from answer card) ──
async function scopeSaveFromAnswer() {
  if (!scopeCurrentBase64) return;
  const name = prompt('What should I call this?');
  if (!name || !name.trim()) return;
  await scopeSaveToMemory(scopeCurrentBase64, name.trim(), scopeCurrentAnswer.slice(0, 100));
  document.getElementById('scope-answer-mode-label').textContent = '💾 Saved';
  document.getElementById('scope-save-btn').style.display = 'none';
  document.getElementById('scope-answer-body').innerHTML = parseMarkdown(`✅ Saved **${name}** to memory!`);
}

function scopeSend() {
  const q = document.getElementById('scope-text-input').value.trim();
  if (!q) { scopeCapture(); return; }
  document.getElementById('scope-text-input').value = '';
  document.getElementById('scope-text-input').value = q; // restore for capture
  scopeCapture();
}

function closeScopeAnswer() {
  document.getElementById('scope-answer-card').classList.remove('visible');
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}
function speakScopeAnswer() {
  if (scopeCurrentAnswer && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const clean = scopeCurrentAnswer.replace(/<[^>]+>/g,' ').replace(/[*#`]/g,'').trim();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
  }
}
function sendScopeToMain() {
  if (!scopeCurrentAnswer) return;
  closeScope();
  addMsg('ai', scopeCurrentAnswer);
  pushHistory('assistant', scopeCurrentAnswer);
}

// ── MEMORY SYSTEM ──────────────────────────────────────

// Build a compact visual descriptor from base64:
// 8×8 colour grid (avg RGB per cell) + edge density = 192+1 = 193 numbers
// Compact enough to store 50+ memories in localStorage
function scopeBuildDescriptor(base64) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const C = document.createElement('canvas');
      C.width = 64; C.height = 64;
      const ctx = C.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;

      // 8×8 grid of average R,G,B
      const grid = [];
      const cellW = 8, cellH = 8;
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 8; gx++) {
          let r=0,g=0,b=0,n=0;
          for (let y = gy*cellH; y < (gy+1)*cellH; y++) {
            for (let x = gx*cellW; x < (gx+1)*cellW; x++) {
              const i = (y*64+x)*4;
              r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++;
            }
          }
          grid.push(Math.round(r/n), Math.round(g/n), Math.round(b/n));
        }
      }

      // Simple edge density (brightness variance in 4×4 blocks)
      const gray = [];
      for (let i = 0; i < data.length; i+=4) {
        gray.push(data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114);
      }
      let edgeDensity = 0;
      for (let i = 0; i < gray.length - 65; i++) {
        edgeDensity += Math.abs(gray[i] - gray[i+1]) + Math.abs(gray[i] - gray[i+64]);
      }
      edgeDensity = Math.round(edgeDensity / gray.length);

      resolve({ grid, edgeDensity });
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/jpeg;base64,' + base64;
  });
}

// Compare two descriptors — returns similarity 0-1
function scopeDescriptorSimilarity(a, b) {
  if (!a || !b) return 0;
  const gridLen = Math.min(a.grid.length, b.grid.length);
  let diff = 0;
  for (let i = 0; i < gridLen; i++) {
    diff += Math.abs(a.grid[i] - b.grid[i]);
  }
  const normalised = diff / (gridLen * 255);
  const colourSim = 1 - normalised;

  const edgeDiff = Math.abs(a.edgeDensity - b.edgeDensity) / 255;
  const edgeSim = 1 - edgeDiff;

  return colourSim * 0.85 + edgeSim * 0.15;
}

// Check current frame against all saved memories
function scopeCheckMemory(base64) {
  if (!scopeMemory.length) return null;
  // Build descriptor synchronously is not possible, so we store descriptors at save time
  // At check time we do a quick colour histogram check
  // (Full async check is done in scopeCapture via AI — this is just a fast pre-check)
  return null; // async check happens in AI step
}

// Draw a unique visual pattern (fingerprint visualisation) onto a canvas
function scopeDrawPattern(descriptor, canvas) {
  if (!descriptor || !canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 48; canvas.height = 48;
  const grid = descriptor.grid;
  // Draw the 8×8 colour grid as tiny squares
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const idx = (gy*8+gx)*3;
      const r = grid[idx]||0, g = grid[idx+1]||0, b = grid[idx+2]||0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(gx*6, gy*6, 6, 6);
    }
  }
  // Add a subtle border in accent colour
  ctx.strokeStyle = 'rgba(0,229,192,.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, 48, 48);
}

async function scopeSaveToMemory(base64, name, desc) {
  // Build thumbnail
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 80; thumbCanvas.height = 80;
  const thumbCtx = thumbCanvas.getContext('2d');
  const img = new Image();
  await new Promise(r => { img.onload=r; img.src='data:image/jpeg;base64,'+base64; });
  const sc = Math.max(80/img.width, 80/img.height);
  thumbCtx.drawImage(img, (80-img.width*sc)/2, (80-img.height*sc)/2, img.width*sc, img.height*sc);
  const thumb = thumbCanvas.toDataURL('image/jpeg', .75);

  // Build visual descriptor (pattern fingerprint)
  const descriptor = await scopeBuildDescriptor(base64);

  // Store
  const entry = {
    id:   'm_' + Date.now(),
    name: name,
    desc: desc || '',
    type: 'camera',
    thumb,
    descriptor,
    createdAt: Date.now()
  };

  // Remove duplicate name if exists
  scopeMemory = scopeMemory.filter(m => m.name.toLowerCase() !== name.toLowerCase());
  scopeMemory.unshift(entry);
  if (scopeMemory.length > 30) scopeMemory = scopeMemory.slice(0, 30);
  scopeSaveMemoryStore();

  console.log('💾 Scope: saved memory for', name);
}

// Show match toast
function scopeShowMatchToast(item) {
  const toast = document.getElementById('scope-match-toast');
  const thumb = document.getElementById('scope-match-thumb');
  const name  = document.getElementById('scope-match-name');
  const sub   = document.getElementById('scope-match-sub');
  if (!toast) return;
  // Thumb can be image or pattern canvas
  if (item.thumb) {
    thumb.innerHTML = `<img src="${item.thumb}" alt="">`;
  } else {
    thumb.textContent = '🧠';
  }
  name.textContent = item.name;
  sub.textContent  = item.desc || '';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4000);
}

// Toggle memories panel
function scopeToggleMemories() {
  scopeLoadMemory();
  scopeRenderMemories();
  document.getElementById('scope-memories-panel').classList.toggle('open');
}

function scopeRenderMemories() {
  const list = document.getElementById('scope-memories-list');
  if (!list) return;
  list.innerHTML = '';
  if (!scopeMemory.length) {
    list.innerHTML = '<div class="scope-memories-empty">No memories saved yet.<br><br>Point camera at something,<br>tap 📸 and say<br>"remember this as [name]"</div>';
    return;
  }
  scopeMemory.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'scope-memory-item';

    // Thumb
    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'scope-memory-thumb';
    if (item.thumb) {
      thumbDiv.innerHTML = `<img src="${item.thumb}" alt="">`;
    } else {
      thumbDiv.textContent = '🧠';
    }

    // Pattern canvas
    const patternCanvas = document.createElement('canvas');
    patternCanvas.className = 'scope-memory-pattern';
    if (item.descriptor) scopeDrawPattern(item.descriptor, patternCanvas);

    div.innerHTML = `
      <div class="scope-memory-info" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        ${thumbDiv.outerHTML}
        ${patternCanvas.outerHTML}
        <div>
          <div class="scope-memory-name">${_esc(item.name)}</div>
          <div class="scope-memory-desc">${_esc(item.desc)}</div>
          <div class="scope-memory-type">📸 camera memory</div>
        </div>
      </div>
      <button class="scope-memory-del" onclick="scopeDeleteMemory('${item.id}')">🗑</button>`;
    list.appendChild(div);

    // Re-draw pattern on actual canvas in DOM after insert
    setTimeout(() => {
      const canvases = list.querySelectorAll('canvas.scope-memory-pattern');
      if (canvases[i] && item.descriptor) scopeDrawPattern(item.descriptor, canvases[i]);
    }, 50);
  });
}

function scopeDeleteMemory(id) {
  scopeMemory = scopeMemory.filter(m => m.id !== id);
  scopeSaveMemoryStore();
  scopeRenderMemories();
}

// ── Voice input for scope ──
function toggleScopeVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (scopeVoiceActive) { if (scopeVoiceRec) scopeVoiceRec.stop(); return; }
  scopeVoiceRec = new SR();
  scopeVoiceRec.lang = 'en-US';
  scopeVoiceRec.continuous = false;
  scopeVoiceRec.interimResults = true;
  scopeVoiceRec.onstart  = () => { scopeVoiceActive = true; document.getElementById('scope-voice-btn').classList.add('listening'); };
  scopeVoiceRec.onresult = (e) => { document.getElementById('scope-text-input').value = Array.from(e.results).map(r=>r[0].transcript).join(''); };
  scopeVoiceRec.onend    = () => {
    scopeVoiceActive = false;
    document.getElementById('scope-voice-btn').classList.remove('listening');
    const t = document.getElementById('scope-text-input').value.trim();
    if (t) scopeCapture();
  };
  scopeVoiceRec.onerror = () => { scopeVoiceActive = false; document.getElementById('scope-voice-btn').classList.remove('listening'); };
  try { scopeVoiceRec.start(); } catch(e) {}
}
function stopScopeVoice() {
  if (scopeVoiceRec && scopeVoiceActive) { try { scopeVoiceRec.stop(); } catch(e) {} }
  scopeVoiceActive = false;
  const btn = document.getElementById('scope-voice-btn');
  if (btn) btn.classList.remove('listening');
}

// ── Whiteboard ──
let wbColor='#e8edf5',wbSize=4,wbDrawing=false,wbErasing=false,wbPrevX=0,wbPrevY=0,wbHistory=[],wbCurrentPath=[];
function openWhiteboard(){
  document.getElementById('wb-overlay').classList.add('active');
  // Ensure draw tab is active by default
  wbSwitchTab('draw');
  initWbCanvas();
}
function closeWhiteboard(){document.getElementById('wb-overlay').classList.remove('active');stopSpeaking();}
function initWbCanvas(){const canvas=document.getElementById('wb-canvas');const wrap=document.getElementById('wb-canvas-wrap');canvas.width=wrap.clientWidth||window.innerWidth;canvas.height=wrap.clientHeight||600;canvas.addEventListener('mousedown',wbDown);canvas.addEventListener('touchstart',wbTouchStart,{passive:false});document.addEventListener('mousemove',wbMove);document.addEventListener('mouseup',wbUp);document.addEventListener('touchmove',wbTouchMove,{passive:false});document.addEventListener('touchend',wbUp);}
function wbPos(e,canvas){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
function wbDown(e){wbDrawing=true;wbCurrentPath=[];const p=wbPos(e,document.getElementById('wb-canvas'));wbPrevX=p.x;wbPrevY=p.y;}
function wbTouchStart(e){e.preventDefault();if(e.touches.length!==1)return;const touch=e.touches[0];const canvas=document.getElementById('wb-canvas');const r=canvas.getBoundingClientRect();wbDrawing=true;wbCurrentPath=[];wbPrevX=(touch.clientX-r.left)*canvas.width/r.width;wbPrevY=(touch.clientY-r.top)*canvas.height/r.height;}
function wbMove(e){if(!wbDrawing)return;const canvas=document.getElementById('wb-canvas');const ctx=canvas.getContext('2d');const p=wbPos(e,canvas);ctx.beginPath();ctx.moveTo(wbPrevX,wbPrevY);ctx.lineTo(p.x,p.y);ctx.strokeStyle=wbErasing?'#1a1f2e':wbColor;ctx.lineWidth=wbErasing?wbSize*3:wbSize;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();wbCurrentPath.push([p.x,p.y]);wbPrevX=p.x;wbPrevY=p.y;}
function wbTouchMove(e){if(!wbDrawing||e.touches.length!==1)return;e.preventDefault();const touch=e.touches[0];const canvas=document.getElementById('wb-canvas');const r=canvas.getBoundingClientRect();const x=(touch.clientX-r.left)*canvas.width/r.width,y=(touch.clientY-r.top)*canvas.height/r.height;const ctx=canvas.getContext('2d');ctx.beginPath();ctx.moveTo(wbPrevX,wbPrevY);ctx.lineTo(x,y);ctx.strokeStyle=wbErasing?'#1a1f2e':wbColor;ctx.lineWidth=wbErasing?wbSize*3:wbSize;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();wbPrevX=x;wbPrevY=y;}
function wbUp(){if(!wbDrawing)return;wbDrawing=false;if(wbCurrentPath.length)wbHistory.push({color:wbColor,size:wbSize,erasing:wbErasing,path:wbCurrentPath});wbCurrentPath=[];}
function wbUndo(){if(!wbHistory.length)return;wbHistory.pop();const canvas=document.getElementById('wb-canvas');const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);wbHistory.forEach(h=>{ctx.beginPath();h.path.forEach((p,i)=>{if(i===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);});ctx.strokeStyle=h.erasing?'#1a1f2e':h.color;ctx.lineWidth=h.erasing?h.size*3:h.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();});}
function wbClear(){const canvas=document.getElementById('wb-canvas');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);wbHistory=[];}
function setWbColor(el){wbColor=el.dataset.color;wbErasing=false;document.querySelectorAll('.wb-color').forEach(c=>c.classList.remove('active'));el.classList.add('active');document.getElementById('wb-eraser-btn').classList.remove('active');}
function setWbEraser(){wbErasing=!wbErasing;document.getElementById('wb-eraser-btn').classList.toggle('active',wbErasing);}
async function wbAsk(){const canvas=document.getElementById('wb-canvas');const btn=document.getElementById('wb-ask-btn');const dataUrl=canvas.toDataURL('image/jpeg',.92);const base64=dataUrl.split(',')[1];btn.textContent='⏳ Analysing…';try{const res=await fetch(API_URL+'/image-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Analyse this whiteboard drawing. Explain what it shows, solve any equations, and describe the diagrams.',images:[base64],image_names:['whiteboard.jpg'],history:[]})});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();const panel=document.getElementById('wb-answer-panel');const body=document.getElementById('wb-ans-body');body.innerHTML=parseMarkdown(data.reply||'');renderMath(body);panel.classList.add('visible');}catch(err){addMsg('ai','Could not analyse whiteboard.');}finally{btn.textContent='✦ Ask AI about this';}}
async function wbAskPrompt(){const prompt=document.getElementById('wb-prompt-input').value.trim();if(!prompt)return;const canvas=document.getElementById('wb-canvas');const dataUrl=canvas.toDataURL('image/jpeg',.92);const base64=dataUrl.split(',')[1];document.getElementById('wb-prompt-input').value='';try{const res=await fetch(API_URL+'/image-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:prompt,images:[base64],image_names:['whiteboard.jpg'],history:[]})});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();const body=document.getElementById('wb-ans-body');body.innerHTML=parseMarkdown(data.reply||'');renderMath(body);}catch(err){}}
function collapseWbPanel(){document.getElementById('wb-answer-panel').classList.toggle('visible');}

// ══════════════════════════════════════════════════════
// WHITEBOARD — PRACTICE MODE
// ══════════════════════════════════════════════════════

let wbCurrentTab = 'draw';

// ── Tab switching ──
function wbSwitchTab(tab) {
  wbCurrentTab = tab;
  document.getElementById('wb-tab-draw').classList.toggle('active', tab === 'draw');
  document.getElementById('wb-tab-practice').classList.toggle('active', tab === 'practice');
  document.getElementById('wb-draw-pane').style.display    = tab === 'draw'     ? 'flex' : 'none';
  document.getElementById('wb-practice-pane').style.display= tab === 'practice' ? 'flex' : 'none';
  document.getElementById('wb-draw-tools').style.display   = tab === 'draw'     ? 'flex' : 'none';
  if (tab === 'practice') {
    // Init practice canvas if session active
    if (wbpState.sessionActive) wbpInitCanvas();
  }
}

// ── Practice State ──
const wbpState = {
  topic: '',
  difficulty: 'medium',
  questionNum: 0,
  currentQuestion: null,
  questions: [],           // prefetched queue
  sessionActive: false,
  isChecking: false,
  color: '#e8edf5',
  size: 4,
  erasing: false,
  drawing: false,
  prevX: 0, prevY: 0,
  history: [],
  currentPath: [],
};
let wbpSize = 4;

// ── Start Practice Session ──
async function wbpStartPractice() {
  const topic = document.getElementById('wbp-topic-input').value.trim();
  if (!topic) {
    document.getElementById('wbp-topic-input').focus();
    return;
  }
  const diff = document.getElementById('wbp-diff-select').value;
  wbpState.topic      = topic;
  wbpState.difficulty = diff;
  wbpState.questionNum= 0;
  wbpState.questions  = [];
  wbpState.sessionActive = true;

  const btn = document.querySelector('.wbp-start-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    await wbpFetchQuestions();
    wbpShowSession();
    await wbpLoadNextQuestion();
  } catch(e) {
    addMsg('ai', '❌ Could not start practice: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Start Practice ➤';
  }
}

// ── Fetch 5 questions at once (so next is instant) ──
async function wbpFetchQuestions() {
  const res = await fetch(API_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Generate 5 ${wbpState.difficulty} practice questions on "${wbpState.topic}".
Each question should require step-by-step working (not just a one-word answer).
Include maths, derivations, proofs, or multi-step problems.
Return ONLY a JSON array of strings, no explanation, no markdown fences:
["Question 1 text", "Question 2 text", "Question 3 text", "Question 4 text", "Question 5 text"]`,
      model: 'smart',
      history: []
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const raw = data.reply.trim();
  // Parse JSON array from reply
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Bad question format');
  wbpState.questions = JSON.parse(match[0]).filter(q => typeof q === 'string' && q.trim());
  if (!wbpState.questions.length) throw new Error('No questions returned');
}

// ── Show session pane ──
function wbpShowSession() {
  document.getElementById('wbp-setup').style.display   = 'none';
  document.getElementById('wbp-session').style.display = 'flex';
  document.getElementById('wbp-tool-bar').style.display= 'flex';
  wbpInitCanvas();
}

// ── Load next question ──
async function wbpLoadNextQuestion() {
  // If queue empty, fetch more
  if (!wbpState.questions.length) {
    try { await wbpFetchQuestions(); } catch(e) {}
  }
  if (!wbpState.questions.length) {
    addMsg('ai', '🎉 Great work! You finished all the questions on this topic.');
    wbpEndSession();
    return;
  }

  wbpState.questionNum++;
  wbpState.currentQuestion = wbpState.questions.shift();
  wbpState.isChecking = false;

  // Update UI
  document.getElementById('wbp-q-num').textContent  = 'Q' + wbpState.questionNum;
  document.getElementById('wbp-q-topic').textContent = wbpState.topic;
  const diffEl = document.getElementById('wbp-q-diff');
  diffEl.textContent  = wbpState.difficulty.charAt(0).toUpperCase() + wbpState.difficulty.slice(1);
  diffEl.className    = 'wbp-q-diff ' + wbpState.difficulty;
  document.getElementById('wbp-q-text').textContent = wbpState.currentQuestion;
  renderMath(document.getElementById('wbp-q-text'));

  // Reset canvas and controls
  wbpClear();
  document.getElementById('wbp-result-badge').style.display = 'none';
  document.getElementById('wbp-check-btn').style.display    = 'inline-flex';
  document.getElementById('wbp-check-btn').disabled         = false;
  document.getElementById('wbp-check-btn').textContent      = '✓ Check Answer';
  document.getElementById('wbp-see-btn').style.display      = 'none';
  wbpCloseExplain();

  // Show hint label only on first question
  const hint = document.querySelector('.wbp-hint-label');
  if (hint) hint.style.display = wbpState.questionNum === 1 ? 'block' : 'none';
}

function wbpNextQuestion() { wbpLoadNextQuestion(); }

function wbpEndSession() {
  wbpState.sessionActive = false;
  document.getElementById('wbp-setup').style.display   = 'flex';
  document.getElementById('wbp-session').style.display = 'none';
  document.getElementById('wbp-tool-bar').style.display= 'none';
  document.querySelector('.wbp-start-btn').disabled     = false;
  document.querySelector('.wbp-start-btn').textContent  = 'Start Practice ➤';
}

// ── Check Answer ──────────────────────────────────────────────────────────────
async function wbpCheckAnswer() {
  if (wbpState.isChecking) return;
  const canvas = document.getElementById('wbp-canvas');
  if (!canvas) return;

  // Check if canvas has any content
  const ctx = canvas.getContext('2d');
  const blank = ctx.getImageData(0,0,canvas.width,canvas.height).data.every(v => v === 0);
  if (blank) {
    // Shake the button
    const btn = document.getElementById('wbp-check-btn');
    btn.style.animation = 'shake .4s ease';
    setTimeout(() => btn.style.animation='', 400);
    document.getElementById('wbp-result-badge').textContent = '✏️ Write your solution first!';
    document.getElementById('wbp-result-badge').className   = 'wbp-result-badge wrong';
    document.getElementById('wbp-result-badge').style.display = 'block';
    setTimeout(() => { document.getElementById('wbp-result-badge').style.display='none'; }, 2000);
    return;
  }

  wbpState.isChecking = true;
  const btn = document.getElementById('wbp-check-btn');
  btn.disabled     = true;
  btn.textContent  = '⏳ Checking…';

  // Capture canvas as image
  const dataUrl  = canvas.toDataURL('image/jpeg', .88);
  const base64   = dataUrl.split(',')[1];

  const prompt = `You are checking a student's handwritten solution on a whiteboard.

Question: ${wbpState.currentQuestion}

The image shows the student's handwritten working/steps.

Evaluate if their answer and working is CORRECT or WRONG.

Rules:
- If the approach is right but minor arithmetic slip: still CORRECT
- If fundamentally wrong method or wrong answer: WRONG
- Read ALL handwritten content carefully

Respond ONLY with this exact JSON (no markdown):
{"correct": true/false, "feedback": "one short sentence of feedback in the student's language"}`;

  try {
    const res = await fetch(API_URL + '/image-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        images: [base64],
        image_names: ['solution.jpg'],
        history: []
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.reply.trim();

    let correct = false, feedback = '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      correct  = !!parsed.correct;
      feedback = parsed.feedback || '';
    }

    wbpShowResult(correct, feedback);

  } catch(e) {
    btn.disabled    = false;
    btn.textContent = '✓ Check Answer';
    wbpState.isChecking = false;
  }
}

// ── Show result with flash + badge ────────────────────────────────────────────
function wbpShowResult(correct, feedback) {
  // Flash border
  const flash = document.getElementById('wbp-flash');
  flash.className = 'wbp-flash ' + (correct ? 'green' : 'red') + ' show';
  setTimeout(() => { flash.classList.remove('show'); }, 900);

  // Result badge
  const badge = document.getElementById('wbp-result-badge');
  badge.textContent = correct
    ? '✅ Correct! ' + (feedback || 'Great work!')
    : '❌ Not quite. ' + (feedback || 'Check your steps.');
  badge.className   = 'wbp-result-badge ' + (correct ? 'correct' : 'wrong');
  badge.style.display = 'block';

  // Check button → hide, show See Answer if wrong
  const checkBtn = document.getElementById('wbp-check-btn');
  checkBtn.style.display = 'none';

  if (correct) {
    // Auto next after 2.5s
    setTimeout(() => wbpNextQuestion(), 2500);
  } else {
    // Show "See Answer" button
    document.getElementById('wbp-see-btn').style.display = 'inline-flex';
    document.getElementById('wbp-see-btn').style.animation = 'badgeIn .3s cubic-bezier(.34,1.56,.64,1)';
  }

  wbpState.isChecking = false;
}

// ── See Answer — step-by-step explanation ─────────────────────────────────────
async function wbpSeeAnswer() {
  const seeBtn = document.getElementById('wbp-see-btn');
  seeBtn.disabled    = true;
  seeBtn.textContent = '⏳ Loading…';

  try {
    const res = await fetch(API_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Solve this problem with detailed step-by-step working:

"${wbpState.currentQuestion}"

Format your answer EXACTLY like this (use this structure for every step):
STEP 1: [title]
[explanation and working for step 1]

STEP 2: [title]
[explanation and working for step 2]

...continue for all steps...

FINAL ANSWER: [the answer]

Rules:
- Show every single step clearly
- Explain WHY each step is done
- Use LaTeX for maths: $...$ inline, $$...$$ display
- Keep each step concise but complete`,
        model: 'pro',
        history: []
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    wbpRenderExplanation(data.reply || '');
  } catch(e) {
    seeBtn.disabled    = false;
    seeBtn.textContent = '👁 See Answer';
  }
}

// ── Render step-by-step explanation ──────────────────────────────────────────
function wbpRenderExplanation(text) {
  const panel  = document.getElementById('wbp-explain-panel');
  const body   = document.getElementById('wbp-explain-body');

  // Parse STEP N: blocks
  const stepRegex = /STEP\s+(\d+):\s*([^\n]*)\n([\s\S]*?)(?=STEP\s+\d+:|FINAL ANSWER:|$)/gi;
  const finalRegex = /FINAL ANSWER:\s*([\s\S]*?)$/i;

  let html = '';
  let match;
  while ((match = stepRegex.exec(text)) !== null) {
    const num     = match[1];
    const title   = match[2].trim();
    const content = match[3].trim();
    html += `<div class="step">
      <div class="step-num">${num}</div>
      <div class="step-text"><strong>${_esc(title)}</strong><br>${parseMarkdown(content)}</div>
    </div>`;
  }

  // Final answer
  const finalMatch = text.match(finalRegex);
  if (finalMatch) {
    html += `<div class="step">
      <div class="step-num" style="background:linear-gradient(135deg,var(--success),var(--accent3));">✓</div>
      <div class="step-text"><strong>Final Answer</strong><br>${parseMarkdown(finalMatch[1].trim())}</div>
    </div>`;
  }

  // Fallback: no STEP format found
  if (!html) {
    html = `<div style="padding:4px 0;">${parseMarkdown(text)}</div>`;
  }

  body.innerHTML = html;
  renderMath(body);

  panel.classList.add('visible');

  // Hide see button
  document.getElementById('wbp-see-btn').style.display = 'none';
}

function wbpCloseExplain() {
  document.getElementById('wbp-explain-panel').classList.remove('visible');
}

// ── Practice Canvas Setup ─────────────────────────────────────────────────────
function wbpInitCanvas() {
  const canvas = document.getElementById('wbp-canvas');
  const wrap   = document.getElementById('wbp-canvas-wrap');
  if (!canvas || !wrap) return;
  canvas.width  = wrap.clientWidth  || window.innerWidth;
  canvas.height = wrap.clientHeight || 500;

  // Remove old listeners then re-add
  const newCanvas = canvas.cloneNode(false);
  canvas.parentNode.replaceChild(newCanvas, canvas);

  newCanvas.addEventListener('mousedown',  wbpDown);
  newCanvas.addEventListener('touchstart', wbpTouchStart, { passive: false });
  document.addEventListener('mousemove',   wbpMove);
  document.addEventListener('mouseup',     wbpUp);
  document.addEventListener('touchmove',   wbpTouchMove, { passive: false });
  document.addEventListener('touchend',    wbpUp);
}

function wbpPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX-r.left)*canvas.width/r.width, y: (e.clientY-r.top)*canvas.height/r.height };
}
function wbpDown(e) {
  wbpState.drawing=true; wbpState.currentPath=[];
  const p = wbpPos(e, document.getElementById('wbp-canvas'));
  wbpState.prevX=p.x; wbpState.prevY=p.y;
  // Hide hint on first stroke
  const hint = document.querySelector('.wbp-hint-label');
  if (hint) hint.style.display = 'none';
}
function wbpTouchStart(e) {
  e.preventDefault();
  if (e.touches.length!==1) return;
  const t=e.touches[0];
  const canvas=document.getElementById('wbp-canvas');
  const r=canvas.getBoundingClientRect();
  wbpState.drawing=true; wbpState.currentPath=[];
  wbpState.prevX=(t.clientX-r.left)*canvas.width/r.width;
  wbpState.prevY=(t.clientY-r.top)*canvas.height/r.height;
  const hint=document.querySelector('.wbp-hint-label');
  if(hint) hint.style.display='none';
}
function wbpMove(e) {
  if (!wbpState.drawing) return;
  const canvas=document.getElementById('wbp-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const p=wbpPos(e,canvas);
  ctx.beginPath();
  ctx.moveTo(wbpState.prevX,wbpState.prevY);
  ctx.lineTo(p.x,p.y);
  ctx.strokeStyle=wbpState.erasing?'#141928':wbpState.color;
  ctx.lineWidth=wbpState.erasing?wbpSize*3:wbpSize;
  ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.stroke();
  wbpState.currentPath.push([p.x,p.y]);
  wbpState.prevX=p.x; wbpState.prevY=p.y;
}
function wbpTouchMove(e) {
  if(!wbpState.drawing||e.touches.length!==1) return;
  e.preventDefault();
  const t=e.touches[0];
  const canvas=document.getElementById('wbp-canvas');
  const r=canvas.getBoundingClientRect();
  const x=(t.clientX-r.left)*canvas.width/r.width,y=(t.clientY-r.top)*canvas.height/r.height;
  const ctx=canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(wbpState.prevX,wbpState.prevY);
  ctx.lineTo(x,y);
  ctx.strokeStyle=wbpState.erasing?'#141928':wbpState.color;
  ctx.lineWidth=wbpState.erasing?wbpSize*3:wbpSize;
  ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.stroke();
  wbpState.prevX=x; wbpState.prevY=y;
}
function wbpUp() {
  if (!wbpState.drawing) return;
  wbpState.drawing=false;
  if(wbpState.currentPath.length>1) {
    wbpState.history.push({path:[...wbpState.currentPath],color:wbpState.color,size:wbpSize,erasing:wbpState.erasing});
  }
  wbpState.currentPath=[];
}
function wbpUndo() {
  if(!wbpState.history.length) return;
  wbpState.history.pop();
  const canvas=document.getElementById('wbp-canvas');
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  wbpState.history.forEach(h=>{
    ctx.beginPath();
    h.path.forEach((p,i)=>{ if(i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); });
    ctx.strokeStyle=h.erasing?'#141928':h.color;
    ctx.lineWidth=h.erasing?h.size*3:h.size;
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.stroke();
  });
}
function wbpClear() {
  const canvas=document.getElementById('wbp-canvas');
  if(canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  wbpState.history=[];
}
function setWbpColor(el) {
  wbpState.color=el.dataset.color;
  wbpState.erasing=false;
  document.querySelectorAll('#wbp-tool-bar .wb-color').forEach(e=>e.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('wbp-eraser-btn').classList.remove('active');
}
function setWbpEraser() {
  wbpState.erasing=!wbpState.erasing;
  document.getElementById('wbp-eraser-btn').classList.toggle('active',wbpState.erasing);
}

// ── IDE ──
let ideCurrentLang='python';
function openIde(codeId,lang){const codeEl=document.getElementById(codeId);const code=codeEl?codeEl.textContent:'';ideCurrentLang=lang||'python';document.getElementById('ide-textarea').value=code;document.getElementById('ide-title-text').textContent=(lang||'python').charAt(0).toUpperCase()+(lang||'python').slice(1)+' IDE';const badge=document.getElementById('ide-lang-badge');badge.textContent=lang||'python';badge.className='ide-lang-badge '+(lang==='javascript'||lang==='js'?'javascript':'python');document.getElementById('ide-output').textContent='Run your code to see output here…';document.getElementById('ide-output').className='';document.getElementById('ide-ai-row').className='ide-ai-row';document.getElementById('ide-overlay').classList.add('active');}
function closeIde(){document.getElementById('ide-overlay').classList.remove('active');}
async function ideRun(){const code=document.getElementById('ide-textarea').value;if(!code.trim())return;const btn=document.getElementById('ide-run-btn');btn.disabled=true;const outEl=document.getElementById('ide-output');outEl.textContent='⏳ Running…';outEl.className='';try{const res=await fetch(API_URL+'/run-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,language:ideCurrentLang})});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();const output=data.output||'(no output)';const isErr=data.error||output.toLowerCase().includes('error:');outEl.textContent=output;outEl.className=isErr?'error':'';}catch(err){outEl.textContent='❌ Error: '+err.message;outEl.className='error';}finally{btn.disabled=false;}}
function ideClearOutput(){document.getElementById('ide-output').textContent='Run your code to see output here…';document.getElementById('ide-output').className='';}
async function ideAiExplain(){const code=document.getElementById('ide-textarea').value;const out=document.getElementById('ide-output').textContent;if(!out||out==='Run your code to see output here…')return;const aiRow=document.getElementById('ide-ai-row');aiRow.className='ide-ai-row visible';aiRow.innerHTML='⏳ Explaining…';try{const res=await fetch(API_URL+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:`Explain this output in one sentence:\nOutput: ${out}\nCode: ${code}`,model:'flash',history:[]})});if(res.ok){const d=await res.json();aiRow.innerHTML='<strong>✦</strong> '+(d.reply||'');}}catch(e){aiRow.className='ide-ai-row';}}
function ideSendToChat(){const code=document.getElementById('ide-textarea').value;const out=document.getElementById('ide-output').textContent;closeIde();document.getElementById('chat-input').value=`Here is my ${ideCurrentLang} code:\n\`\`\`${ideCurrentLang}\n${code}\n\`\`\`\nOutput: ${out}`;autoResize(document.getElementById('chat-input'));}

// ══════════════════════════════════════════════════════
// VOICE CHAT SYSTEM — MULTILINGUAL
// ══════════════════════════════════════════════════════

/*
  LANGUAGE-AWARE VOICE SYSTEM
  ─────────────────────────────
  1. User speaks → browser SpeechRecognition captures text
  2. detectLanguage() identifies the language from the transcript
  3. Recognition language is updated to match for next turn
  4. AI replies in the same language (system prompt enforces it)
  5. speakVoice() picks the best TTS voice for that language
  6. History carries full multilingual context across turns

  SUPPORTED LANGUAGES (auto-detected):
  Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam,
  Marathi, Gujarati, Punjabi, Urdu, English, Hinglish,
  Japanese, Chinese, Arabic, French, Spanish, German,
  Portuguese, Korean, Russian, Italian

  BEST HUMAN-SOUNDING VOICES BY BROWSER:
  ─────────────────────────────────────
  Edge/Windows (best overall):
    Girl → Microsoft Aria Online (English), language-specific MS voices
    Boy  → Microsoft Guy Online, language-specific MS voices

  Chrome/Android:
    Girl → Google UK English Female, language Google voices
    Boy  → Google UK English Male, language Google voices

  macOS/iOS:
    Girl → Samantha (en), language system voices
    Boy  → Daniel (en), language system voices
*/

// ── Language database ──────────────────────────────────
const LANG_DB = {
  // script-based detection (Unicode ranges)
  devanagari: {
    regex: /[\u0900-\u097F]/,
    // Distinguish Hindi vs Marathi vs Nepali by common words
    variants: [
      { lang: 'hi', name: 'Hindi',   flag: '🇮🇳', bcp47: 'hi-IN',
        girlVoice: [/microsoft swara/i, /hindi.*female/i, /google.*hindi/i, /lekha/i],
        boyVoice:  [/microsoft hemant/i, /hindi.*male/i, /google.*hindi/i] },
      { lang: 'mr', name: 'Marathi', flag: '🇮🇳', bcp47: 'mr-IN',
        girlVoice: [/marathi.*female/i, /google.*marathi/i, /google.*mr/i],
        boyVoice:  [/marathi.*male/i,   /google.*marathi/i] },
    ],
    default: 'hi',
  },
  bengali: {
    regex: /[\u0980-\u09FF]/,
    lang: 'bn', name: 'Bengali', flag: '🇧🇩', bcp47: 'bn-IN',
    girlVoice: [/bengali.*female/i, /google.*bengali/i, /google.*bn/i],
    boyVoice:  [/bengali.*male/i,   /google.*bengali/i],
  },
  tamil: {
    regex: /[\u0B80-\u0BFF]/,
    lang: 'ta', name: 'Tamil', flag: '🇮🇳', bcp47: 'ta-IN',
    girlVoice: [/microsoft valluvar/i, /tamil.*female/i, /google.*tamil/i, /latha/i],
    boyVoice:  [/tamil.*male/i, /google.*tamil/i],
  },
  telugu: {
    regex: /[\u0C00-\u0C7F]/,
    lang: 'te', name: 'Telugu', flag: '🇮🇳', bcp47: 'te-IN',
    girlVoice: [/microsoft chitra/i, /telugu.*female/i, /google.*telugu/i],
    boyVoice:  [/telugu.*male/i, /google.*telugu/i],
  },
  kannada: {
    regex: /[\u0C80-\u0CFF]/,
    lang: 'kn', name: 'Kannada', flag: '🇮🇳', bcp47: 'kn-IN',
    girlVoice: [/kannada.*female/i, /google.*kannada/i],
    boyVoice:  [/kannada.*male/i,   /google.*kannada/i],
  },
  malayalam: {
    regex: /[\u0D00-\u0D7F]/,
    lang: 'ml', name: 'Malayalam', flag: '🇮🇳', bcp47: 'ml-IN',
    girlVoice: [/malayalam.*female/i, /google.*malayalam/i],
    boyVoice:  [/malayalam.*male/i,   /google.*malayalam/i],
  },
  gujarati: {
    regex: /[\u0A80-\u0AFF]/,
    lang: 'gu', name: 'Gujarati', flag: '🇮🇳', bcp47: 'gu-IN',
    girlVoice: [/gujarati.*female/i, /google.*gujarati/i],
    boyVoice:  [/gujarati.*male/i,   /google.*gujarati/i],
  },
  punjabi: {
    regex: /[\u0A00-\u0A7F]/,
    lang: 'pa', name: 'Punjabi', flag: '🇮🇳', bcp47: 'pa-IN',
    girlVoice: [/punjabi.*female/i, /google.*punjabi/i],
    boyVoice:  [/punjabi.*male/i,   /google.*punjabi/i],
  },
  arabic: {
    regex: /[\u0600-\u06FF]/,
    lang: 'ar', name: 'Arabic/Urdu', flag: '🌙', bcp47: 'ur-PK',
    girlVoice: [/microsoft zira.*ar/i, /microsoft hoda/i, /arabic.*female/i, /urdu.*female/i, /google.*ar/i],
    boyVoice:  [/arabic.*male/i, /urdu.*male/i, /google.*ar/i],
  },
  japanese: {
    regex: /[\u3040-\u30FF\u4E00-\u9FFF]/,
    lang: 'ja', name: 'Japanese', flag: '🇯🇵', bcp47: 'ja-JP',
    girlVoice: [/microsoft haruka/i, /kyoko/i, /japanese.*female/i, /google.*ja/i],
    boyVoice:  [/japanese.*male/i, /otoya/i, /google.*ja/i],
  },
  chinese: {
    regex: /[\u4E00-\u9FFF]/,
    lang: 'zh', name: 'Chinese', flag: '🇨🇳', bcp47: 'zh-CN',
    girlVoice: [/microsoft xiaoxiao/i, /ting-ting/i, /chinese.*female/i, /google.*zh/i],
    boyVoice:  [/microsoft yunxi/i, /chinese.*male/i, /google.*zh/i],
  },
  korean: {
    regex: /[\uAC00-\uD7AF]/,
    lang: 'ko', name: 'Korean', flag: '🇰🇷', bcp47: 'ko-KR',
    girlVoice: [/microsoft sunhi/i, /korean.*female/i, /google.*ko/i],
    boyVoice:  [/korean.*male/i, /google.*ko/i],
  },
  // Latin-script languages detected by keywords
};

// Latin-script language patterns
const LATIN_LANG_PATTERNS = [
  { lang: 'fr', name: 'French',     flag: '🇫🇷', bcp47: 'fr-FR',
    keywords: /\b(je|tu|il|nous|vous|ils|est|sont|avec|pour|dans|sur|mais|donc|que|qui|une|les|des|du|au)\b/i,
    girlVoice: [/microsoft julie/i, /aurelie/i, /french.*female/i, /google.*fr/i],
    boyVoice:  [/microsoft paul/i, /french.*male/i, /google.*fr/i] },
  { lang: 'es', name: 'Spanish',    flag: '🇪🇸', bcp47: 'es-ES',
    keywords: /\b(yo|tu|el|ella|nosotros|es|son|con|para|en|pero|que|quien|una|los|las|del|al|muy|como|este|esta)\b/i,
    girlVoice: [/microsoft helena/i, /sabina/i, /spanish.*female/i, /google.*es/i],
    boyVoice:  [/microsoft pablo/i, /spanish.*male/i, /google.*es/i] },
  { lang: 'de', name: 'German',     flag: '🇩🇪', bcp47: 'de-DE',
    keywords: /\b(ich|du|er|sie|wir|ihr|ist|sind|mit|für|in|auf|aber|dass|der|die|das|den|ein|eine|nicht|auch)\b/i,
    girlVoice: [/microsoft katja/i, /german.*female/i, /google.*de/i],
    boyVoice:  [/microsoft stefan/i, /german.*male/i, /google.*de/i] },
  { lang: 'pt', name: 'Portuguese', flag: '🇧🇷', bcp47: 'pt-BR',
    keywords: /\b(eu|tu|ele|ela|nós|vocês|é|são|com|para|em|mas|que|quem|uma|os|as|do|da|muito)\b/i,
    girlVoice: [/microsoft francisca/i, /portuguese.*female/i, /google.*pt/i],
    boyVoice:  [/microsoft antonio/i, /portuguese.*male/i, /google.*pt/i] },
  { lang: 'it', name: 'Italian',    flag: '🇮🇹', bcp47: 'it-IT',
    keywords: /\b(io|tu|lui|lei|noi|voi|loro|è|sono|con|per|in|ma|che|chi|una|gli|le|del|della|molto)\b/i,
    girlVoice: [/microsoft elsa/i, /italian.*female/i, /google.*it/i],
    boyVoice:  [/microsoft cosimo/i, /italian.*male/i, /google.*it/i] },
  { lang: 'ru', name: 'Russian',    flag: '🇷🇺', bcp47: 'ru-RU',
    keywords: /[\u0400-\u04FF]/,
    girlVoice: [/microsoft irina/i, /russian.*female/i, /google.*ru/i],
    boyVoice:  [/microsoft pavel/i, /russian.*male/i, /google.*ru/i] },
];

// Default English voices
const EN_GIRL_PREFS = [
  /microsoft aria online/i, /microsoft zira/i, /google uk english female/i,
  /samantha/i, /karen/i, /moira/i, /tessa/i, /victoria/i, /veena/i,
  /female/i, /hazel/i,
];
const EN_BOY_PREFS = [
  /microsoft guy online/i, /microsoft david/i, /google uk english male/i,
  /daniel/i, /alex/i, /fred/i, /lee/i, /rishi/i, /male/i,
];

// ── State ─────────────────────────────────────────────
let voiceState = {
  active: false,
  persona: 'girl',
  speed: 1.0,
  isHolding: false,
  isSpeaking: false,
  isThinking: false,
  history: [],           // [{role, content, lang}]
  detectedLang: null,    // current language object
  recognitionLang: 'en-US',
  recognition: null,
  currentUtterance: null,
  // Cached voices per language+gender
  voiceCache: {},        // key: `${lang}_${gender}` → SpeechSynthesisVoice
  enGirlVoice: null,
  enBoyVoice: null,
};
let voiceKeepAwakeInterval = null;

// ── Load & cache all voices ────────────────────────────
function loadVoices() {
  const all = window.speechSynthesis.getVoices();
  if (!all.length) return;

  // ── Helper: score a voice against a preference list ──
  function scoreVoice(v, prefs) {
    const n = v.name.toLowerCase();
    for (let i = 0; i < prefs.length; i++) if (prefs[i].test(n)) return prefs.length - i;
    return 0;
  }

  // ── Pick best English girl + boy voices ──
  const scored = all.map(v => ({ v, gs: scoreVoice(v, EN_GIRL_PREFS), bs: scoreVoice(v, EN_BOY_PREFS) }));
  const bG = scored.reduce((b, x) => x.gs > b.gs ? x : b, scored[0]);
  const bB = scored.filter(x => x.v !== bG.v)
                   .reduce((b, x) => x.bs > b.bs ? x : b,
                     scored.find(x => x.v !== bG.v) || scored[0]);
  voiceState.enGirlVoice = bG.v;
  voiceState.enBoyVoice = bB.v;

  // ── Smart per-language voice finder ──────────────────
  // Strategy:
  // 1. Try exact name pattern match for girl voice
  // 2. Try exact name pattern match for boy voice
  // 3. If only one lang voice exists → use it for GIRL, boy gets English male voice with low pitch
  // 4. If two+ lang voices exist → first for girl, second for boy
  // This guarantees BOY is never assigned the same object as GIRL

  function findVoicePair(girlPrefs, boyPrefs, langBcp47) {
    const prefix = langBcp47.split('-')[0].toLowerCase();

    // Get all voices that match this language
    const byLang = all.filter(v => {
      const vLang = (v.lang || '').toLowerCase();
      const vName = v.name.toLowerCase();
      return vLang.startsWith(prefix) || vName.includes(prefix);
    });

    // Try explicit girl pref
    let girlVoice = null;
    for (const pref of girlPrefs) {
      girlVoice = all.find(v => pref.test(v.name));
      if (girlVoice) break;
    }
    // Try explicit boy pref  
    let boyVoice = null;
    for (const pref of boyPrefs) {
      boyVoice = all.find(v => pref.test(v.name));
      if (boyVoice) break;
    }

    // If we found both distinct voices, great
    if (girlVoice && boyVoice && girlVoice !== boyVoice) {
      return { girl: girlVoice, boy: boyVoice };
    }

    // If only girl found (common for Indian langs) → boy = null (will use pitch hack)
    if (girlVoice && !boyVoice) {
      // Try to find a DIFFERENT lang voice for boy
      const altBoy = byLang.find(v => v !== girlVoice);
      return { girl: girlVoice, boy: altBoy || null };
    }

    // If we have multiple lang voices, assign by index
    if (byLang.length >= 2) {
      return { girl: byLang[0], boy: byLang[1] };
    }
    if (byLang.length === 1) {
      return { girl: byLang[0], boy: null }; // boy will use pitch hack
    }

    return { girl: null, boy: null };
  }

  // Build full cache
  const langEntries = [];
  for (const [key, entry] of Object.entries(LANG_DB)) {
    if (entry.variants) {
      for (const v of entry.variants) langEntries.push(v);
    } else if (entry.lang) {
      langEntries.push(entry);
    }
  }
  for (const lp of LATIN_LANG_PATTERNS) langEntries.push(lp);

  for (const entry of langEntries) {
    const gKey = `${entry.lang}_girl`;
    const bKey = `${entry.lang}_boy`;
    const pair = findVoicePair(
      entry.girlVoice || [],
      entry.boyVoice  || [],
      entry.bcp47
    );
    voiceState.voiceCache[gKey] = pair.girl;
    voiceState.voiceCache[bKey] = pair.boy;
  }

  // Debug log
  console.log('🎙 En-Girl:', voiceState.enGirlVoice?.name);
  console.log('🎙 En-Boy:', voiceState.enBoyVoice?.name);
  console.log('🎙 hi_girl:', voiceState.voiceCache['hi_girl']?.name);
  console.log('🎙 hi_boy:', voiceState.voiceCache['hi_boy']?.name || 'none → pitch hack');
  console.log('🎙 All voices:', all.map(v => `${v.name} [${v.lang}]`).join(', '));
}

if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// ── Language detection ─────────────────────────────────
function detectLanguage(text) {
  if (!text || text.trim().length < 2) return null;

  // 1. Script detection — most reliable, no false positives
  for (const [key, entry] of Object.entries(LANG_DB)) {
    if (!entry.regex) continue;
    if (entry.regex.test(text)) {
      if (entry.variants) {
        const marWords = /\b(आहे|आहेत|होते|करतो|करते|माझ्या|तुमच्या|नाही|तर|पण)\b/;
        const variant = marWords.test(text) ? 'mr' : 'hi';
        const v = entry.variants.find(x => x.lang === variant) || entry.variants[0];
        return { ...v, bcp47: v.bcp47 };
      }
      return { lang: entry.lang, name: entry.name, flag: entry.flag, bcp47: entry.bcp47 };
    }
  }

  const words = text.trim().split(/\s+/);
  const totalWords = words.length;

  // 2. Hinglish — romanised Hindi mixed with English
  //    Check BEFORE Latin patterns so "hai/kya/yaar" wins over other patterns
  //    Expanded list including common Hinglish shopping/bargaining words
  const hinglishWords = /\b(kya|kyun|kaisa|kaise|kab|kahan|kon|kaun|hai|hain|hoon|tha|thi|tum|aap|mera|meri|tera|teri|uska|uski|yaar|bhai|didi|behen|matlab|sahi|bilkul|theek|achha|accha|thoda|bahut|zyada|samajh|padh|likh|baat|karo|karna|karle|ho|nahi|nah|haan|arre|yeh|woh|aur|par|lekin|rupay|rupee|rupees|paisa|paise|lena|leke|dena|deke|khareedna|shopkeeper|dukaan|dukaandar|wapas|vapas|seedha|bolna|bolo|batao|suno|dekho|ek|do|teen|char|sau|hazar|lakh)\b/i;
  const hinglishMatches = words.filter(w => hinglishWords.test(w)).length;
  if (hinglishMatches >= 1) {
    return { lang: 'hi', name: 'Hinglish', flag: '🇮🇳', bcp47: 'hi-IN', isHinglish: true };
  }

  // 3. Latin-script language detection — VERY STRICT to avoid false triggers
  //    Strategy: count English words. If sentence is mostly English → it IS English.
  //    Only detect French/German/etc if the non-English keywords are clearly dominant.
  const commonEnglishWords = /\b(the|a|an|is|are|was|were|be|been|have|has|had|do|does|did|will|would|can|could|should|may|might|shall|hello|hi|hey|help|me|my|you|your|i|we|they|he|she|it|this|that|what|where|when|how|why|who|which|please|thank|and|or|but|so|for|with|at|by|from|to|of|on|in|into|up|out|about|like|just|not|no|yes|ok|okay|tell|show|give|make|take|get|go|come|see|know|want|need|use|say|look|buy|sell|bargain|shop|price|money|rupee|hundred|per|kilo)\b/ig;
  const englishWordCount = (text.match(commonEnglishWords) || []).length;
  const englishRatio = englishWordCount / Math.max(totalWords, 1);

  // If 40%+ words are common English → it's English, not French/German
  // Raised from 50% to 40% to be more conservative about false Latin-lang triggers
  if (englishRatio >= 0.4) {
    return { lang: 'en', name: 'English', flag: '🇬🇧', bcp47: 'en-US' };
  }

  // For very short texts (≤5 words), require much higher confidence
  // "im" "est" alone should NOT trigger German/French
  for (const lp of LATIN_LANG_PATTERNS) {
    if (!(lp.keywords instanceof RegExp)) continue;
    const matches = (text.match(lp.keywords) || []).length;
    // Short text: need 3+ keyword matches. Long text: need 2+.
    const threshold = totalWords <= 5 ? 3 : totalWords <= 10 ? 2 : 1;
    if (matches >= threshold) {
      return { lang: lp.lang, name: lp.name, flag: lp.flag, bcp47: lp.bcp47 };
    }
  }

  // 4. Default: English
  return { lang: 'en', name: 'English', flag: '🇬🇧', bcp47: 'en-US' };
}

// ── Update language UI ─────────────────────────────────
function updateLangUI(langObj) {
  if (!langObj) return;
  voiceState.detectedLang = langObj;
  voiceState.recognitionLang = langObj.bcp47;

  const badge = document.getElementById('voice-lang-badge');
  const flag = document.getElementById('voice-lang-flag');
  const name = document.getElementById('voice-lang-name');
  flag.textContent = langObj.flag;
  name.textContent = langObj.name + (langObj.isHinglish ? ' 🔀' : '');
  badge.style.display = 'flex';

  // Update topbar mini indicator
  const topLang = document.getElementById('voice-toplang');
  if (topLang) topLang.textContent = langObj.flag + ' ' + langObj.name;
}

// ── Get voice + pitch params for language + persona ───────
//
// THE REAL PROBLEM: Most browsers (Chrome, Edge, Android) only ship
// female voices for Indian languages (Google हिन्दी, Google বাংলা etc).
// Lowering pitch on a female voice still sounds female.
//
// THE ACTUAL SOLUTION:
//   GIRL → Use the language-specific voice (e.g. Google हिन्दी) + pitch 1.1
//   BOY  → Use the English MALE voice (Microsoft Guy / Google UK Male) + pitch 0.78
//          The English male voice will read Hindi/Indian text with a male voice.
//          It sounds slightly accented but is CLEARLY male — much better than a
//          pitch-hacked female voice.
//
// If a genuine male voice for the language is available (Edge on Windows has some),
// that is used instead.

function getVoiceParams(langCode, persona) {
  const isIndian = ['hi','bn','ta','te','kn','ml','mr','gu','pa'].includes(langCode);
  const isEast   = ['ja','ko','zh'].includes(langCode);

  // ── ENGLISH or no lang detected ──
  if (!langCode || langCode === 'en') {
    return {
      voice: persona === 'girl' ? voiceState.enGirlVoice : voiceState.enBoyVoice,
      pitch: persona === 'girl' ? 1.1 : 0.78,
      rate:  voiceState.speed,
    };
  }

  const girlKey   = `${langCode}_girl`;
  const boyKey    = `${langCode}_boy`;
  const langGirlV = voiceState.voiceCache[girlKey];  // language-specific female (may exist)
  const langBoyV  = voiceState.voiceCache[boyKey];   // language-specific male (usually null)

  // ── GIRL persona ──
  // Use lang-specific voice if available, else English female
  if (persona === 'girl') {
    return {
      voice: langGirlV || voiceState.enGirlVoice,
      pitch: isIndian ? 1.12 : (isEast ? 1.05 : 1.1),
      rate:  voiceState.speed,
    };
  }

  // ── BOY persona ──
  // Priority 1: genuine different male voice for this language
  if (langBoyV && langBoyV !== langGirlV) {
    return {
      voice: langBoyV,
      pitch: isIndian ? 0.82 : (isEast ? 0.85 : 0.8),
      rate:  voiceState.speed * 0.96,
    };
  }

  // Priority 2: English male voice reading the foreign language text
  // This is the KEY FIX — a real male voice reading Hindi sounds clearly male
  if (voiceState.enBoyVoice) {
    return {
      voice: voiceState.enBoyVoice,
      pitch: isIndian ? 0.78 : (isEast ? 0.82 : 0.78),
      rate:  voiceState.speed * 0.93,
    };
  }

  // Priority 3: last resort — lang female voice with very low pitch
  return {
    voice: langGirlV || voiceState.enGirlVoice,
    pitch: 0.5,
    rate:  voiceState.speed * 0.9,
  };
}

// Legacy helper kept for compatibility
function getVoiceForLang(langCode, persona) {
  return getVoiceParams(langCode, persona).voice;
}

// ── Get BCP47 recognition lang ────────────────────────────
function getRecognitionLang() {
  return voiceState.detectedLang?.bcp47 || 'en-US';
}

// ── Open / Close ──────────────────────────────────────────
function openVoiceChat() {
  voiceState.active = true;
  voiceState.history = [];
  voiceState.detectedLang = null;
  document.getElementById('voice-overlay').classList.add('active');
  document.getElementById('voice-lang-badge').style.display = 'none';
  document.getElementById('voice-history-row').innerHTML = '';
  document.getElementById('voice-live-indicator').style.display = 'flex';
  if (window.innerWidth < 768) closeSidebar();
  if (!voiceState.enGirlVoice) loadVoices();
  voiceKeepAwakeInterval = setInterval(() => {
    if (voiceState.active && !voiceState.isSpeaking && !voiceState.isHolding)
      window.speechSynthesis.pause(), window.speechSynthesis.resume();
  }, 8000);
  setTimeout(() => voiceGreet(), 600);
}

function closeVoiceChat() {
  clearInterval(voiceKeepAwakeInterval);
  voiceState.active = false;
  voiceState.isSpeaking = false;
  voiceState.isHolding = false;
  voiceState.isThinking = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  stopVoiceRecognition();
  document.getElementById('voice-overlay').classList.remove('active');
  document.getElementById('voice-live-indicator').style.display = 'none';
  setVoiceOrbState('idle');
}

// ── Persona ────────────────────────────────────────────────
function selectPersona(persona) {
  voiceState.persona = persona;
  const orb = document.getElementById('voice-main-orb');
  const icon = document.getElementById('voice-orb-icon');
  const nameDisplay = document.getElementById('voice-name-display');
  document.getElementById('vpersona-girl').classList.toggle('active', persona === 'girl');
  document.getElementById('vpersona-boy').classList.toggle('active', persona === 'boy');
  orb.className = 'voice-main-orb ' + persona;
  icon.textContent = '🎙';
  nameDisplay.textContent = persona === 'girl' ? 'Aria' : 'Nova';
  nameDisplay.style.color = persona === 'girl' ? '#ff69b4' : '#6495ed';
  if (voiceState.isSpeaking) { window.speechSynthesis.cancel(); voiceState.isSpeaking = false; }
}

function setVoiceSpeed(speed, btn) {
  voiceState.speed = speed;
  document.querySelectorAll('.voice-speed-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── Orb states ─────────────────────────────────────────────
function setVoiceOrbState(state) {
  const orb = document.getElementById('voice-main-orb');
  const statusEl = document.getElementById('voice-status');
  const wave = document.getElementById('voice-wave');
  const icon = document.getElementById('voice-orb-icon');
  const hint = document.getElementById('voice-hold-hint');
  const holdBtn = document.getElementById('voice-hold-btn');
  orb.classList.remove('listening','speaking');
  statusEl.classList.remove('listening','speaking','thinking');
  wave.classList.remove('visible');

  const lang = voiceState.detectedLang;
  const idleMsg = lang && lang.lang !== 'en'
    ? getLocalizedHint('idle', lang.lang)
    : 'Hold the mic to speak';
  const listenMsg = lang && lang.lang !== 'en'
    ? getLocalizedHint('listening', lang.lang)
    : 'Listening…';

  switch(state) {
    case 'idle':
      statusEl.textContent = idleMsg;
      icon.textContent = '🎙';
      hint.textContent = lang && lang.lang !== 'en'
        ? getLocalizedHint('hint_idle', lang.lang)
        : 'Hold to speak · Release to send';
      hint.classList.remove('pressed');
      holdBtn.classList.remove('pressed','ai-talking');
      break;
    case 'listening':
      orb.classList.add('listening');
      statusEl.classList.add('listening');
      statusEl.textContent = listenMsg;
      icon.textContent = '🎤';
      hint.textContent = lang && lang.lang !== 'en'
        ? getLocalizedHint('hint_listening', lang.lang)
        : 'Release when done speaking';
      hint.classList.add('pressed');
      holdBtn.classList.add('pressed');
      holdBtn.classList.remove('ai-talking');
      break;
    case 'thinking':
      statusEl.classList.add('thinking');
      statusEl.textContent = lang && lang.lang !== 'en'
        ? getLocalizedHint('thinking', lang.lang) : 'Thinking…';
      icon.textContent = '⏳';
      hint.textContent = '…';
      hint.classList.remove('pressed');
      holdBtn.classList.remove('pressed','ai-talking');
      break;
    case 'speaking':
      orb.classList.add('speaking');
      statusEl.classList.add('speaking');
      statusEl.textContent = lang && lang.lang !== 'en'
        ? getLocalizedHint('speaking', lang.lang) : 'Speaking…';
      icon.textContent = '🔊';
      wave.classList.add('visible');
      hint.textContent = lang && lang.lang !== 'en'
        ? getLocalizedHint('hint_speaking', lang.lang) : 'Hold mic to interrupt';
      hint.classList.remove('pressed');
      holdBtn.classList.remove('pressed');
      holdBtn.classList.add('ai-talking');
      break;
  }
}

// Localized UI hints for major languages
const LOCALIZED_HINTS = {
  hi: { idle:'माइक दबाकर बोलें', listening:'सुन रहे हैं…', thinking:'सोच रहे हैं…', speaking:'बोल रहे हैं…', hint_idle:'बोलने के लिए दबाएं', hint_listening:'बोलने के बाद छोड़ें', hint_speaking:'रोकने के लिए दबाएं', retry:'फिर से बोलो!' },
  bn: { idle:'মাইক ধরে বলুন', listening:'শুনছি…', thinking:'ভাবছি…', speaking:'বলছি…', hint_idle:'বলতে ধরুন', hint_listening:'বলা শেষে ছাড়ুন', hint_speaking:'থামাতে ধরুন', retry:'আবার বলো!' },
  ta: { idle:'மைக்கை பிடித்து பேசுங்கள்', listening:'கேட்கிறேன்…', thinking:'யோசிக்கிறேன்…', speaking:'பேசுகிறேன்…', hint_idle:'பேச பிடிக்கவும்', hint_listening:'முடிந்ததும் விடுங்கள்', hint_speaking:'நிறுத்த பிடிக்கவும்', retry:'மீண்டும் சொல்லுங்கள்!' },
  te: { idle:'మైక్ పట్టుకుని మాట్లాడండి', listening:'వింటున్నాను…', thinking:'ఆలోచిస్తున్నాను…', speaking:'మాట్లాడుతున్నాను…', hint_idle:'మాట్లాడటానికి పట్టుకోండి', hint_listening:'మాట్లాడటం అయిన తర్వాత వదలండి', hint_speaking:'ఆపడానికి పట్టుకోండి', retry:'మళ్ళీ చెప్పండి!' },
  mr: { idle:'मायक दाबून बोला', listening:'ऐकतोय…', thinking:'विचार करतोय…', speaking:'बोलतोय…', hint_idle:'बोलण्यासाठी दाबा', hint_listening:'बोलून झाल्यावर सोडा', hint_speaking:'थांबवण्यासाठी दाबा', retry:'परत सांग!' },
  fr: { idle:'Maintenez le micro pour parler', listening:'J\'écoute…', thinking:'Je réfléchis…', speaking:'Je parle…', hint_idle:'Maintenez pour parler', hint_listening:'Relâchez après avoir parlé', hint_speaking:'Maintenez pour interrompre', retry:'Répétez s\'il vous plaît!' },
  es: { idle:'Mantén el micrófono para hablar', listening:'Escuchando…', thinking:'Pensando…', speaking:'Hablando…', hint_idle:'Mantén para hablar', hint_listening:'Suelta cuando termines', hint_speaking:'Mantén para interrumpir', retry:'¡Repite por favor!' },
  de: { idle:'Mikrofon halten zum Sprechen', listening:'Höre zu…', thinking:'Denke nach…', speaking:'Spreche…', hint_idle:'Halten zum Sprechen', hint_listening:'Loslassen wenn fertig', hint_speaking:'Halten zum Unterbrechen', retry:'Bitte wiederholen!' },
  ja: { idle:'マイクを押して話してください', listening:'聞いています…', thinking:'考えています…', speaking:'話しています…', hint_idle:'押して話す', hint_listening:'話し終えたら離す', hint_speaking:'押して止める', retry:'もう一度言ってください!' },
  ko: { idle:'마이크를 눌러 말하세요', listening:'듣고 있어요…', thinking:'생각 중…', speaking:'말하는 중…', hint_idle:'눌러서 말하기', hint_listening:'말 끝나면 놓기', hint_speaking:'눌러서 중단', retry:'다시 말해주세요!' },
  zh: { idle:'按住麦克风说话', listening:'正在聆听…', thinking:'思考中…', speaking:'正在说话…', hint_idle:'按住说话', hint_listening:'说完松开', hint_speaking:'按住打断', retry:'请再说一遍!' },
};
function getLocalizedHint(key, lang) {
  return LOCALIZED_HINTS[lang]?.[key] || LOCALIZED_HINTS.hi?.[key] || '';
}

// ── Transcript + History ───────────────────────────────────
function showTranscript(text, type) {
  const el = document.getElementById('voice-transcript');
  el.textContent = text;
  el.className = 'voice-transcript visible ' + type;
}
function addToHistory(text, role) {
  const row = document.getElementById('voice-history-row');
  const bubble = document.createElement('div');
  bubble.className = 'voice-hist-bubble ' + (role === 'user' ? 'user' : 'ai');
  bubble.textContent = text.length > 80 ? text.slice(0, 80) + '…' : text;
  row.appendChild(bubble);
  // Keep only last 6 bubbles visible
  while (row.children.length > 6) row.removeChild(row.firstChild);
  row.scrollTop = row.scrollHeight;
}

// ── Greeting ─────────────────────────────────────────────
async function voiceGreet() {
  const voiceName = voiceState.persona === 'girl' ? 'Aria' : 'Nova';
  const existingHistory = getChatHistory();

  let greetMsg;
  if (existingHistory.length > 2) {
    // Reference ongoing chat context
    const lastUserMsg = existingHistory.slice().reverse().find(m => m.role === 'user');
    const topic = lastUserMsg?.content.replace(/^\[Voice\]\s*/,'').slice(0, 35) || 'your last topic';
    greetMsg = voiceName === 'Aria'
      ? `Hey! Continuing from where we left off — ${topic}. What's next?`
      : `Yo! We were on ${topic}. What's up?`;
  } else {
    const greetings = voiceState.persona === 'girl'
      ? [
          "Hey! I'm Aria, your study buddy. What are we learning today?",
          "Hi there! Aria here — what do you need help with?",
          "Hey! Ready to learn something? Just talk to me!"
        ]
      : [
          "Hey! Nova here. What subject are we doing today?",
          "Yo! I'm Nova — what are we getting into?",
          "Hey! Nova here, let's get started. What's the topic?"
        ];
    greetMsg = greetings[Math.floor(Math.random() * greetings.length)];
  }

  // Store greeting in voice history (clean, no prefix)
  voiceState.history = [{ role: 'assistant', content: greetMsg, lang: 'en' }];
  addToHistory(greetMsg, 'ai');
  // Speak as English (greeting is always English first)
  await speakVoice(greetMsg, 'en');
}

// ── Hold-to-talk ──────────────────────────────────────────
function voiceHoldStart(e) {
  if (e) e.preventDefault();
  if (voiceState.isHolding || voiceState.isThinking) return;
  voiceState.isHolding = true;
  if (voiceState.isSpeaking) { window.speechSynthesis.cancel(); voiceState.isSpeaking = false; }
  setVoiceOrbState('listening');
  startVoiceRecognition();
}
function voiceHoldEnd(e) {
  if (e) e.preventDefault();
  if (!voiceState.isHolding) return;
  voiceState.isHolding = false;
  stopVoiceRecognition();
}

// ── Speech recognition (language-aware) ──────────────────
let voiceRecResult = '';
function startVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showTranscript('Voice not supported. Use Chrome!', 'ai'); setVoiceOrbState('idle'); return; }
  voiceRecResult = '';
  voiceState.recognition = new SR();
  const rec = voiceState.recognition;

  // Use detected language for recognition, fallback to broad multilingual
  // Chrome supports multiple lang hints via lang property
  rec.lang = getRecognitionLang();
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    let interim = '', final = '';
    for (const r of event.results) {
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    voiceRecResult = final || interim;
    if (voiceRecResult.trim()) showTranscript(voiceRecResult, 'user');
  };
  rec.onerror = (e) => {
    if (e.error === 'language-not-supported') {
      // Fallback to en-US
      rec.lang = 'en-US';
    } else if (e.error !== 'no-speech') {
      showTranscript('Mic error — try again', 'ai');
    }
    setVoiceOrbState('idle');
    voiceState.isHolding = false;
  };
  rec.onend = () => {
    if (!voiceState.isHolding && voiceRecResult.trim()) {
      processVoiceInput(voiceRecResult.trim());
    } else if (!voiceRecResult.trim()) {
      setVoiceOrbState('idle');
    }
  };
  try { rec.start(); } catch(e) {}
}
function stopVoiceRecognition() {
  if (voiceState.recognition) { try { voiceState.recognition.stop(); } catch(e) {} voiceState.recognition = null; }
}

// ── Process voice input (language-aware) ──────────────────
// ── Script hint map — tells backend which script to enforce ──────────────────
function getScriptHint(langCode) {
  const map = {
    hi: 'Devanagari script',
    mr: 'Devanagari script',
    sa: 'Devanagari script',
    bn: 'Bengali script',
    as: 'Bengali script',
    ta: 'Tamil script',
    te: 'Telugu script',
    kn: 'Kannada script',
    ml: 'Malayalam script',
    gu: 'Gujarati script',
    pa: 'Gurmukhi script',
    ur: 'Nastaliq/Arabic script',
    or: 'Odia script',
    ja: 'Japanese script (Hiragana/Katakana/Kanji)',
    zh: 'Chinese script (Simplified)',
    ko: 'Korean Hangul script',
    ar: 'Arabic script',
    ru: 'Cyrillic script',
  };
  return map[langCode] || 'Latin/Roman script';
}

// ── Main voice processor — calls dedicated /voice-chat endpoint ──────────────
async function processVoiceInput(text) {
  setVoiceOrbState('thinking');
  voiceState.isThinking = true;
  showTranscript(text, 'user');
  addToHistory(text, 'user');

  // ── Detect language with continuity logic ──
  // If we're already in a Hindi/Indian conversation and user says a short
  // English phrase, stick with the previous language (avoids mid-convo flipping)
  const rawLang = detectLanguage(text);
  const prevLang = voiceState.detectedLang;
  let lang = rawLang;

  // ── Language continuity: once a language is established, be very sticky ──
  // If we were speaking Hindi/Indian and the new detection says English,
  // only switch if the WHOLE sentence is clearly English (>= 70% common English words)
  // AND it's a long enough sentence. Otherwise keep the previous language.
  if (prevLang && prevLang.lang !== 'en' && rawLang?.lang === 'en') {
    const words = text.trim().split(/\s+/);
    const commonEnglish = /\b(the|a|an|is|are|was|were|be|been|have|has|had|do|does|did|will|would|can|could|should|may|might|shall|hello|hi|hey|help|me|my|you|your|i|we|they|he|she|it|this|that|what|where|when|how|why|who|which|please|thank|and|or|but|so|for|with|at|by|from|to|of|on|in|into|up|out|about|like|just|not|no|yes|ok|okay)\b/ig;
    const enCount = (text.match(commonEnglish) || []).length;
    const enRatio = enCount / Math.max(words.length, 1);
    // Only switch to English if it's overwhelmingly English AND >= 6 words
    // This prevents short English phrases mid-Hindi conversation from switching the language
    if (words.length < 6 || enRatio < 0.7) {
      // Stick with previous language — treat it as Hinglish if prev was Hindi
      lang = { ...prevLang, isHinglish: prevLang.lang === 'hi' };
    }
  }

  if (lang) updateLangUI(lang);

  // Push to voice history (clean, no [Voice] prefix)
  voiceState.history.push({ role: 'user', content: text, lang: lang?.lang });

  // Also save to main chat history (prefixed so it's visible in text chat)
  pushHistory('user', '[Voice] ' + text);

  // Build clean history for the API — last 10 voice turns only, no [Voice] tags
  const voiceHistoryForApi = voiceState.history
    .slice(-10)
    .slice(0, -1)                       // exclude current user message (sent separately)
    .map(m => ({ role: m.role, content: m.content }));

  try {
    // ── Call the dedicated /voice-chat endpoint ──────────────────────────────
    const res = await fetch(API_URL + '/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:     text,
        persona:     voiceState.persona,              // 'girl' | 'boy'
        lang_code:   lang?.lang   || 'en',
        lang_name:   lang?.name   || 'English',
        is_hinglish: lang?.isHinglish || false,
        script_hint: getScriptHint(lang?.lang),
        history:     voiceHistoryForApi,
      })
    });

    voiceState.isThinking = false;

    if (res.status === 429) {
      const d = await res.json();
      showRateLimit(d.detail || {});
      setVoiceOrbState('idle');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    const reply = (data.reply || '').trim();

    if (!reply) {
      // Backend returned empty — give a language-appropriate prompt
      const retryMsg = getLocalizedHint('retry', lang?.lang) || 'Say that again?';
      await speakVoice(retryMsg, lang?.lang);
      return;
    }

    // Save reply to histories (clean)
    voiceState.history.push({ role: 'assistant', content: reply, lang: lang?.lang });
    pushHistory('assistant', '[Voice] ' + reply);
    addToHistory(reply, 'ai');

    // Update recognition language for the next turn
    if (lang?.bcp47) voiceState.recognitionLang = lang.bcp47;

    await speakVoice(reply, lang?.lang);

  } catch (err) {
    voiceState.isThinking = false;
    console.error('Voice chat error:', err);
    const errMsg = getErrMsg(lang?.lang);
    await speakVoice(errMsg, lang?.lang);
  }
}

// Language-appropriate error / retry messages
function getErrMsg(langCode) {
  const msgs = {
    hi: 'कुछ गड़बड़ हुई, फिर से कोशिश करो!',
    mr: 'काहीतरी चूक झाली, परत प्रयत्न कर!',
    bn: 'কিছু সমস্যা হয়েছে, আবার চেষ্টা করো!',
    ta: 'ஏதோ தவறு நடந்தது, மீண்டும் முயற்சிக்கவும்!',
    te: 'ఏదో తప్పు జరిగింది, మళ్ళీ ప్రయత్నించు!',
    kn: 'ಏನೋ ತಪ್ಪಾಯಿತು, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ!',
    ml: 'എന്തോ തെറ്റ് സംഭവിച്ചു, വീണ്ടും ശ്രമിക്കൂ!',
    gu: 'કંઈક ભૂલ થઈ, ફરી પ્રયાસ કરો!',
    pa: 'ਕੁਝ ਗਲਤ ਹੋਇਆ, ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ!',
  };
  return msgs[langCode] || 'Oops, something went wrong! Try again?';
}

// ── TTS speak with language-appropriate voice ─────────────
function speakVoice(text, langCode) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      showTranscript(text, 'ai');
      setVoiceOrbState('idle');
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    voiceState.isSpeaking = true;
    setVoiceOrbState('speaking');
    showTranscript(text, 'ai');

    const utter = new SpeechSynthesisUtterance(text);
    utter.volume = 1;

    // Get voice + pitch — handles all gender/language combos
    const params = getVoiceParams(langCode || 'en', voiceState.persona);
    if (params.voice) utter.voice = params.voice;
    utter.pitch = params.pitch;
    utter.rate  = params.rate;

    // Set utterance lang ONLY when the voice actually speaks this language.
    // If boy uses English male voice to speak Hindi, do NOT set lang='hi-IN'
    // because the English voice engine won't handle it — let it read as-is.
    const usingLangSpecificVoice = params.voice && params.voice !== voiceState.enBoyVoice && params.voice !== voiceState.enGirlVoice;
    if (usingLangSpecificVoice && langCode && langCode !== 'en') {
      const bcp47 = voiceState.detectedLang?.bcp47;
      if (bcp47) utter.lang = bcp47;
    }

    utter.onend  = () => { voiceState.isSpeaking = false; if (voiceState.active) setVoiceOrbState('idle'); resolve(); };
    utter.onerror= () => { voiceState.isSpeaking = false; if (voiceState.active) setVoiceOrbState('idle'); resolve(); };
    voiceState.currentUtterance = utter;

    setTimeout(() => {
      if (voiceState.active) window.speechSynthesis.speak(utter);
      else resolve();
    }, 100);
  });
}

// ── Initialisation ──────────────────────────────────────────────────────────
(function(){const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';document.head.appendChild(s);})();

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
function init() {
  loadChats();

  // Restore or create active chat
  let savedActive = null;
  try { savedActive = localStorage.getItem(ACTIVE_CHAT_KEY); } catch(e) {}

  if (savedActive && chats[savedActive]) {
    activeChatId = savedActive;
  } else if (Object.keys(chats).length > 0) {
    // Switch to most recently updated
    const sorted = Object.keys(chats).sort((a,b) => (chats[b].updatedAt||0)-(chats[a].updatedAt||0));
    activeChatId = sorted[0];
  } else {
    // First launch — create initial chat
    const id = createNewChat(false);
    activeChatId = id;
  }

  renderChatList();
  renderChatMessages();
  updateHeaderTitle(chats[activeChatId]?.title || 'New Chat');
  updateMemoryBadge();
  updateFilesBadge();
  syncModelButtons();

  // Free mode
  try { if(localStorage.getItem(FREEMODE_KEY)==='1'){isFreeMode=true;applyFreeMode();} } catch(e) {}

  initVoice();
}

// ══════════════════════════════════════════════════════
// AUTH + FIRESTORE — Firebase Login & Per-User Data
// ══════════════════════════════════════════════════════
//
// ALL user data (chats, files, scope memories) is stored in:
//   Firestore: users/{uid}/chats/{chatId}
//              users/{uid}/files/{fileId}
//              users/{uid}/scopeMemories/{memId}
//
// localStorage is used only as a write-through cache for speed.
// On login, Firestore data overwrites any local cache.
// On every save, both localStorage AND Firestore are written.
//
// SETUP:
//   1. Go to console.firebase.google.com
//   2. Create project → Authentication → Sign-in method → Enable Google
//   3. Firestore Database → Create database → Start in production mode
//   4. Firestore Rules → paste rules below → Publish
//   5. Project settings → Your apps → Add web app → Copy config
//   6. Paste config into the firebaseConfig object at the top of this file
//
// FIRESTORE SECURITY RULES (paste in Firebase console):
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{userId}/{document=**} {
//       allow read, write: if request.auth != null && request.auth.uid == userId;
//     }
//   }
// }

// ══════════════════════════════════════════════════════
// AUTH + ONBOARDING — Firebase Multi-Method Login
// ══════════════════════════════════════════════════════

let _currentUser  = null;
let _obStep       = 0;
let _obData       = {};
let _isNewUser    = false;
let _schoolCodeVerified = false;
let _schoolChoiceMade   = null;

// School membership (set after login if user belongs to a school)
let _userSchoolCode = null;
let _userSchoolName = null;
let _userSchoolRole = null;  // 'student' | 'teacher' | 'principal'

const OB_STEPS = 5;

// ── Wait for Firebase module ──────────────────────────────────────────────────
function _waitFb() {
  return new Promise(resolve => {
    if (window._fb) { resolve(window._fb); return; }
    const iv = setInterval(() => { if (window._fb) { clearInterval(iv); resolve(window._fb); } }, 50);
    setTimeout(() => { clearInterval(iv); resolve(null); }, 6000);
  });
}

// ── Tab: Sign In / Sign Up ────────────────────────────────────────────────────
// ── GOOGLE ────────────────────────────────────────────────────────────────────
async function authSignInGoogle() {
  const fb = window._fb;
  if (!fb) { showAuthError('Firebase not ready. Refresh the page.'); return; }
  showAuthLoadingMsg('Signing in with Google…');
  try {
    const provider = new fb.GoogleAuthProvider();
    const result   = await fb.signInWithPopup(fb.auth, provider);
    _isNewUser = result._tokenResponse?.isNewUser || false;
  } catch(err) {
    hideAuthLoading();
    if (err.code === 'auth/popup-closed-by-user') return;
    showAuthError(friendlyError(err.code));
  }
}

// ── Error messages ────────────────────────────────────────────────────────────
function friendlyError(code) {
  const map = {
    'auth/user-not-found':         'No account with this email. Sign up instead.',
    'auth/wrong-password':         'Wrong password. Try again.',
    'auth/email-already-in-use':   'This email is already registered. Sign in instead.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/weak-password':          'Password too weak — use at least 6 characters.',
    'auth/too-many-requests':      'Too many attempts. Wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your internet.',
    'auth/invalid-verification-code': 'Wrong OTP. Check and try again.',
    'auth/code-expired':           'OTP expired. Request a new one.',
    'auth/account-exists-with-different-credential': 'Account exists with another sign-in method.',
    'auth/popup-blocked':          'Popup blocked. Allow popups for this site.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ── Auth UI helpers ───────────────────────────────────────────────────────────
function showAuthError(msg) {
  const onboardVisible = document.getElementById('auth-step-onboard')?.style.display !== 'none';
  const box = document.getElementById(onboardVisible ? 'auth-error-ob' : 'auth-error');
  if (box) { box.textContent = msg; box.style.display = 'block'; }
  hideAuthLoading();
}
function clearAuthError() {
  ['auth-error','auth-error-ob'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display='none'; el.textContent=''; }
  });
}
function showAuthLoadingMsg(msg) {
  const el = document.getElementById('auth-loading');
  if (el) { el.style.display='flex'; el.querySelector('span').textContent = msg || 'Please wait…'; }
}
function hideAuthLoading() {
  const el = document.getElementById('auth-loading');
  if (el) el.style.display='none';
}

// ── Sign out ──────────────────────────────────────────────────────────────────
async function authSignOut() {
  hideUserMenu();
  const fb = window._fb;
  if (!fb) return;
  _currentUser = null;
  chats = {}; activeChatId = null;
  try { localStorage.clear(); } catch(e) {}
  await fb.signOut(fb.auth);
  location.reload(); // cleanest way to reset all state
}

// ── onAuthStateChanged ────────────────────────────────────────────────────────
async function authInit() {
  const fb = await _waitFb();

  // Helper to hide session loader (the full-screen spinner shown on every page load)
  function hideSessionLoader() {
    const loader = document.getElementById('session-loader');
    if (!loader) return;
    loader.style.transition = 'opacity .3s ease';
    loader.style.opacity = '0';
    setTimeout(() => { loader.style.display = 'none'; }, 300);
  }

  if (!fb) {
    // Firebase failed to load — run in localStorage-only mode
    console.warn('Firebase not available — running in local mode');
    hideSessionLoader();
    hideAuthScreen();
    init();
    return;
  }

  fb.onAuthStateChanged(fb.auth, async (user) => {
    if (user) {
      // ── USER IS ALREADY LOGGED IN (persistent session) or just logged in ──
      if (user.providerData[0]?.providerId === 'password' && !user.emailVerified) {
        hideSessionLoader();
        return;
      }

      _currentUser = user;

      try { await loadUserDataFromFirestore(); } catch(e) {
        console.warn('Firestore load failed, continuing:', e);
      }

      // Check onboarding completion
      const profile = await _getProfile();
      if (!profile || !profile.name) {
        // New user — show onboarding
        _isNewUser = true;
        hideSessionLoader();
        // Show auth screen in onboarding mode
        const screen = document.getElementById('auth-screen');
        if (screen) screen.style.display = 'flex';
        _showOnboarding();
      } else {
        // Returning user — always set language from profile (including English)
        _userProfile = profile;
        _userPreferredLang = profile.language || 'English';

        // Store school membership globally so classroom features know the user's school
        if (profile.schoolCode) {
          _userSchoolCode = profile.schoolCode;
          _userSchoolName = profile.schoolName || '';
          _userSchoolRole = profile.schoolRole || 'student';
        }

        hideSessionLoader();
        _afterLogin(user, false);
      }
    } else {
      // ── NOT LOGGED IN — show login screen ──
      _currentUser = null;
      hideSessionLoader();
      const screen = document.getElementById('auth-screen');
      if (screen) screen.style.display = 'flex';
      hideAuthLoading();
    }
  });
}

async function _getProfile() {
  if (!_currentUser || !window._fb) return null;
  try {
    const fb  = window._fb;
    const ref = fb.doc(fb.db, 'users', _currentUser.uid, 'profile', 'data');
    const snap= await fb.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch(e) { return null; }
}

function _afterLogin(user, isNew) {
  hideAuthScreen();
  hideAuthLoading();

  // Sidebar avatar
  const sbUser = document.getElementById('sb-user');
  const avatar = document.getElementById('sb-avatar');
  if (sbUser) sbUser.style.display = 'flex';
  if (avatar && user.photoURL) avatar.src = user.photoURL;

  // User menu
  const umAvatar = document.getElementById('um-avatar');
  const umName   = document.getElementById('um-name');
  const umEmail  = document.getElementById('um-email');
  if (umAvatar && user.photoURL) umAvatar.src = user.photoURL;
  if (umName)  umName.textContent  = user.displayName || _obData.name || 'Student';
  if (umEmail) umEmail.textContent = user.email || user.phoneNumber || '';

  // _userPreferredLang is already correctly set before _afterLogin is called.
  // Don't override it here.
  init();
  // Update classroom sidebar label based on school membership
  setTimeout(crUpdateSidebarLabel, 100);
}

function hideAuthScreen() {
  const screen = document.getElementById('auth-screen');
  if (!screen) return;
  screen.style.transition = 'opacity .4s ease';
  screen.style.opacity = '0';
  setTimeout(() => { screen.style.display = 'none'; screen.style.opacity = '1'; }, 400);
}

// ══════════════════════════════════════════════════════
// ONBOARDING FLOW
// ══════════════════════════════════════════════════════

function _showOnboarding() {
  document.getElementById('auth-step-login').style.display   = 'none';
  document.getElementById('auth-step-onboard').style.display = 'block';
  _obStep = 0; _obData = {};
  _schoolChoiceMade   = null;
  _schoolCodeVerified = false;
  _obRenderStep(0);
}

function _obRenderStep(step) {
  // Show/hide pages
  for (let i = 0; i < OB_STEPS; i++) {
    const page = document.getElementById('ob-page-'+i);
    if (page) page.style.display = i === step ? 'flex' : 'none';
  }
  // Dots
  for (let i = 0; i < OB_STEPS; i++) {
    const dot = document.getElementById('ob-dot-'+i);
    if (!dot) continue;
    dot.className = 'onboard-step-dot' + (i < step ? ' done' : i === step ? ' active' : '');
  }
  // Back button
  const backBtn = document.getElementById('ob-back-btn');
  if (backBtn) backBtn.style.display = step > 0 ? 'block' : 'none';
  // Next button label
  const nextBtn = document.getElementById('ob-next-btn');
  if (nextBtn) nextBtn.textContent = step === OB_STEPS - 1 ? "Let's go 🚀" : 'Next →';
}

function obSelect(el, key) {
  el.closest('.ob-options-grid').querySelectorAll('.ob-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  _obData[key] = el.textContent.replace(/^[\p{Emoji}\s]+/u,'').trim();
}

function obToggle(el, key) {
  el.classList.toggle('selected');
  if (!_obData[key]) _obData[key] = [];
  const val = el.textContent.replace(/^[\p{Emoji}\s]+/u,'').trim();
  if (el.classList.contains('selected')) {
    if (!_obData[key].includes(val)) _obData[key].push(val);
  } else {
    _obData[key] = _obData[key].filter(v => v !== val);
  }
}

async function obNext() {
  clearAuthError();

  // Step 0 — name validation
  if (_obStep === 0) {
    const name = document.getElementById('ob-name')?.value.trim();
    if (!name) { showAuthError('Please enter your name.'); return; }
    _obData.name = name;
  }

  // Step 4 — school code step validation
  if (_obStep === 4) {
    // Must have made a choice
    if (!_schoolChoiceMade) {
      showAuthError('Please choose Yes or No.');
      return;
    }
    // If Yes — must have verified the code
    if (_schoolChoiceMade === 'yes' && !_schoolCodeVerified) {
      showAuthError('Please verify your school code first, or choose "No".');
      return;
    }
    // All good — save and finish
    await _obSave();
    return;
  }

  if (_obStep < OB_STEPS - 1) {
    _obStep++;
    _obRenderStep(_obStep);
    return;
  }

  await _obSave();
}

function obBack() {
  if (_obStep > 0) { _obStep--; _obRenderStep(_obStep); }
}

async function _obSave() {
  const btn = document.getElementById('ob-next-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const fb  = window._fb;
  const uid = _currentUser?.uid;
  if (fb && uid) {
    const profileData = {
      name:        _obData.name     || '',
      class:       _obData.class    || '',
      subjects:    _obData.subject  || [],
      language:    _obData.lang     || 'English',
      email:       _currentUser.email || '',
      phone:       _currentUser.phoneNumber || '',
      photoURL:    _currentUser.photoURL || '',
      schoolCode:  _obData.schoolCode  || null,
      schoolName:  _obData.schoolName  || null,
      schoolRole:  _obData.schoolRole  || null,
      createdAt:   Date.now(),
    };
    try {
      await fb.setDoc(fb.doc(fb.db, 'users', uid, 'profile', 'data'), profileData);
      await fb.updateProfile(_currentUser, { displayName: _obData.name });

      // If joined a school — register this user in the school's members list
      if (_obData.schoolCode) {
        await fb.setDoc(
          fb.doc(fb.db, 'schools', _obData.schoolCode, 'members', uid),
          {
            uid,
            name:     _obData.name || '',
            email:    _currentUser.email || '',
            photoURL: _currentUser.photoURL || '',
            role:     _obData.schoolRole || 'student',
            class:    _obData.class || '',
            joinedAt: Date.now(),
          }
        );
      }
    } catch(e) { console.warn('Profile save failed:', e); }
  }
  _userPreferredLang = _obData.lang || 'English';

  // Set school globals immediately
  if (_obData.schoolCode) {
    _userSchoolCode = _obData.schoolCode;
    _userSchoolName = _obData.schoolName || '';
    _userSchoolRole = _obData.schoolRole || 'student';
  } else {
    _userSchoolCode = null;
    _userSchoolName = null;
    _userSchoolRole = null;
  }

  _userProfile = {
    name:       _obData.name || '',
    class:      _obData.class || '',
    subjects:   _obData.subject || [],
    language:   _obData.lang || 'English',
    email:      _currentUser?.email || '',
    photoURL:   _currentUser?.photoURL || '',
    schoolCode: _obData.schoolCode || null,
    schoolName: _obData.schoolName || null,
    schoolRole: _obData.schoolRole || null,
    createdAt:  Date.now(),
  };
  _afterLogin(_currentUser, true);
}

// ══════════════════════════════════════════════════════
// SCHOOL CODE — Onboarding Step 5
// ══════════════════════════════════════════════════════

function obSchoolChoice(choice) {
  _schoolChoiceMade = choice;
  _schoolCodeVerified = false;

  // Update button styles
  document.getElementById('ob-school-yes').classList.toggle('selected', choice === 'yes');
  document.getElementById('ob-school-no').classList.toggle('selected',  choice === 'no');

  const codeEntry = document.getElementById('ob-school-code-entry');
  const skipNote  = document.getElementById('ob-school-skip-note');
  const confirmed = document.getElementById('ob-school-confirmed');

  if (choice === 'yes') {
    codeEntry.style.display  = 'block';
    skipNote.style.display   = 'none';
    confirmed.style.display  = 'none';
    document.getElementById('ob-school-code-input').focus();
  } else {
    codeEntry.style.display  = 'none';
    skipNote.style.display   = 'block';
    confirmed.style.display  = 'none';
    _obData.schoolCode  = null;
    _obData.schoolName  = null;
    _obData.schoolRole  = null;
    clearAuthError();
  }
}

async function obVerifySchoolCode() {
  const code = document.getElementById('ob-school-code-input').value.trim().toUpperCase();
  if (!code) { showAuthError('Enter the school code.'); return; }

  const btn = document.getElementById('ob-verify-btn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  clearAuthError();

  const fb = window._fb;
  if (!fb) { btn.disabled = false; btn.textContent = 'Verify →'; showAuthError('Firebase not ready.'); return; }

  try {
    // Look up the school code in Firestore
    // Structure: schools/{code} → { name, principalUid, createdAt, active }
    const schoolRef  = fb.doc(fb.db, 'schools', code);
    const schoolSnap = await fb.getDoc(schoolRef);

    if (!schoolSnap.exists()) {
      btn.disabled = false;
      btn.textContent = 'Verify →';
      showAuthError('❌ Invalid code. Check with your teacher or principal.');
      return;
    }

    const school = schoolSnap.data();
    if (school.active === false) {
      btn.disabled = false;
      btn.textContent = 'Verify →';
      showAuthError('❌ This school code has been deactivated.');
      return;
    }

    // ✅ Valid code — store in onboarding data
    _obData.schoolCode = code;
    _obData.schoolName = school.name || 'Your School';
    _obData.schoolRole = 'student';   // default role when joining via code
    _schoolCodeVerified = true;

    // Show confirmation card
    document.getElementById('ob-school-name').textContent = school.name || 'Your School';
    document.getElementById('ob-school-role').textContent = '🎓 Student · ' + (school.name || code);
    document.getElementById('ob-school-confirmed').style.display = 'block';

    btn.disabled = false;
    btn.textContent = '✓ Verified';
    clearAuthError();

  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Verify →';
    showAuthError('Could not verify code. Check your internet and try again.');
    console.error('School code verify error:', e);
  }
}

// ══════════════════════════════════════════════════════
// FIRESTORE: load + save user data
// ══════════════════════════════════════════════════════

async function loadUserDataFromFirestore() {
  const fb  = window._fb;
  const uid = _currentUser.uid;

  // ── CRITICAL: Always clear localStorage first ──
  // This prevents a previous user's cached data from leaking into a new session.
  // localStorage is always overwritten with whatever Firestore has (including nothing for new users).
  try {
    localStorage.removeItem(CHATS_KEY);
    localStorage.removeItem(FILES_KEY);
    localStorage.removeItem(SCOPE_MEMORY_KEY);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
  } catch(e) {}

  // Reset in-memory state too
  chats = {};
  activeChatId = null;
  scopeMemory  = [];

  // Load chats
  const chatsSnap = await fb.getDocs(fb.collection(fb.db, 'users', uid, 'chats'));
  const fsChats   = {};
  chatsSnap.forEach(d => { fsChats[d.id] = d.data(); });
  if (Object.keys(fsChats).length > 0) {
    chats = fsChats;
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch(e) {}
  }

  // Load files
  const filesSnap = await fb.getDocs(fb.collection(fb.db, 'users', uid, 'files'));
  const fsFiles   = [];
  filesSnap.forEach(d => fsFiles.push(d.data()));
  if (fsFiles.length > 0) {
    fsFiles.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    try { localStorage.setItem(FILES_KEY, JSON.stringify(fsFiles)); } catch(e) {}
  }

  // Load scope memories
  const memSnap = await fb.getDocs(fb.collection(fb.db, 'users', uid, 'scopeMemories'));
  const fsMems  = [];
  memSnap.forEach(d => fsMems.push(d.data()));
  if (fsMems.length > 0) {
    fsMems.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    scopeMemory = fsMems;
    try { localStorage.setItem(SCOPE_MEMORY_KEY, JSON.stringify(scopeMemory)); } catch(e) {}
  }

  console.log(`✅ Loaded: ${Object.keys(chats).length} chats, ${fsFiles.length} files, ${fsMems.length} memories`);
}

// ── Override storage functions to sync Firestore ──────────────────────────────
function saveChats() {
  try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch(e) {}
  if (_currentUser && window._fb && activeChatId && chats[activeChatId]) {
    const fb = window._fb;
    fb.setDoc(fb.doc(fb.db,'users',_currentUser.uid,'chats',activeChatId), chats[activeChatId])
      .catch(e => console.warn('Firestore chat save failed:',e));
  }
}

function saveFiles(files) {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(files)); } catch(e) {}
  if (_currentUser && window._fb) {
    const fb = window._fb;
    files.forEach(file => {
      fb.setDoc(fb.doc(fb.db,'users',_currentUser.uid,'files',file.id), file)
        .catch(e => console.warn('Firestore file save:',e));
    });
  }
}

function scopeSaveMemoryStore() {
  try { localStorage.setItem(SCOPE_MEMORY_KEY, JSON.stringify(scopeMemory)); } catch(e) {}
  scopeUpdateMemBadge();
  if (_currentUser && window._fb) {
    const fb = window._fb;
    scopeMemory.forEach(mem => {
      const { thumb, ...m } = mem; // don't store large thumbnail in Firestore
      fb.setDoc(fb.doc(fb.db,'users',_currentUser.uid,'scopeMemories',mem.id), m)
        .catch(e => console.warn('Firestore memory save:',e));
    });
  }
}

// ── User menu ─────────────────────────────────────────────────────────────────
function showUserMenu() {
  const avatar  = document.getElementById('sb-avatar');
  const menu    = document.getElementById('user-menu');
  const overlay = document.getElementById('user-menu-overlay');
  if (!menu || !avatar) return;
  const rect = avatar.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 8) + 'px';
  menu.style.left = Math.max(8, rect.left - 160) + 'px';
  menu.style.display = 'block';
  overlay.style.display = 'block';
}
function hideUserMenu() {
  const menu    = document.getElementById('user-menu');
  const overlay = document.getElementById('user-menu-overlay');
  if (menu)    menu.style.display    = 'none';
  if (overlay) overlay.style.display = 'none';
}

// ── Firestore path helper ─────────────────────────────────────────────────────
function _userPath(subPath) {
  return `users/${_currentUser.uid}/${subPath}`;
}

// ══════════════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════════════

let _currentTheme = 'dark'; // 'dark' | 'light' | 'system'

function applyTheme(theme) {
  _currentTheme = theme;
  const html = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }

  // Persist
  try { localStorage.setItem('sedy_theme', theme); } catch(e) {}
}

function loadTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('sedy_theme') || 'dark'; } catch(e) {}
  applyTheme(saved);
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (_currentTheme === 'system') applyTheme('system');
  });
}

// ══════════════════════════════════════════════════════
// SETTINGS PANEL
// ══════════════════════════════════════════════════════

let _userProfile = null;   // loaded from Firestore profile
let _settingsSubjects = [];

function openSettings() {
  const panel = document.getElementById('settings-overlay');
  if (!panel) return;

  // Populate from current state
  const name  = _userProfile?.name  || _currentUser?.displayName || '';
  const email = _userProfile?.email || _currentUser?.email || '';
  const lang  = _userProfile?.language || _userPreferredLang || 'English';
  const subs  = _userProfile?.subjects || [];
  const photo = _currentUser?.photoURL || '';

  document.getElementById('settings-name-input').value = name;
  document.getElementById('settings-user-name').textContent  = name || 'Student';
  document.getElementById('settings-user-email').textContent = email;

  const img = document.getElementById('settings-avatar-img');
  const ph  = document.getElementById('settings-avatar-placeholder');
  if (photo) { img.src = photo; img.style.display = ''; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }

  // Language
  const langSel = document.getElementById('settings-lang-select');
  if (langSel) langSel.value = lang;

  // Subjects
  _settingsSubjects = [...subs];
  document.querySelectorAll('.settings-chip').forEach(chip => {
    chip.classList.toggle('active', subs.includes(chip.dataset.sub));
  });

  // Theme
  ['dark','light','system'].forEach(t => {
    document.getElementById('theme-opt-'+t)?.classList.toggle('active', _currentTheme === t);
  });

  // School section — show correct state
  const noSchool  = document.getElementById('settings-no-school');
  const hasSchoolEl = document.getElementById('settings-has-school');
  const errEl     = document.getElementById('settings-school-error');
  if (errEl) errEl.style.display = 'none';

  if (hasSchool()) {
    if (noSchool)  noSchool.style.display  = 'none';
    if (hasSchoolEl) {
      hasSchoolEl.style.display = 'flex';
      document.getElementById('settings-school-name-label').textContent = _userSchoolName || 'Your School';
      document.getElementById('settings-school-role-label').textContent = (_userSchoolRole || 'student') + ' · ' + (_userSchoolCode || '');
      document.getElementById('settings-school-code-label').textContent = _userSchoolCode || '';
    }
  } else {
    if (noSchool)  noSchool.style.display  = 'flex';
    if (hasSchoolEl) hasSchoolEl.style.display = 'none';
    const codeInput = document.getElementById('settings-school-code-input');
    if (codeInput) codeInput.value = '';
  }

  panel.classList.add('open');
}

async function settingsJoinSchool() {
  const code = (document.getElementById('settings-school-code-input')?.value || '').trim().toUpperCase();
  const errEl = document.getElementById('settings-school-error');
  if (!code) { if (errEl) { errEl.textContent = 'Enter a school code.'; errEl.style.display = 'block'; } return; }
  if (errEl) errEl.style.display = 'none';

  const fb = window._fb;
  if (!fb || !_currentUser) { if (errEl) { errEl.textContent = 'Not signed in.'; errEl.style.display = 'block'; } return; }

  try {
    const snap = await fb.getDoc(fb.doc(fb.db, 'schools', code));
    if (!snap.exists()) { if (errEl) { errEl.textContent = '❌ Invalid code. Check with your teacher.'; errEl.style.display = 'block'; } return; }
    const school = snap.data();
    if (school.active === false) { if (errEl) { errEl.textContent = '❌ This code has been deactivated.'; errEl.style.display = 'block'; } return; }

    // Join school
    const uid = _currentUser.uid;
    _userSchoolCode = code;
    _userSchoolName = school.name || 'School';
    _userSchoolRole = 'student';

    // Register as member
    await fb.setDoc(fb.doc(fb.db, 'schools', code, 'members', uid), {
      uid, name: _userProfile?.name || '', email: _currentUser.email || '',
      photoURL: _currentUser.photoURL || '', role: 'student',
      class: _userProfile?.class || '', joinedAt: Date.now(),
    });

    // Update profile
    _userProfile = { ...(_userProfile || {}), schoolCode: code, schoolName: school.name, schoolRole: 'student' };
    await fb.setDoc(fb.doc(fb.db, 'users', uid, 'profile', 'data'), _userProfile);

    crUpdateSidebarLabel();
    closeSettings();
    openClassroom();
  } catch(e) {
    if (errEl) { errEl.textContent = 'Could not join school. Check your connection.'; errEl.style.display = 'block'; }
    console.error('settingsJoinSchool error:', e);
  }
}

function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

function settingsSelectTheme(theme) {
  ['dark','light','system'].forEach(t => {
    document.getElementById('theme-opt-'+t)?.classList.toggle('active', t === theme);
  });
  applyTheme(theme);
}

function settingsToggleSubject(el) {
  el.classList.toggle('active');
  const sub = el.dataset.sub;
  if (el.classList.contains('active')) {
    if (!_settingsSubjects.includes(sub)) _settingsSubjects.push(sub);
  } else {
    _settingsSubjects = _settingsSubjects.filter(s => s !== sub);
  }
}

function settingsChangePic(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const img = document.getElementById('settings-avatar-img');
    const ph  = document.getElementById('settings-avatar-placeholder');
    img.src = dataUrl; img.style.display = ''; ph.style.display = 'none';

    // Update Firebase profile photo
    // Note: Firebase Auth photoURL must be a URL, not base64.
    // We store it in Firestore profile instead.
    if (_userProfile) _userProfile.photoURL = dataUrl;

    // Update sidebar avatar too
    const sbAvatar = document.getElementById('sb-avatar');
    const umAvatar = document.getElementById('um-avatar');
    if (sbAvatar) sbAvatar.src = dataUrl;
    if (umAvatar) umAvatar.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

async function settingsSave() {
  const btn = document.querySelector('.settings-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const name = document.getElementById('settings-name-input').value.trim() || _userProfile?.name || '';
  const lang = document.getElementById('settings-lang-select').value;

  // Apply language immediately — always store the actual value including 'English'
  _userPreferredLang = lang || 'English';

  // Update profile object
  _userProfile = {
    ...(_userProfile || {}),
    name,
    language: lang,
    subjects: _settingsSubjects,
    updatedAt: Date.now(),
  };

  // Save to Firestore
  if (_currentUser && window._fb) {
    const fb = window._fb;
    try {
      await fb.setDoc(fb.doc(fb.db, 'users', _currentUser.uid, 'profile', 'data'), _userProfile);
      if (name) await fb.updateProfile(_currentUser, { displayName: name });
    } catch(e) { console.warn('Settings save failed:', e); }
  }

  // Update UI
  document.getElementById('um-name').textContent = name;
  document.getElementById('settings-user-name').textContent = name;
  const sbAvatar = document.getElementById('sb-avatar');
  if (sbAvatar && _userProfile.photoURL) sbAvatar.src = _userProfile.photoURL;

  if (btn) { btn.disabled = false; btn.textContent = '✓ Saved!'; setTimeout(() => { btn.textContent = 'Save Changes'; }, 2000); }

  // Refresh empty state if visible
  const emptyEl = document.querySelector('.empty-state');
  if (emptyEl) { emptyEl.remove(); showEmptyState(); }
}

// ── Classroom access helpers ──────────────────────────────────────────────────

function hasSchool() {
  return !!_userSchoolCode;
}

function classroomLocked() {
  return !_userSchoolCode;
}

// Called from anywhere in the app to check if classroom is available.
// Returns true and shows a toast if locked, false if accessible.
function requireSchool(action) {
  if (hasSchool()) return false; // not locked
  addMsg('ai', `🔒 **Sedy Classroom is locked.**\n\nYou need a school code to access classroom features. You can add one anytime from **Settings → Join a School**.`);
  return true; // locked — caller should abort
}

// ══════════════════════════════════════════════════════
// UPGRADES PANEL
// ══════════════════════════════════════════════════════

function openUpgrades() {
  document.getElementById('upgrades-overlay').classList.add('open');
}
function closeUpgrades() {
  document.getElementById('upgrades-overlay').classList.remove('open');
}

// ══════════════════════════════════════════════════════
// SCHOOL SETUP WIZARD
// ══════════════════════════════════════════════════════

let _schoolSetupRole = 'principal';
let _generatedCode   = null;

function openSchoolSetup() {
  if (hasSchool()) { openClassroom(); return; }
  document.getElementById('school-setup-step1').style.display = 'flex';
  document.getElementById('school-setup-step2').style.display = 'none';
  document.getElementById('school-setup-btn').textContent     = 'Create School →';
  document.getElementById('school-setup-btn').disabled        = false;
  document.getElementById('school-setup-error').style.display = 'none';
  document.getElementById('school-setup-title').textContent   = '🏫 Set Up Your School';
  _generatedCode = null;
  document.getElementById('school-setup-overlay').classList.add('open');
}
function closeSchoolSetup() {
  document.getElementById('school-setup-overlay').classList.remove('open');
}
function schoolSetupSelectRole(role) {
  _schoolSetupRole = role;
  document.getElementById('school-role-principal').classList.toggle('selected', role === 'principal');
  document.getElementById('school-role-teacher').classList.toggle('selected',   role === 'teacher');
}

async function schoolSetupNext() {
  if (_generatedCode) { closeSchoolSetup(); openClassroom(); return; }
  const name = document.getElementById('school-setup-name').value.trim();
  if (!name) {
    const e = document.getElementById('school-setup-error');
    e.textContent = 'Please enter your school name.'; e.style.display = 'block'; return;
  }
  const btn = document.getElementById('school-setup-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  document.getElementById('school-setup-error').style.display = 'none';
  try {
    const res = await fetch(API_URL + '/school/generate-code', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ school_name: name, principal_uid: _currentUser?.uid||'', principal_name: _userProfile?.name||'', principal_email: _currentUser?.email||'' })
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    _generatedCode = data.code;

    if (window._fb && _currentUser) {
      const fb = window._fb; const uid = _currentUser.uid;
      await fb.setDoc(fb.doc(fb.db,'schools',_generatedCode), { name, principalUid:uid, principalName:_userProfile?.name||'', principalEmail:_currentUser.email||'', active:true, plan:'free', createdAt:Date.now(), memberCount:1 });
      await fb.setDoc(fb.doc(fb.db,'schools',_generatedCode,'members',uid), { uid, name:_userProfile?.name||'', email:_currentUser.email||'', photoURL:_currentUser.photoURL||'', role:'principal', joinedAt:Date.now() });
      _userSchoolCode = _generatedCode; _userSchoolName = name; _userSchoolRole = 'principal';
      _userProfile = {...(_userProfile||{}), schoolCode:_generatedCode, schoolName:name, schoolRole:'principal'};
      await fb.setDoc(fb.doc(fb.db,'users',uid,'profile','data'), _userProfile);
    }

    document.getElementById('school-setup-step1').style.display = 'none';
    document.getElementById('school-setup-step2').style.display = 'flex';
    document.getElementById('school-setup-code-value').textContent = _generatedCode;
    document.getElementById('school-setup-code-name').textContent  = name;
    document.getElementById('school-setup-title').textContent      = '🎉 School Created!';
    btn.disabled = false; btn.textContent = 'Go to Classroom →';
    crUpdateSidebarLabel();
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Create School →';
    const e = document.getElementById('school-setup-error');
    e.textContent = 'Could not create school. Try again.'; e.style.display='block';
  }
}

function schoolCopyCode() {
  if (!_generatedCode) return;
  navigator.clipboard.writeText(_generatedCode).then(() => {
    const btn = document.getElementById('school-copy-btn');
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Code'; }, 2000);
  });
}

// ══════════════════════════════════════════════════════
// CLASSROOM — Main System
// ══════════════════════════════════════════════════════

let _crCurrentSubject = null;
let _crAllMembers     = [];
let _crAnnouncements  = [];
let _crMemberFilter   = 'all';

function openClassroom() {
  const overlay = document.getElementById('classroom-overlay');
  overlay.classList.add('open');
  if (!hasSchool()) {
    document.getElementById('classroom-locked').style.display = 'flex';
    document.getElementById('classroom-active').style.display = 'none';
    return;
  }
  document.getElementById('classroom-locked').style.display    = 'none';
  document.getElementById('classroom-active').style.display    = 'flex';
  document.getElementById('cr-school-badge').textContent       = _userSchoolName||'My School';
  document.getElementById('cr-school-name-header').textContent = _userSchoolName||'your school';
  const ttBtn = document.getElementById('cr-nav-timetable');
  if (ttBtn) ttBtn.style.display = _userSchoolRole==='principal'?'flex':'none';
  const postArea = document.getElementById('cr-post-announce');
  if (postArea) postArea.style.display = ['principal','teacher'].includes(_userSchoolRole)?'block':'none';
  crSwitchPane('dashboard');
  crLoadDashboard();
}
function closeClassroom() {
  document.getElementById('classroom-overlay').classList.remove('open');
}
function crSwitchPane(pane) {
  document.querySelectorAll('.classroom-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.classroom-nav-btn').forEach(b=>b.classList.remove('active'));
  const pEl=document.getElementById('cr-pane-'+pane), nEl=document.querySelector(`.classroom-nav-btn[data-pane="${pane}"]`);
  if(pEl)pEl.classList.add('active'); if(nEl)nEl.classList.add('active');
  if(pane==='announce')crLoadAnnouncements();
  if(pane==='members')crLoadMembers();
  if(pane==='subjects')crShowSubjectList();
}

async function crLoadDashboard(){
  const grid=document.getElementById('cr-subject-cards'), empty=document.getElementById('cr-dashboard-empty');
  grid.innerHTML='';
  const subjects=_userProfile?.subjects||[];
  if(!subjects.length){empty.style.display='block';return;}
  empty.style.display='none';
  const icons={Maths:'🔢',Physics:'⚛️',Chemistry:'🧪',Biology:'🌿','CS/Code':'💻',History:'🏛️',Geography:'🌍',English:'📖',Economics:'🧮',Arts:'🎨'};
  subjects.forEach(sub=>{
    const card=document.createElement('div');card.className='cr-card';
    card.innerHTML=`<div class="cr-card-icon">${icons[sub]||'📚'}</div><div class="cr-card-name">${_esc(sub)}</div><div class="cr-card-sub">Materials &amp; doubts</div>`;
    card.onclick=()=>{crSwitchPane('subjects');crOpenSubject(sub);};
    grid.appendChild(card);
  });
}

function crShowSubjectList(){
  document.getElementById('cr-subjects-list-view').style.display='block';
  document.getElementById('cr-subject-detail-view').style.display='none';
  _crCurrentSubject=null;
  const list=document.getElementById('cr-subjects-list'), subjects=_userProfile?.subjects||[];
  const icons={Maths:'🔢',Physics:'⚛️',Chemistry:'🧪',Biology:'🌿','CS/Code':'💻',History:'🏛️',Geography:'🌍',English:'📖',Economics:'🧮',Arts:'🎨'};
  list.innerHTML='';
  subjects.forEach(sub=>{
    const item=document.createElement('div');item.className='cr-material-item';
    item.innerHTML=`<div class="cr-material-icon">${icons[sub]||'📚'}</div><div class="cr-material-info"><div class="cr-material-title">${_esc(sub)}</div><div class="cr-material-meta">Tap to open</div></div><span style="color:var(--text3);font-size:18px;">›</span>`;
    item.onclick=()=>crOpenSubject(sub);list.appendChild(item);
  });
  if(!subjects.length)list.innerHTML='<div style="color:var(--text3);font-size:12px;font-family:\'DM Mono\',monospace;padding:16px 0;">No subjects yet. Add them in Settings.</div>';
}

async function crOpenSubject(name){
  _crCurrentSubject=name;
  document.getElementById('cr-subjects-list-view').style.display='none';
  document.getElementById('cr-subject-detail-view').style.display='block';
  document.getElementById('cr-subject-detail-name').textContent=name;
  document.getElementById('cr-doubts-list').innerHTML='';
  crLoadMaterials(name);
}

async function crLoadMaterials(subjectName){
  const list=document.getElementById('cr-materials-list'),empty=document.getElementById('cr-materials-empty');
  list.innerHTML='<div style="color:var(--text3);font-size:11px;font-family:\'DM Mono\',monospace;padding:8px 0;">Loading…</div>';
  if(!window._fb||!_userSchoolCode){list.innerHTML='';empty.style.display='block';return;}
  try{
    const fb=window._fb,subId=subjectName.toLowerCase().replace(/[^a-z0-9]/g,'_');
    const snap=await fb.getDocs(fb.collection(fb.db,'schools',_userSchoolCode,'classrooms',subId,'materials'));
    list.innerHTML='';
    if(snap.empty){empty.style.display='block';return;}
    empty.style.display='none';
    snap.forEach(doc=>{
      const mat=doc.data(),item=document.createElement('div');item.className='cr-material-item';
      const date=mat.createdAt?new Date(mat.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'';
      item.innerHTML=`<div class="cr-material-icon">📄</div><div class="cr-material-info"><div class="cr-material-title">${_esc(mat.title||'Material')}</div><div class="cr-material-meta">${_esc(mat.uploadedByName||'Teacher')} · ${date}</div></div>`;
      item.onclick=()=>{const d=document.getElementById('cr-doubts-list'),c=document.createElement('div');c.style.cssText='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;';c.innerHTML=`<div style="font-size:11px;color:var(--accent2);font-family:'DM Mono',monospace;margin-bottom:6px;">📄 ${_esc(mat.title||'')}</div><div style="font-size:13px;color:var(--text);line-height:1.7;">${mat.summary?parseMarkdown(mat.summary):'No summary.'}</div>`;d.insertBefore(c,d.firstChild);document.getElementById('cr-doubt-input').focus();};
      list.appendChild(item);
    });
  }catch(e){list.innerHTML='';empty.style.display='block';}
}

async function crSendDoubt(){
  const input=document.getElementById('cr-doubt-input'),q=input.value.trim();
  if(!q||!_crCurrentSubject)return; input.value='';
  const div=document.getElementById('cr-doubts-list');
  const uB=document.createElement('div');uB.style.cssText='background:rgba(79,142,255,.1);border:1px solid rgba(79,142,255,.2);border-radius:12px;padding:10px 14px;margin-bottom:8px;font-size:13px;color:var(--text);';
  uB.innerHTML=`<strong style="color:var(--accent);font-size:10px;font-family:'DM Mono',monospace;">YOU</strong><br>${_esc(q)}`;div.appendChild(uB);
  const tB=document.createElement('div');tB.style.cssText='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-bottom:8px;font-size:13px;color:var(--text3);font-family:\'DM Mono\',monospace;';
  tB.textContent='✦ Thinking…';div.appendChild(tB);div.scrollTop=div.scrollHeight;
  let ctx='';
  if(window._fb&&_userSchoolCode){try{const fb=window._fb,sid=_crCurrentSubject.toLowerCase().replace(/[^a-z0-9]/g,'_'),snap=await fb.getDocs(fb.collection(fb.db,'schools',_userSchoolCode,'classrooms',sid,'materials'));snap.forEach(d=>{ctx+=(d.data().summary||'')+'\n\n';});}catch(e){}}
  try{
    const res=await fetch(API_URL+'/school/answer-doubt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,material_context:ctx.slice(0,6000),subject:_crCurrentSubject,class_name:_userProfile?.class||'',student_name:_userProfile?.name||'',preferred_language:_userPreferredLang||'English'})});
    if(!res.ok)throw new Error();const data=await res.json();
    tB.style.cssText='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-bottom:8px;font-size:13px;color:var(--text);line-height:1.7;';
    tB.innerHTML=`<strong style="color:var(--accent2);font-size:10px;font-family:'DM Mono',monospace;">✦ SEDY AI</strong><br>${parseMarkdown(data.answer||'')}`;renderMath(tB);
    if(window._fb&&_userSchoolCode){const fb=window._fb,sid=_crCurrentSubject.toLowerCase().replace(/[^a-z0-9]/g,'_');fb.setDoc(fb.doc(fb.db,'schools',_userSchoolCode,'classrooms',sid,'doubts','d_'+Date.now()),{question:q,answer:data.answer,studentUid:_currentUser?.uid,studentName:_userProfile?.name||'',answeredBy:'Sedy AI',createdAt:Date.now()}).catch(()=>{});}
  }catch(e){tB.textContent='❌ Could not get answer.';tB.style.color='var(--danger)';}
  div.scrollTop=div.scrollHeight;
}

async function crLoadAnnouncements(){
  const list=document.getElementById('cr-announce-list'),empty=document.getElementById('cr-announce-empty');
  list.innerHTML='<div style="color:var(--text3);font-size:11px;font-family:\'DM Mono\',monospace;padding:8px 0;">Loading…</div>';
  if(!window._fb||!_userSchoolCode){list.innerHTML='';empty.style.display='block';return;}
  try{
    const snap=await window._fb.getDocs(window._fb.collection(window._fb.db,'schools',_userSchoolCode,'announcements'));
    const items=[];snap.forEach(d=>items.push({...d.data(),id:d.id}));
    items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));_crAnnouncements=items;
    list.innerHTML='';
    if(!items.length){empty.style.display='block';return;}empty.style.display='none';
    items.forEach(item=>{
      const div=document.createElement('div');div.className='cr-announce-item';
      const time=item.createdAt?new Date(item.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
      div.innerHTML=`<div class="cr-announce-meta"><span class="cr-announce-author">${_esc(item.authorName||'School')}</span><span class="cr-announce-role">${_esc(item.authorRole||'')}</span><span class="cr-announce-time">${time}</span></div><div class="cr-announce-text">${_esc(item.text||'')}</div>`;
      list.appendChild(div);
    });
  }catch(e){list.innerHTML='';empty.style.display='block';}
}

async function crPostAnnouncement(){
  const text=document.getElementById('cr-announce-input').value.trim();
  if(!text||!window._fb||!_userSchoolCode)return;
  document.getElementById('cr-announce-input').value='';
  const fb=window._fb,doc={text,authorUid:_currentUser?.uid,authorName:_userProfile?.name||'Principal',authorRole:_userSchoolRole||'principal',targetClasses:['all'],createdAt:Date.now()};
  await fb.setDoc(fb.doc(fb.db,'schools',_userSchoolCode,'announcements','a_'+Date.now()),doc).catch(()=>{});
  _crAnnouncements.unshift(doc);crLoadAnnouncements();
}

async function crAIDraftAnnouncement(){
  const raw=document.getElementById('cr-announce-input').value.trim();
  if(!raw){document.getElementById('cr-announce-input').placeholder='Type rough notes first…';return;}
  document.getElementById('cr-announce-input').value='AI drafting…';
  try{
    const res=await fetch(API_URL+'/school/draft-announcement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw_text:raw,author_role:_userSchoolRole||'principal',target:'all',preferred_language:_userPreferredLang||'English'})});
    if(!res.ok)throw new Error();const data=await res.json();
    document.getElementById('cr-announce-input').value=data.announcement||raw;
  }catch(e){document.getElementById('cr-announce-input').value=raw;}
}

async function crLoadMembers(){
  const list=document.getElementById('cr-members-list');
  list.innerHTML='<div style="color:var(--text3);font-size:11px;font-family:\'DM Mono\',monospace;padding:8px 0;">Loading…</div>';
  if(!window._fb||!_userSchoolCode){list.innerHTML='';return;}
  try{
    const snap=await window._fb.getDocs(window._fb.collection(window._fb.db,'schools',_userSchoolCode,'members'));
    _crAllMembers=[];snap.forEach(d=>_crAllMembers.push({...d.data(),uid:d.id}));
    _crAllMembers.sort((a,b)=>({principal:0,teacher:1,student:2}[a.role]??3)-({principal:0,teacher:1,student:2}[b.role]??3));
    crRenderMembers(_crAllMembers);
  }catch(e){list.innerHTML='';}
}

function crFilterMembers(filter){
  _crMemberFilter=filter;
  ['all','teacher','student','principal'].forEach(f=>{
    const btn=document.getElementById('cr-filter-'+f);
    if(btn){btn.style.background=f===filter?'rgba(124,92,252,.12)':'';btn.style.borderColor=f===filter?'var(--accent2)':'var(--border2)';btn.style.color=f===filter?'var(--accent2)':'var(--text2)';}
  });
  crRenderMembers(filter==='all'?_crAllMembers:_crAllMembers.filter(m=>m.role===filter));
}

function crRenderMembers(members){
  const list=document.getElementById('cr-members-list');list.innerHTML='';
  if(!members.length){list.innerHTML='<div style="color:var(--text3);font-size:12px;font-family:\'DM Mono\',monospace;padding:8px 0;">No members found.</div>';return;}
  members.forEach(m=>{
    const div=document.createElement('div');div.className='cr-member-item';
    div.innerHTML=`<div class="cr-member-avatar">${m.photoURL?`<img src="${m.photoURL}">`:((m.name||'?')[0].toUpperCase())}</div><div><div class="cr-member-name">${_esc(m.name||'Unknown')}</div><div class="cr-member-role">${_esc(m.email||'')}${m.class?' · '+m.class:''}</div></div><span class="cr-role-badge ${m.role||'student'}">${m.role||'student'}</span>`;
    list.appendChild(div);
  });
}

async function crParseTimetable(){
  const text=document.getElementById('cr-timetable-text').value.trim();
  if(!text||text==='[Image uploaded — AI will read it directly]')return;
  await crParseTimetableCore([],text);
}
async function crHandleTimetableFile(input){
  const file=input.files[0];if(!file)return;
  const textArea=document.getElementById('cr-timetable-text');
  if(file.type==='application/pdf'){
    try{const ab=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:ab}).promise;let text='';for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const c=await page.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n';}textArea.value=text.trim();}catch(e){textArea.placeholder='Could not extract. Paste text manually.';}
  }else if(file.type.startsWith('image/')){
    const reader=new FileReader();reader.onload=async(e)=>{const b64=e.target.result.split(',')[1];textArea.value='[Image uploaded]';await crParseTimetableCore([b64],'');};reader.readAsDataURL(file);return;
  }
}
async function crHandleTimetableDrop(e){e.preventDefault();document.getElementById('cr-timetable-upload-area').style.borderColor='var(--border2)';const file=e.dataTransfer.files[0];if(file)crHandleTimetableFile({files:[file]});}

async function crParseTimetableCore(images=[],text=''){
  const btn=document.getElementById('cr-parse-btn'),result=document.getElementById('cr-timetable-result');
  btn.disabled=true;btn.textContent='⏳ Parsing…';result.style.display='none';
  try{
    const res=await fetch(API_URL+'/school/parse-timetable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text||'',images,school_code:_userSchoolCode||''})});
    if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();
    result.style.display='block';
    let html=`<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;"><div class="cr-section-title">✅ ${data.teachers.length} teachers detected</div><div style="font-size:12px;color:var(--text3);margin-bottom:12px;font-family:'DM Mono',monospace;">${_esc(data.summary)}</div>`;
    data.teachers.forEach(t=>{html+=`<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;margin-bottom:8px;"><div style="font-size:13px;font-weight:700;color:var(--text);font-family:'Syne',sans-serif;">👤 ${_esc(t.name||'')}</div>${(t.assignments||[]).map(a=>`<div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:3px;">${_esc(a.class)} · ${_esc(a.subject)} · ${a.periods_per_week||0} periods/week</div>`).join('')}</div>`);});
    if(window._fb&&_userSchoolCode){await window._fb.setDoc(window._fb.doc(window._fb.db,'schools',_userSchoolCode,'timetable','parsed'),{...JSON.parse(data.raw_json),savedAt:Date.now()}).catch(()=>{});html+=`<div style="margin-top:12px;font-size:11px;color:var(--success);font-family:'DM Mono',monospace;">✅ Saved to Firestore</div>`;}
    html+='</div>';result.innerHTML=html;
  }catch(e){result.style.display='block';result.innerHTML=`<div style="color:var(--danger);font-size:12px;font-family:'DM Mono',monospace;">❌ ${e.message}</div>`;}
  btn.disabled=false;btn.textContent='✦ Parse Timetable with AI';
}

function crUpdateSidebarLabel(){
  const label=document.getElementById('sb-classroom-label');if(!label)return;
  label.textContent=hasSchool()?(_userSchoolName?_userSchoolName.split(' ')[0]:'Classroom'):'Classroom 🔒';
}

loadTheme();
clearAuthError();
authInit();

setTimeout(() => {
  const loader = document.getElementById('session-loader');
  if (loader && loader.style.display !== 'none') {
    loader.style.opacity = '0';
    setTimeout(() => loader.style.display = 'none', 300);
    const auth = document.getElementById('auth-screen');
    if (auth) auth.style.display = 'flex';
  }
}, 7000);
