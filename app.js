const STORAGE_KEY = 'momenty-notes-v1';
const notesGrid = document.querySelector('#notesGrid');
const noteDialog = document.querySelector('#noteDialog');
const noteForm = document.querySelector('#noteForm');
const $ = (selector) => document.querySelector(selector);
let notes = loadNotes();
let editingId = null;
let draftTasks = [];
let currentFilter = 'all';
let installPrompt = null;

function loadNotes() {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function formatDate(value) { return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short' }).format(new Date(value)); }
function formatReminder(value) { return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2400); }
function render() {
  const query = $('#searchInput').value.trim().toLocaleLowerCase('ru');
  const shown = notes.filter(note => {
    const matches = `${note.title} ${note.body} ${(note.tasks || []).map(task => task.text).join(' ')}`.toLocaleLowerCase('ru').includes(query);
    return matches && (currentFilter === 'all' || (currentFilter === 'pinned' && note.pinned) || (currentFilter === 'tasks' && note.isTask));
  }).sort((a,b) => Number(b.pinned)-Number(a.pinned) || b.updatedAt-a.updatedAt);
  $('#noteCount').textContent = notes.length ? `· ${notes.length}` : '';
  notesGrid.innerHTML = shown.map(note => {
    const title = escapeHtml(note.title || 'Без названия');
    const taskHtml = note.isTask ? `<ul class="task-preview">${(note.tasks||[]).slice(0,4).map((task,index)=>`<li class="${task.done?'done':''}"><input type="checkbox" data-task-note="${note.id}" data-task-index="${index}" ${task.done?'checked':''} aria-label="Отметить ${escapeHtml(task.text)}"><span>${escapeHtml(task.text)}</span></li>`).join('')}</ul>` : '';
    const body = note.isTask ? '' : `<p class="note-text">${escapeHtml(note.body)}</p>`;
    const reminder = note.reminderAt && !note.reminded ? `<span class="card-reminder">⏰ ${escapeHtml(formatReminder(note.reminderAt))}</span>` : `<span>${escapeHtml(formatDate(note.updatedAt))}</span>`;
    return `<article class="note-card ${note.pinned?'pinned':''}" data-open="${note.id}"><span class="card-pin">${note.pinned?'◆':''}</span><div class="card-tools"><button data-action="share" data-id="${note.id}" aria-label="Поделиться">↗</button><button data-action="delete" data-id="${note.id}" aria-label="Удалить">×</button></div><h3>${title}</h3>${body}${taskHtml}<div class="note-meta"><span class="tag">${note.isTask?'Список':'Заметка'}</span>${reminder}</div></article>`;
  }).join('');
  const empty = notes.length === 0;
  $('#emptyState').classList.toggle('hidden', !empty || Boolean(query));
  notesGrid.classList.toggle('hidden', empty && !query);
  if (notes.length && shown.length === 0) { notesGrid.classList.remove('hidden'); notesGrid.innerHTML = '<p class="subtitle">Ничего не найдено. Попробуй другой запрос.</p>'; }
  renderReminders();
}
function renderReminders() {
  const upcoming = notes.filter(note => note.reminderAt && !note.reminded).sort((a,b)=>new Date(a.reminderAt)-new Date(b.reminderAt));
  $('#reminderPanel').classList.toggle('hidden', upcoming.length === 0);
  $('#reminderList').innerHTML = upcoming.map(note => `<div class="reminder-row"><span>${escapeHtml(note.title || 'Напоминание')}</span><time>${escapeHtml(formatReminder(note.reminderAt))}</time></div>`).join('');
}
function openEditor(note = null) {
  editingId = note?.id || null; draftTasks = note ? [...(note.tasks || [])] : [];
  $('#dialogEyebrow').textContent = note ? 'РЕДАКТИРОВАТЬ ЗАПИСЬ' : 'НОВАЯ ЗАПИСЬ';
  $('#noteTitle').value = note?.title || ''; $('#noteBody').value = note?.body || '';
  $('#taskMode').checked = Boolean(note?.isTask); $('#pinMode').checked = Boolean(note?.pinned);
  $('#reminderAt').value = note?.reminderAt ? toLocalDateTime(note.reminderAt) : '';
  $('#taskEditor').classList.toggle('hidden', !$('#taskMode').checked); renderDraftTasks(); noteDialog.showModal();
}
function toLocalDateTime(date) { const d = new Date(date); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); }
function renderDraftTasks() { $('#draftTasks').innerHTML = draftTasks.map(task=>`<li>${escapeHtml(task.text)} ${task.done?'✓':''}</li>`).join(''); }
function saveNote(event) {
  event.preventDefault();
  const now = Date.now(); const reminderValue = $('#reminderAt').value;
  const reminderAt = reminderValue ? new Date(reminderValue).toISOString() : null;
  const existing = notes.find(note=>note.id===editingId);
  const note = { id: editingId || crypto.randomUUID(), title:$('#noteTitle').value.trim(), body:$('#noteBody').value.trim(), isTask:$('#taskMode').checked, tasks:draftTasks, pinned:$('#pinMode').checked, reminderAt, reminded: reminderAt && existing?.reminderAt === reminderAt ? existing.reminded : false, createdAt:existing?.createdAt||now, updatedAt:now };
  if (!note.title && !note.body && !note.tasks.length) { toast('Добавь заголовок, текст или пункт списка'); return; }
  if (reminderAt && new Date(reminderAt).getTime() <= now) { toast('Выбери время в будущем'); return; }
  if (existing) notes = notes.map(item=>item.id===editingId?note:item); else notes.push(note);
  persist(); noteDialog.close(); render(); scheduleReminder(note); toast('Запись сохранена');
}
function scheduleReminder(note) {
  if (!note.reminderAt || note.reminded) return;
  const delay = new Date(note.reminderAt).getTime() - Date.now();
  if (delay <= 0) { fireReminder(note.id); return; }
  if (delay > 0 && delay < 2147480000) setTimeout(() => fireReminder(note.id), delay);
}
function fireReminder(id) {
  const note = notes.find(item=>item.id===id); if (!note || note.reminded) return;
  if ('Notification' in window && Notification.permission === 'granted') new Notification(note.title || 'Напоминание', { body:note.body || 'Пора вернуться к своей заметке.', icon:'icon.svg', tag:`note-${id}` });
  else toast(`Напоминание: ${note.title || 'пора к делу'}`);
  note.reminded = true; persist(); render();
}
async function enableNotifications() {
  if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления'); return; }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') { toast('Уведомления включены'); notes.forEach(scheduleReminder); }
  else toast('Разреши уведомления в настройках браузера');
}
async function shareNote(id) {
  const note = notes.find(item=>item.id===id); if (!note) return;
  const text = `${note.title || 'Заметка'}${note.body ? `\n\n${note.body}` : ''}${note.tasks?.length ? `\n\n${note.tasks.map(t=>`${t.done?'☑':'☐'} ${t.text}`).join('\n')}` : ''}`;
  try { if (navigator.share) await navigator.share({title:note.title||'Моя заметка',text}); else { await navigator.clipboard.writeText(text); toast('Текст скопирован — можно отправить'); } }
  catch(error) { if (error.name !== 'AbortError') toast('Не удалось поделиться'); }
}

