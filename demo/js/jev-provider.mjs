// Decision provider that backs Little Airways' `ask(state, questions)` boundary
// with the real TypeSafe API (Jev). Speaks little-airways.ask.v1 on one side and
// POST /jev (the local proxy in ../server.mjs → api.typesafe.ai) on the other.
//
// Mapping notes:
// - Every sim question (categorical or boolean) becomes a Jev `choice` question,
//   so we get a real probability distribution AND a real confidence for each.
//   (Jev's `noul` has no confidence field, so booleans map to choice true/false.)
// - The sim state object is passed through as structured JSON state.
// - Jev has no "factors" output; we derive short honest state facts locally so
//   the THINKING panel keeps working. They describe the state, not Jev's reasoning.
export const KEY_STORAGE = 'littleAirways.typesafeKey';
const SCHEMA_VERSION = 'little-airways.ask.v1';
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

// The exact request shape sent to Jev — also used by the Jev monitor to render
// any exchange (including mock ones) in Jev format.
export function toJevRequest(state, questions, model = 'jev-latest') {
  const jevQuestions = {};
  for (const q of questions) {
    jevQuestions[q.id] = {
      type: 'choice',
      instructions: q.prompt,
      criteria: Object.fromEntries(q.type === 'boolean'
        ? [['true', `Yes — ${q.prompt}`], ['false', `No — ${q.prompt}`]]
        : q.options.map(o => [o.value, o.description ?? o.label]))
    };
  }
  return { state, model, questions: jevQuestions };
}

export function createJevProvider({ endpoint = '/jev', key = '', model = 'jev-latest' } = {}) {
  const stats = { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastLatencyMs: null, upstreamModel: null };
  async function jevAsk(state, questions) {
    if (!key) throw new Error('No API key set (open MOCK / API to add one)');
    const request = toJevRequest(state, questions, model);
    stats.requests++;
    const before = performance.now();
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(request)
      });
    } catch (e) {
      stats.errors++;
      throw new Error(`Jev unreachable (is server.mjs running?): ${e.message}`);
    }
    stats.lastLatencyMs = Math.round(performance.now() - before);
    if (!response.ok) {
      stats.errors++;
      let detail = '';
      try { const text = await response.text(); detail = (JSON.parse(text)?.error || text).slice(0, 120); } catch { /* keep empty */ }
      throw new Error(`Jev API ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    stats.upstreamModel = data.model || model;
    if (data.usage) { stats.inputTokens += data.usage.input_tokens || 0; stats.outputTokens += data.usage.output_tokens || 0; }
    const answers = questions.map(q => {
      const a = data.answers?.[q.id];
      if (!a || !a.probabilities) throw new Error(`Jev API: missing answer for "${q.id}"`);
      const values = q.type === 'boolean' ? ['true', 'false'] : q.options.map(o => o.value);
      let probabilities = values.map(value => ({ value, probability: clamp01(a.probabilities[value] ?? 0) }));
      const sum = probabilities.reduce((s, p) => s + p.probability, 0);
      if (sum <= 0) throw new Error(`Jev API: empty distribution for "${q.id}"`);
      if (Math.abs(sum - 1) > 1e-6) probabilities = probabilities.map(p => ({ ...p, probability: p.probability / sum }));
      return {
        questionId: q.id,
        type: q.type,
        probabilities,
        confidence: clamp01(a.confidence ?? 0.5),
        factors: stateFactors(state).slice(0, 3)
      };
    });
    return { schemaVersion: SCHEMA_VERSION, model: `jev (${stats.upstreamModel})`, answers, jev: { request, response: data } };
  }
  jevAsk.stats = stats;
  return jevAsk;
}

function stateFactors(state) {
  const facts = [];
  const aircraft = state?.aircraft || {};
  const faults = Object.entries(aircraft.faults || {}).filter(([, v]) => v > 0).map(([k]) => k);
  if (faults.length) facts.push(`Active faults: ${faults.join(', ')}.`);
  const endurance = aircraft.fuelMinutesRemaining, eta = aircraft.destinationMinutesRemaining;
  if (faults.includes('fuel') && Number.isFinite(endurance)) facts.push(`Fuel leak: about ${Math.round(endurance)} min of fuel left.`);
  if (Number.isFinite(aircraft.fuel)) facts.push(`Fuel ${Math.round(aircraft.fuel * 100)}%${aircraft.fuel < 0.16 ? ' — below reserve.' : '.'}`);
  if (Number.isFinite(endurance) && Number.isFinite(eta)) facts.push(`${Math.round(endurance)} min of fuel vs ${Math.round(eta)} min to destination.`);
  const emergencies = state?.nearbyEmergencies || [];
  if (emergencies.length) facts.push(`${emergencies.length} nearby aircraft emergency${emergencies.length > 1 ? 'ies' : ''} (${emergencies.map(e => e.id).join(', ')}).`);
  if (state?.weather?.windKt != null) facts.push(`Wind ${state.weather.windKt} kt.`);
  facts.push(aircraft.kind === 'jet' ? 'Jet: paved runways only.' : 'Prop: small airstrips available.');
  return facts;
}
