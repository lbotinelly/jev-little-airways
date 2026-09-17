// Jev monitor — a slide-out DOM drawer that visualizes the decision traffic:
// what every aircraft is currently deciding, and every ask() exchange rendered
// in Jev API format (request {state, model, questions} / response {answers}).
// Toggle with J, the JEV DATA rail button, or LittleAirways.jevMonitor.
import { toJevRequest } from './jev-provider.mjs';

const MAX_FEED = 60;
const COST_PER_MTOK_IN = 0.042; // TypeSafe list price; output tokens are free.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function highlightJson(value) {
  const json = JSON.stringify(value, null, 2);
  return json.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, kw) => {
    if (str) return `<span class="jm-${colon ? 'key' : 'str'}">${esc(str)}</span>${colon || ''}`;
    if (kw) return `<span class="jm-kw">${kw}</span>`;
    return `<span class="jm-num">${esc(m)}</span>`;
  });
}

// Jev-shaped view of any exchange: live packets carry the raw upstream JSON on
// .jev; mock packets are reshaped for display (and labeled as such).
function jevResponseView(ex) {
  if (ex.response?.jev) {
    const { model, answers, usage } = ex.response.jev.response;
    return { model, answers, usage };
  }
  const answers = {};
  for (const a of (ex.response?.answers || [])) {
    const probabilities = {}; let top = null;
    for (const p of a.probabilities) { probabilities[p.value] = +p.probability.toFixed(4); if (!top || p.probability > top.probability) top = p; }
    answers[a.questionId] = { type: 'choice', choice: top?.value, probabilities, confidence: +a.confidence.toFixed(3), _factors: a.factors };
  }
  return { model: `${ex.model} (mock — reshaped to Jev format for display)`, answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

function decisionLabel(questions, questionId, value) {
  const q = questions?.find(q => q.id === questionId);
  const label = q?.options?.find(o => o.value === value)?.label || value;
  return label.replace('Continue to ', 'TO ').replace('Divert to ', 'DIVERT ').replace('Enter a holding pattern', 'HOLD').replace('Land at ', 'LAND ');
}

const topOf = a => a.probabilities.reduce((x, y) => y.probability > x.probability ? y : x);

export function createJevMonitor({ getWorld }) {
  const root = document.createElement('aside');
  root.id = 'jev-monitor';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Jev decision data monitor');
  root.innerHTML = `
    <div class="jm-head">
      <span class="jm-title">JEV MONITOR</span>
      <span class="jm-live" id="jm-live"></span>
      <button class="jm-icon" id="jm-close" aria-label="Close Jev monitor">✕</button>
    </div>
    <div class="jm-stats" id="jm-stats">—</div>
    <div class="jm-section"><div class="jm-h">DECISIONS NOW <span class="jm-hint">click a plane to filter the feed</span></div><div class="jm-planes" id="jm-planes"></div></div>
    <div class="jm-section jm-grow"><div class="jm-h">EXCHANGE FEED <span class="jm-hint">Jev API format</span><button class="jm-pause" id="jm-pause" type="button" aria-label="Pause the feed">&#10074;&#10074; pause</button><span class="jm-new" id="jm-new" hidden></span></div><div class="jm-feed" id="jm-feed"></div></div>`;
  document.body.appendChild(root);

  const feed = root.querySelector('#jm-feed'), planesEl = root.querySelector('#jm-planes'), statsEl = root.querySelector('#jm-stats'), liveEl = root.querySelector('#jm-live');
  const pauseBtn = root.querySelector('#jm-pause'), newBadge = root.querySelector('#jm-new');
  const state = { open: false, filter: null, feedPaused: false, pending: [], totals: { calls: 0, errors: 0, inTok: 0, outTok: 0 }, refreshTimer: 0 };

  function sim() { return getWorld()?.sim; }

  function refreshStats() {
    const s = sim(), c = s?.client;
    const t = state.totals;
    const cost = t.inTok ? ` · $${(t.inTok * COST_PER_MTOK_IN / 1e6).toFixed(4)}` : '';
    statsEl.innerHTML = '';
    statsEl.append(
      Object.assign(document.createElement('span'), { textContent: `provider / ${c?.model ?? '—'}` }),
      Object.assign(document.createElement('span'), { textContent: `${t.calls} exchanges · ${t.errors} errors · ${(t.inTok / 1000).toFixed(1)}k in / ${(t.outTok / 1000).toFixed(1)}k out tok${cost}` })
    );
  }

  function refreshPlanes() {
    const s = sim(); if (!s) return;
    planesEl.innerHTML = '';
    for (const p of s.planes) {
      const packet = p.packet, cards = packet?.answers || [];
      const route = cards.find(a => a.questionId === 'route'), broadcast = cards.find(a => a.questionId === 'broadcast');
      const response = cards.find(a => a.questionId === 'response'), clearance = cards.find(a => a.questionId === 'clearance');
      const emergency = s.hasEmergency(p);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'jm-plane' + (state.filter === p.id ? ' jm-active' : '');
      card.style.setProperty('--c', p.color);
      card.innerHTML = `
        <span class="jm-p-id">${esc(p.id)}</span>
        <span class="jm-p-phase${emergency || p.error ? ' jm-bad' : ''}">${esc(p.error ? 'MODEL ERROR' : emergency ? 'ENGAGED' : p.phase === 'landed' ? 'HOME SAFE' : p.reaction !== 'maintain' ? 'HELPING OUT' : 'CRUISING')}</span>
        <span class="jm-p-route">${route ? `${esc(decisionLabel(p.questions, 'route', topOf(route).value))} <b>${Math.round(topOf(route).probability * 100)}%</b> · conf ${Math.round((route.confidence || 0) * 100)}%` : 'asking…'}</span>
        <span class="jm-p-sub">${broadcast ? `mayday ${topOf(broadcast).value === 'true' ? 'YES' : 'no'} ${Math.round(topOf(broadcast).probability * 100)}%` : ''}${response ? ` · traffic ${esc(decisionLabel(p.questions, 'response', topOf(response).value))}` : ''}${clearance ? ` · ${esc(decisionLabel(p.questions, 'clearance', topOf(clearance).value))}` : ''}</span>
        <span class="jm-p-sub">→ ${esc(s.airports.find(a => a.id === p.destination)?.name || 'the islands')} · fuel ${Math.round(p.fuel * 100)}%</span>`;
      card.addEventListener('click', () => { state.filter = state.filter === p.id ? null : p.id; applyFilter(); refreshPlanes(); });
      planesEl.appendChild(card);
    }
  }

  function applyFilter() {
    for (const el of feed.children) el.hidden = !!state.filter && el.dataset.plane !== state.filter;
  }

  function addEntry(ex) {
    state.totals.calls++;
    const usage = ex.error ? null : ex.response?.jev?.response?.usage;
    if (usage) { state.totals.inTok += usage.input_tokens || 0; state.totals.outTok += usage.output_tokens || 0; }
    if (ex.error) state.totals.errors++;
    if (state.feedPaused) {
      state.pending.push(ex);
      if (state.pending.length > 200) state.pending.shift();
      newBadge.textContent = `+${state.pending.length} new`;
      newBadge.hidden = false;
      return;
    }
    renderEntry(ex);
  }

  function renderEntry(ex) {
    const usage = ex.error ? null : ex.response?.jev?.response?.usage;
    const s = sim(), plane = s?.planes.find(p => p.id === ex.aircraftId);
    const isTower = !ex.aircraftId && ex.state?.role === 'tower';
    const who = ex.aircraftId || (isTower ? `${ex.state.airport?.name || ''} TWR` : 'world');
    const entry = document.createElement('div');
    entry.className = 'jm-ex' + (ex.error ? ' jm-err' : '');
    entry.dataset.plane = ex.aircraftId || 'TWR';
    entry.style.setProperty('--c', plane?.color || (isTower ? '#f2d286' : '#8c9caa'));
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const lat = ex.error ? 'error' : `${Math.round(ex.response.latencyMs)} ms`;
    const tok = usage ? `${usage.input_tokens} in · ${usage.output_tokens} out tok` : (ex.error ? '' : 'mock · no tokens');
    const request = toJevRequest(ex.state, ex.questions, ex.model.includes('jev') ? 'jev-latest' : 'jev-latest (would be sent)');
    const responseView = ex.error ? { error: ex.error } : jevResponseView(ex);
    entry.innerHTML = `
      <div class="jm-ex-head">
        <span class="jm-dot"></span><span class="jm-ex-id">${esc(who)}</span>
        <span class="jm-ex-q">${ex.questions.map(q => q.id).join(' · ')}</span>
        <span class="jm-ex-time">${time}</span><span class="jm-ex-lat">${lat}</span>${tok ? `<span class="jm-ex-tok">${tok}</span>` : ''}
      </div>
      <details class="jm-ex-body">
        <summary>request / response — Jev format</summary>
        <div class="jm-lab">POST /jev → api.typesafe.ai/v1/systemone</div>
        <pre class="jm-json">${highlightJson(request)}</pre>
        <div class="jm-lab">${ex.error ? 'failed' : `200 OK · ${Math.round(ex.response.latencyMs)} ms`}</div>
        <pre class="jm-json">${highlightJson(responseView)}</pre>
      </details>`;
    entry.hidden = !!state.filter && entry.dataset.plane !== state.filter;
    const pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
    feed.prepend(entry);
    while (feed.children.length > MAX_FEED) feed.lastChild.remove();
    if (pinned) feed.scrollTop = 0;
    liveEl.classList.remove('jm-flash'); void liveEl.offsetWidth; liveEl.classList.add('jm-flash');
  }

  function open() {
    state.open = true; root.classList.add('jm-open');
    clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => { refreshPlanes(); refreshStats(); }, 500);
    refreshPlanes(); refreshStats();
  }
  function close() {
    state.open = false; root.classList.remove('jm-open'); clearInterval(state.refreshTimer);
  }

  root.querySelector('#jm-close').addEventListener('click', close);
  pauseBtn.addEventListener('click', () => {
    state.feedPaused = !state.feedPaused;
    pauseBtn.classList.toggle('jm-on', state.feedPaused);
    pauseBtn.innerHTML = state.feedPaused ? '&#9654; resume' : '&#10074;&#10074; pause';
    pauseBtn.setAttribute('aria-label', state.feedPaused ? 'Resume the feed' : 'Pause the feed');
    if (!state.feedPaused) {
      const backlog = state.pending;
      state.pending = [];
      newBadge.hidden = true;
      for (const item of backlog) renderEntry(item);
    }
  });
  return {
    open, close,
    toggle() { state.open ? close() : open(); },
    isOpen: () => state.open,
    push(ex) { addEntry(ex); if (state.open) refreshStats(); },
    dump() { return [...feed.children].map(el => el.dataset.plane); },
    dispose() { close(); root.remove(); }
  };
}
