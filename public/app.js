'use strict';

/*
 * Lifeline front-end. Plain JavaScript, no framework, no third-party scripts.
 * All server/AI text is rendered with textContent (never innerHTML) so it can
 * never inject markup.
 */
(function lifeline() {
  const STORAGE_KEY = 'lifeline:last';
  const CHECKS_KEY = 'lifeline:checks';
  const TEXT_KEY = 'lifeline:largeText';
  const REQUEST_TIMEOUT_MS = 30000;

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('profile-form'),
    submit: $('submit'),
    formError: $('form-error'),
    results: $('results'),
    resultsTitle: $('results-title'),
    banner: $('emergency-banner'),
    hazardLabel: $('hazard-label'),
    severity: $('severity-badge'),
    score: $('readiness-score'),
    meter: $('readiness-meter'),
    readinessLabel: $('readiness-label'),
    conditions: $('conditions'),
    aiCard: $('ai-card'),
    aiSource: $('ai-source'),
    aiSummary: $('ai-summary'),
    aiActions: $('ai-actions'),
    aiNotes: $('ai-notes'),
    aiReassurance: $('ai-reassurance'),
    immediateCard: $('immediate-card'),
    immediateList: $('immediate-list'),
    checklist: $('checklist'),
    progress: $('checklist-progress'),
    decisions: $('decisions'),
    review: $('review-advice'),
    mapLinks: $('map-links'),
    askSection: $('ask-section'),
    askForm: $('ask-form'),
    question: $('question'),
    askSubmit: $('ask-submit'),
    answer: $('answer'),
    location: $('location'),
    useLocation: $('use-location'),
    textSize: $('text-size'),
    netStatus: $('net-status'),
  };

  let lastProfile = null;
  let lastResult = null;
  let coords = null;

  /* ---------- storage helpers (storage may be unavailable) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  /* ---------- DOM helpers ---------- */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') node.textContent = v;
        else if (k === 'className') node.className = v;
        else node.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => node.append(c));
    return node;
  }
  function fill(list, items) {
    list.replaceChildren(...items);
  }

  /* ---------- form ---------- */
  function readProfile() {
    const data = new FormData(els.form);
    const num = (name) => Number(data.get(name));
    return {
      mode: data.get('mode'),
      hazard: data.get('hazard'),
      location: String(data.get('location') || '').trim(),
      coords: coords,
      household: { adults: num('adults'), children: num('children'), elderly: num('elderly'), pets: num('pets') },
      housing: data.get('housing'),
      hasVehicle: $('hasVehicle').checked,
      needs: data.getAll('needs'),
      supplies: data.getAll('supplies'),
      language: data.get('language'),
    };
  }

  function validateProfile(p) {
    const counts = p.household;
    if (!p.location && !p.coords) return 'Please enter your city or use your location so Lifeline can check live conditions.';
    if (!Number.isInteger(counts.adults) || counts.adults < 1 || counts.adults > 20) return 'Adults must be between 1 and 20.';
    for (const key of ['children', 'elderly', 'pets']) {
      if (!Number.isInteger(counts[key]) || counts[key] < 0 || counts[key] > 20) return 'Household numbers must be between 0 and 20.';
    }
    return '';
  }

  function showError(message) {
    els.formError.textContent = message;
    els.formError.hidden = !message;
  }

  async function postJson(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.replaceChildren(el('span', { className: 'loading' }, [el('span', { className: 'spinner', 'aria-hidden': 'true' }), document.createTextNode(label)]));
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const profile = readProfile();
    const problem = validateProfile(profile);
    showError(problem);
    if (problem) {
      els.location.focus();
      return;
    }
    setBusy(els.submit, true, 'Checking live conditions…');
    els.results.setAttribute('aria-busy', 'true');
    try {
      const result = await postJson('/api/plan', profile);
      lastProfile = profile;
      lastResult = result;
      store.set(STORAGE_KEY, { profile, result });
      render(result);
    } catch (err) {
      const cached = store.get(STORAGE_KEY, null);
      if (!navigator.onLine && cached) {
        showError('You are offline. Showing your last saved plan.');
        lastProfile = cached.profile;
        lastResult = cached.result;
        render(cached.result);
      } else {
        showError(err.name === 'AbortError' ? 'This is taking too long. Please try again.' : err.message);
      }
    } finally {
      setBusy(els.submit, false);
      els.results.setAttribute('aria-busy', 'false');
    }
  }

  /* ---------- rendering ---------- */
  function renderConditions(place, c) {
    const items = [];
    if (place) items.push(el('li', { text: `📍 ${place.name}` }));
    if (c) {
      if (c.temperature !== null) {
        const feels = c.apparentTemperature !== null ? ` · feels ${Math.round(c.apparentTemperature)}°C` : '';
        items.push(el('li', { text: `🌡 Now ${Math.round(c.temperature)}°C${feels}` }));
      }
      if (c.maxTemp !== null) items.push(el('li', { text: `☀ Peak next 3 days: ${Math.round(c.maxTemp)}°C` }));
      if (c.precip3d !== null) items.push(el('li', { text: `🌧 Rain next 3 days: ${Math.round(c.precip3d)} mm` }));
      if (c.maxWind !== null) items.push(el('li', { text: `💨 Max wind: ${Math.round(c.maxWind)} km/h` }));
      if (c.aqi !== null) items.push(el('li', { text: `🫁 Air quality (US AQI): ${Math.round(c.aqi)}` }));
    }
    if (!items.length || !c) items.push(el('li', { className: 'hint', text: 'Live data unavailable. Plan is based on your answers.' }));
    fill(els.conditions, items);
  }

  function renderAi(ai, source) {
    els.aiCard.hidden = !ai;
    if (!ai) return;
    els.aiSource.textContent = source === 'gemini' ? 'by Google Gemini' : '';
    els.aiSummary.textContent = ai.summary;
    fill(els.aiActions, ai.topActions.map((a) => el('li', null, [el('strong', { text: a.title }), document.createTextNode(` ${a.detail}`)])));
    fill(els.aiNotes, (ai.householdNotes || []).map((n) => el('li', { text: n })));
    els.aiReassurance.textContent = ai.reassurance || '';
  }

  function updateProgress() {
    const boxes = els.checklist.querySelectorAll('input[type="checkbox"]');
    const done = [...boxes].filter((b) => b.checked).length;
    els.progress.textContent = `${done} of ${boxes.length} done`;
  }

  function renderChecklist(items) {
    const saved = store.get(CHECKS_KEY, {});
    fill(els.checklist, items.map((item) => {
      const box = el('input', { type: 'checkbox', id: `chk-${item.id}` });
      box.checked = Boolean(saved[item.id]);
      box.addEventListener('change', () => {
        const state = store.get(CHECKS_KEY, {});
        state[item.id] = box.checked;
        store.set(CHECKS_KEY, state);
        updateProgress();
      });
      const text = el('span', null, [
        el('span', { className: `prio prio-${item.priority}`, text: item.priority }),
        el('span', { className: 'item-text', text: item.text }),
        el('span', { className: 'why', text: item.why }),
      ]);
      return el('li', null, [el('label', { for: `chk-${item.id}` }, [box, text])]);
    }));
    updateProgress();
  }

  function renderMapLinks(place, plan) {
    const near = place ? place.name : 'me';
    const queries = [
      ['Hospitals', `hospital near ${near}`],
      ['Relief shelters', `relief shelter near ${near}`],
      ['Pharmacies', `pharmacy open now near ${near}`],
      ['Police / fire station', `fire station near ${near}`],
    ];
    if (plan.hazard === 'heatwave') queries.push(['Cooling centres', `cooling centre near ${near}`]);
    fill(els.mapLinks, queries.map(([label, q]) => el('a', {
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: `${label} ↗`,
      'aria-label': `${label} on Google Maps (opens in a new tab)`,
    })));
  }

  function render(result) {
    const { plan, place, conditions, ai, source } = result;
    els.results.hidden = false;
    els.askSection.hidden = false;

    const urgent = plan.mode === 'emergency' || plan.severity === 'critical';
    els.banner.hidden = !urgent;
    if (urgent) {
      els.banner.replaceChildren(
        document.createTextNode('If anyone is in danger, call '),
        el('a', { href: `tel:${plan.emergency.number}`, text: plan.emergency.number }),
        document.createTextNode(' now.'),
      );
    }

    els.hazardLabel.textContent = plan.hazardLabel;
    els.severity.textContent = `${plan.severity} severity`;
    els.severity.className = `badge sev-${plan.severity}`;
    els.score.textContent = String(plan.readiness.score);
    els.meter.value = plan.readiness.score;
    els.readinessLabel.textContent = `${plan.readiness.label}. Water target: ${plan.supplies.waterLitres} L.`;

    renderConditions(place, conditions);
    renderAi(ai, source);

    els.immediateCard.hidden = plan.immediateActions.length === 0;
    fill(els.immediateList, plan.immediateActions.map((a) => el('li', { text: a })));

    renderChecklist(plan.checklist);
    fill(els.decisions, plan.decisions.map((d) => el('li', { text: d })));
    els.review.textContent = plan.reviewAdvice;
    renderMapLinks(place, plan);

    els.resultsTitle.focus();
  }

  /* ---------- plan as plain text (read aloud / share) ---------- */
  function planText() {
    if (!lastResult) return '';
    const { plan, ai } = lastResult;
    const lines = [`Lifeline plan: ${plan.hazardLabel} (${plan.severity} severity). Readiness ${plan.readiness.score} out of 100.`];
    if (ai) lines.push(ai.summary, ...ai.topActions.map((a, i) => `${i + 1}. ${a.title}. ${a.detail}`));
    if (plan.immediateActions.length) lines.push('Do this now:', ...plan.immediateActions);
    lines.push('Checklist:', ...plan.checklist.map((i) => `- ${i.text}`));
    lines.push(`Emergency number: ${plan.emergency.number}`);
    return lines.join('\n');
  }

  const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', mr: 'mr-IN', kn: 'kn-IN', ml: 'ml-IN', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', ar: 'ar-SA' };

  function readAloud(button) {
    if (!('speechSynthesis' in window)) {
      button.textContent = 'Read aloud not supported';
      return;
    }
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      button.textContent = 'Read plan aloud';
      return;
    }
    const utterance = new SpeechSynthesisUtterance(planText());
    utterance.lang = SPEECH_LANG[(lastProfile && lastProfile.language) || 'en'] || 'en-IN';
    utterance.rate = 0.95;
    utterance.onend = () => { button.textContent = 'Read plan aloud'; };
    speechSynthesis.speak(utterance);
    button.textContent = 'Stop reading';
  }

  async function sharePlan(button) {
    const text = planText();
    try {
      if (navigator.share) await navigator.share({ title: 'My Lifeline plan', text });
      else await navigator.clipboard.writeText(text);
      button.textContent = navigator.share ? 'Shared' : 'Copied!';
    } catch {
      button.textContent = 'Could not copy';
    }
    setTimeout(() => { button.textContent = 'Copy plan to share'; }, 2500);
  }

  /* ---------- ask ---------- */
  async function onAsk(event) {
    event.preventDefault();
    const question = els.question.value.trim();
    if (question.length < 3) {
      els.answer.className = 'answer';
      els.answer.textContent = 'Please type a longer question.';
      els.question.focus();
      return;
    }
    setBusy(els.askSubmit, true, 'Thinking…');
    try {
      const res = await postJson('/api/ask', { question, profile: lastProfile || readProfile() });
      els.answer.className = res.urgent ? 'answer urgent' : 'answer';
      els.answer.textContent = res.urgent ? `⚠ Call ${res.emergencyNumber} now.\n${res.answer}` : res.answer;
    } catch (err) {
      els.answer.className = 'answer';
      els.answer.textContent = err.message;
    } finally {
      setBusy(els.askSubmit, false);
    }
  }

  /* ---------- geolocation ---------- */
  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      showError('Location is not available on this device. Please type your city.');
      return;
    }
    els.useLocation.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
        els.useLocation.textContent = '✓ Location set';
        els.useLocation.setAttribute('aria-pressed', 'true');
        showError('');
      },
      () => {
        els.useLocation.textContent = 'Use my location';
        showError('Could not get your location. Please type your city instead.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  /* ---------- accessibility + network ---------- */
  function applyTextSize(large) {
    document.documentElement.classList.toggle('large-text', large);
    els.textSize.setAttribute('aria-pressed', String(large));
  }

  function updateNetwork() {
    els.netStatus.textContent = navigator.onLine ? '' : 'Offline: your last plan is still available';
  }

  /* ---------- init ---------- */
  els.form.addEventListener('submit', onSubmit);
  els.askForm.addEventListener('submit', onAsk);
  els.useLocation.addEventListener('click', useMyLocation);
  els.location.addEventListener('input', () => { coords = null; els.useLocation.textContent = 'Use my location'; els.useLocation.removeAttribute('aria-pressed'); });
  $('read-aloud').addEventListener('click', (e) => readAloud(e.currentTarget));
  $('print-plan').addEventListener('click', () => window.print());
  $('share-plan').addEventListener('click', (e) => sharePlan(e.currentTarget));
  els.textSize.addEventListener('click', () => {
    const large = !document.documentElement.classList.contains('large-text');
    applyTextSize(large);
    store.set(TEXT_KEY, large);
  });
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);

  applyTextSize(store.get(TEXT_KEY, false));
  updateNetwork();

  const cached = store.get(STORAGE_KEY, null);
  if (cached && cached.result && cached.result.plan) {
    lastProfile = cached.profile;
    lastResult = cached.result;
    if (cached.profile && cached.profile.location) els.location.value = cached.profile.location;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