$('#todayLabel').textContent = new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toLocaleUpperCase('ru');
$('#createButton').addEventListener('click',()=>openEditor()); $('#emptyCreate').addEventListener('click',()=>openEditor());
$('#closeDialog').addEventListener('click',()=>noteDialog.close()); $('#cancelButton').addEventListener('click',()=>noteDialog.close());
noteForm.addEventListener('submit',saveNote); $('#searchInput').addEventListener('input',render);
$('#taskMode').addEventListener('change',event=>$('#taskEditor').classList.toggle('hidden',!event.target.checked));
$('#addTaskButton').addEventListener('click',()=>{const input=$('#taskInput');const text=input.value.trim();if(text){draftTasks.push({text,done:false});input.value='';renderDraftTasks();}});
$('#taskInput').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('#addTaskButton').click();}});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{document.querySelector('.filter.active').classList.remove('active');button.classList.add('active');currentFilter=button.dataset.filter;render();}));
notesGrid.addEventListener('click',event=>{const tool=event.target.closest('[data-action]');if(tool){event.stopPropagation();const id=tool.dataset.id;if(tool.dataset.action==='share')shareNote(id);if(tool.dataset.action==='delete'){notes=notes.filter(note=>note.id!==id);persist();render();toast('Заметка удалена');}return;}const card=event.target.closest('[data-open]');if(card&&!event.target.matches('input[type=checkbox]'))openEditor(notes.find(note=>note.id===card.dataset.open));});
notesGrid.addEventListener('change',event=>{const input=event.target.closest('[data-task-note]');if(!input)return;const note=notes.find(item=>item.id===input.dataset.taskNote);if(note){note.tasks[Number(input.dataset.taskIndex)].done=input.checked;note.updatedAt=Date.now();persist();render();}});
$('#notificationButton').addEventListener('click',enableNotifications);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#installButton').classList.remove('hidden');});
$('#installButton').addEventListener('click',async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#installButton').classList.add('hidden');}});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
notes.forEach(scheduleReminder); render();
