import { setupTheme } from './preferences.js';
import { relativeTimestamp } from './timestamps.mjs';
setupTheme();
const $ = selector => document.querySelector(selector);
const app = $('#chat-app'), roomId = app.dataset.room, me = app.dataset.user;
let myName = app.dataset.nickname, online = [], sound = false, audio, messages = new Map(), loading = false, initialized = false;
let cursor = '', firstCursor = '', moreHistory = false, typingSent = 0, choices = [], selection = 0;
const scroll = $('#message-scroll'), input = $('#message-input');
$('#generate-recovery').addEventListener('click', async () => {
  const button = $('#generate-recovery'), error = $('#recovery .form-error');
  button.disabled = true; error.textContent = '';
  try {
    const result = await api('identity/recovery-code', {});
    $('#saved-recovery-code').value = result.code; $('#recovery-result').hidden = false;
    $('#saved-recovery-code').focus(); $('#saved-recovery-code').select();
  } catch (problem) { error.textContent = problem.message; }
  finally { button.disabled = false; }
});
$('#recovery').addEventListener('close', () => { $('#saved-recovery-code').value = ''; $('#recovery-result').hidden = true; });
try { sound = localStorage.getItem('chatty-sound') === 'true'; } catch {}
const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
async function api(path, data) {
  const response = await fetch(`/api/${path}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (response.status === 401) { location.assign('/join'); throw new Error('Please join again.'); }
  if (!response.ok) { let body; try { body = await response.json(); } catch {} throw new Error(body?.error || 'Connection problem. Please try again.'); }
  return response.status === 204 ? null : response.json();
}
function soundState() { $('#sound-toggle').setAttribute('aria-pressed', String(sound)); $('#sound-toggle').setAttribute('aria-label', sound ? 'Mute notification sounds' : 'Enable notification sounds'); $('#sound-toggle .mute-slash').hidden = sound; }
function tone(mention = false) {
  if (!sound || !audio) return;
  audio.resume().catch(() => {});
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.connect(gain); gain.connect(audio.destination); osc.frequency.value = mention ? 780 : 490;
  gain.gain.setValueAtTime(.05, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .18);
  osc.start(); osc.stop(audio.currentTime + .2);
}
$('#sound-toggle').addEventListener('click', () => { sound = !sound; if (sound) audio ??= new AudioContext(); try { localStorage.setItem('chatty-sound', String(sound)); } catch {} soundState(); tone(); });
document.addEventListener('pointerdown', () => { if (sound) audio ??= new AudioContext(); }, { once: true });
soundState();
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal()));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
for (const [formId, endpoint, finish] of [
  ['new-room-form', 'rooms', result => location.assign(`/rooms/${result.room.id}`)],
  ['rename-form', 'rename', result => { myName = result.nickname; document.querySelectorAll('.my-name').forEach(el => el.textContent = myName); $('#rename').close(); }],
]) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true; form.querySelector('.form-error').textContent = '';
    try { finish(await api(endpoint, Object.fromEntries(new FormData(form)))); }
    catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
async function notifications() {
  try {
    const result = await api('notifications');
    $('#notification-count').textContent = result.count > 99 ? '99+' : result.count;
    $('#notification-count').hidden = !result.count;
    const list = $('#notification-list'); list.replaceChildren();
    if (!result.notifications.length) list.append(node('p', '', 'You’re all caught up. Good things take conversation.'));
    for (const item of result.notifications) {
      const link = node('a', 'notification-item'); link.href = `/rooms/${item.room_id}#message-${item.message_id}`;
      link.append(node('strong', '', `${item.nickname || 'Someone'} mentioned you`), node('p', '', item.preview), node('small', '', `# ${item.room_name}`)); list.append(link);
    }
  } catch { $('#notification-list').replaceChildren(node('p', '', 'Could not load mentions. Try again.')); }
}
$('#notifications-toggle').addEventListener('click', () => { const panel = $('#notifications-panel'); panel.hidden = !panel.hidden; $('#notifications-toggle').setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) notifications(); });
$('#read-notifications').addEventListener('click', async () => { try { await api('notifications/read', {}); await notifications(); } catch {} });
document.addEventListener('click', event => { if (!event.target.closest('.notifications-wrap')) { $('#notifications-panel').hidden = true; $('#notifications-toggle').setAttribute('aria-expanded', 'false'); } });
function avatar(user) { const el = node('span', 'avatar', (user.nickname || '?').slice(0, 2).toUpperCase()); if (/^#[0-9a-f]{6}$/i.test(user.color)) el.style.setProperty('--avatar', user.color); return el; }
function renderPeople() {
  const list = $('#people-list'); if (!list) return;
  list.replaceChildren(); $('#people-count').textContent = online.length;
  for (const person of online) {
    const el = node('div', 'person'), label = node('span', '', person.nickname); if (person.human_id === me) label.append(node('small', '', ' (you)'));
    el.append(avatar(person), label, node('i', 'status-dot')); list.append(el);
  }
  const mobileList = $('#mobile-people-list');
  if (mobileList) mobileList.replaceChildren(...[...list.children].map(el => el.cloneNode(true)));
}
function bottom() { return !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90; }
function goBottom() { if (scroll) scroll.scrollTop = scroll.scrollHeight; $('#new-messages')?.setAttribute('hidden', ''); }
function contentNode(content) {
  const paragraph = node('p', 'message-content');
  for (const part of content.split(/(@[a-zA-Z0-9_.-]+)/g)) {
    if (part.startsWith('@')) paragraph.append(node('span', 'mention', part.toLowerCase() === '@everyone' ? '@EVERYONE' : part));
    else paragraph.append(document.createTextNode(part));
  }
  return paragraph;
}
function renderMessages() {
  const list = $('#messages'); if (!list) return;
  const fragment = document.createDocumentFragment(); let previous;
  const sorted = [...messages.values()].sort((a, b) => (a.cursor || `${a.created_at}|${a.id}`).localeCompare(b.cursor || `${b.created_at}|${b.id}`));
  for (const message of sorted) {
    if (message.type !== 'message') { const el = node('div', 'system-message', message.content); el.id = `message-${message.id}`; fragment.append(el); previous = null; continue; }
    const own = message.human_id === me, grouped = previous?.human_id === message.human_id;
    const el = node('article', `message${own ? ' own' : ''}${grouped ? ' grouped' : ''}`); el.id = `message-${message.id}`;
    const body = node('div', 'message-body'), meta = node('div', 'message-meta');
    meta.append(node('strong', '', message.nickname || 'Former member')); if (own) meta.append(node('span', 'you-tag', 'YOU'));
    const time = node('time', '', relativeTimestamp(message.created_at)); time.dateTime = message.created_at; time.title = new Date(message.created_at).toLocaleString(); meta.append(time);
    body.append(meta, contentNode(message.content)); el.append(avatar(message), body); fragment.append(el); previous = message;
  }
  list.replaceChildren(fragment);
}
function addMessages(items) { for (const item of items) messages.set(item.id, item); renderMessages(); }
function refreshTimestamps() {
  if (document.hidden) return;
  const now = new Date();
  document.querySelectorAll('#messages time[datetime]').forEach(time => {
    const label = relativeTimestamp(time.dateTime, now);
    if (time.textContent !== label) time.textContent = label;
  });
}
// Update labels in place: no network polling, message re-render, or scroll changes.
const timestampTimer = setInterval(refreshTimestamps, 15000);
document.addEventListener('visibilitychange', refreshTimestamps);
window.addEventListener('pagehide', () => clearInterval(timestampTimer), { once: true });
async function catchUp() {
  if (!roomId || loading) return;
  loading = true; const atBottom = bottom();
  try {
    let next = cursor, again;
    do {
      const result = await api(`rooms/${roomId}/history${next ? `?after=${encodeURIComponent(next)}` : ''}`);
      addMessages(result.messages);
      if (!initialized) { firstCursor = result.messages[0]?.cursor || ''; moreHistory = result.more; $('#load-earlier').hidden = !moreHistory; }
      const last = result.messages.at(-1); if (last) cursor = last.cursor;
      again = Boolean(next && result.more && last); next = cursor;
      initialized = true;
    } while (again);
    if (atBottom) goBottom();
    if (location.hash.startsWith('#message-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  } catch (error) { $('#send-error').textContent = error.message; }
  finally { loading = false; }
}
if (roomId) {
  $('#load-earlier').addEventListener('click', async () => {
    if (!firstCursor) return; const button = $('#load-earlier'); button.disabled = true;
    try {
      const oldHeight = scroll.scrollHeight, oldTop = scroll.scrollTop;
      const result = await api(`rooms/${roomId}/history?before=${encodeURIComponent(firstCursor)}`);
      addMessages(result.messages); firstCursor = result.messages[0]?.cursor || firstCursor; button.hidden = !result.more;
      scroll.scrollTop = oldTop + scroll.scrollHeight - oldHeight;
    } catch (error) { $('#send-error').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#new-messages').addEventListener('click', goBottom);
  scroll.addEventListener('scroll', () => { if (bottom()) $('#new-messages').hidden = true; });
  $('#message-form').addEventListener('submit', async event => {
    event.preventDefault(); const content = input.value.trim(); if (!content) return;
    const button = $('.send-button'); button.disabled = true; $('#send-error').textContent = '';
    try { const message = await api(`rooms/${roomId}/messages`, { content }); addMessages([message]); input.value = ''; input.style.height = ''; $('#mention-options').hidden = true; goBottom(); }
    catch (error) { $('#send-error').textContent = error.message; }
    finally { button.disabled = false; input.focus(); }
  });
  function mentionMatch() { return input.value.slice(0, input.selectionStart).match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/); }
  function choose(index) {
    const match = mentionMatch(); if (!match || !choices[index]) return;
    const end = input.selectionStart, start = end - match[1].length - 1;
    input.setRangeText(`@${choices[index]} `, start, end, 'end'); $('#mention-options').hidden = true; input.focus();
  }
  function renderChoices() {
    const box = $('#mention-options'); box.replaceChildren(); box.hidden = !choices.length;
    choices.forEach((name, index) => { const button = node('button', '', `@${name}`); button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(selection === index)); button.addEventListener('click', () => choose(index)); box.append(button); });
  }
  input.addEventListener('input', () => {
    input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
    if (Date.now() - typingSent > 700) { typingSent = Date.now(); api(`rooms/${roomId}/typing`, { active: Boolean(input.value.trim()) }).catch(() => {}); }
    const match = mentionMatch(); choices = match ? [...new Set(['everyone', ...online.filter(p => p.human_id !== me).map(p => p.nickname)])].filter(name => name.toLowerCase().startsWith(match[1].toLowerCase())).slice(0, 6) : []; selection = 0; renderChoices();
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (!$('#mention-options').hidden) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); selection = (selection + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; renderChoices(); return; }
      if (['Tab', 'Enter'].includes(event.key)) { event.preventDefault(); choose(selection); return; }
      if (event.key === 'Escape') { $('#mention-options').hidden = true; return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!$('.send-button').disabled) $('#message-form').requestSubmit(); }
  });
}
function addRoom(room) {
  if ([...document.querySelectorAll('[data-room-link]')].some(el => el.dataset.roomLink === room.id)) return;
  const link = node('a', 'room-link'); link.href = `/rooms/${room.id}`; link.dataset.roomLink = room.id;
  const count = node('small', '', '0'); count.dataset.roomCount = room.id;
  link.append(node('span', 'room-hash', '#'), node('span', '', room.name), count); $('#room-nav').append(link);
  const grid = $('#room-grid');
  if (grid) { const card = node('a', 'room-card color-0'); card.href = link.href; card.append(node('span', 'card-hash', '#'), node('h3', '', room.name), node('p', '', room.description || 'A new space for a fresh conversation.'), node('div', '', 'Join the conversation →')); grid.append(card); }
}
const events = new EventSource(roomId ? `/api/rooms/${roomId}/stream` : '/api/stream');
events.onopen = () => {
  $('#connection').classList.remove('offline'); $('#connection span').textContent = 'Live & connected';
  catchUp(); notifications(); api('rooms').then(rooms => { for (const room of rooms) { addRoom(room); document.querySelectorAll('[data-room-count]').forEach(el => { if (el.dataset.roomCount === room.id) el.textContent = room.online; }); } }).catch(() => {});
};
events.onerror = () => { $('#connection').classList.add('offline'); $('#connection span').textContent = 'Reconnecting…'; };
events.addEventListener('message', event => {
  const message = JSON.parse(event.data); if (message.room_id !== roomId || messages.has(message.id)) return;
  const atBottom = bottom(); addMessages([message]);
  if (atBottom) goBottom(); else $('#new-messages').hidden = false;
  if (message.type === 'message' && message.human_id !== me) tone();
});
events.addEventListener('presence', event => { const data = JSON.parse(event.data); document.querySelectorAll('[data-room-count]').forEach(el => { if (el.dataset.roomCount === data.roomId) el.textContent = data.count; }); if (data.roomId === roomId) $('#room-online').textContent = `${data.count} online`; });
events.addEventListener('userlist', event => { online = JSON.parse(event.data); renderPeople(); });
events.addEventListener('typing', event => { const names = JSON.parse(event.data).filter(user => user.human_id !== me).map(user => user.nickname); if ($('#typing')) $('#typing').textContent = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing…` : ''; });
events.addEventListener('mention', () => { tone(true); notifications(); });
events.addEventListener('notificationsread', notifications);
events.addEventListener('newroom', event => addRoom(JSON.parse(event.data)));
events.addEventListener('renamed', event => { const data = JSON.parse(event.data); if (data.humanId === me) { myName = data.nickname; document.querySelectorAll('.my-name').forEach(el => el.textContent = myName); } for (const message of messages.values()) if (message.human_id === data.humanId) message.nickname = data.nickname; renderMessages(); });
window.addEventListener('pagehide', () => events.close());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
