'use strict';

/*
 * Lifeline front-end. Plain JavaScript, no framework, no third-party scripts.
 * All server/AI text is rendered with textContent (never innerHTML) so it can
 * never inject markup.
 */
(function lifeline() {
  const STORAGE_KEY = 'lifeline:last';
  const CHECKS_KEY = 'lifeline:checks';
  const REQUEST_TIMEOUT_MS = 30000;
  const TOTAL_STEPS = 3;
  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 50;

  const HAZARD_ICONS = { general: '🧰', flood: '🌊', heatwave: '🌡️', cyclone: '🌀', earthquake: '🏚️', wildfire: '🔥', air_pollution: '😷' };
  const NEXT_LABELS = { 1: 'Next: household →', 2: 'Next: supplies →' };
  const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', mr: 'mr-IN', kn: 'kn-IN', ml: 'ml-IN', gu: 'gu-IN', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', ar: 'ar-SA' };

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('profile-form'),
    submit: $('submit'),
    next: $('next-btn'),
    back: $('back-btn'),
    formError: $('form-error'),
    results: $('results'),
    resultsTitle: $('results-title'),
    banner: $('emergency-banner'),
    statusCard: $('status-card'),
    hazardIcon: $('hazard-icon'),
    hazardLabel: $('hazard-label'),
    placeName: $('place-name'),
    severity: $('severity-badge'),
    gauge: $('gauge'),
    gaugeFill: $('gauge-fill'),
    score: $('readiness-score'),
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
    progressBar: $('progress-bar'),
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
    netStatus: $('net-status'),
    sosLink: $('sos-link'),
    sosNumber: $('sos-number'),
  };

  let lastProfile = null;
  let lastResult = null;
  let coords = null;
  let currentStep = 1;

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
  const fill = (list, items) => list.replaceChildren(...items);

  /* ---------- form data ---------- */
  function readProfile() {
    const data = new FormData(els.form);
    const num = (name) => Number(data.get(name));
    return {
      mode: data.get('mode'),
      hazard: data.get('hazard'),
      location: String(data.get('location') || '').trim(),
      coords,
      household: { adults: num('adults'), children: num('children'), elderly: num('elderly'), pets: num('pets') },
      housing: data.get('housing'),
      hasVehicle: $('hasVehicle').checked,
      needs: data.getAll('needs'),
      supplies: data.getAll('supplies'),
      language: data.get('language'),
    };
  }

  function locationProblem(p) {
    return !p.location && !p.coords ? 'Please enter your city or tap "Use my location" so Lifeline can check live conditions.' : '';
  }

  function householdProblem(p) {
    const counts = p.household;
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

  /* ---------- wizard ---------- */
  function isEmergency() {
    return els.form.querySelector('input[name="mode"]:checked').value === 'emergency';
  }

  function updateNav() {
    const last = currentStep === TOTAL_STEPS;
    els.back.hidden = currentStep === 1;
    els.next.hidden = last;
    els.submit.hidden = !last;
    if (currentStep === 1 && isEmergency()) {
      els.next.textContent = 'Get emergency steps now →';
    } else if (!last) {
      els.next.textContent = NEXT_LABELS[currentStep];
    }
    document.querySelectorAll('[data-step-dot]').forEach((dot) => {
      const n = Number(dot.dataset.stepDot);
      dot.classList.toggle('is-active', n === currentStep);
      dot.classList.toggle('is-done', n < currentStep);
      if (n === currentStep) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
  }

  function showStep(n, focus = true) {
    currentStep = n;
    document.querySelectorAll('[data-step]').forEach((step) => {
      step.hidden = Number(step.dataset.step) !== n;
    });
    updateNav();
    if (focus) {
      const title = els.form.querySelector(`[data-step="${n}"] .step-title`);
      if (title) title.focus();
    }
  }

  function onNext() {
    const profile = readProfile();
    const problem = currentStep === 1 ? locationProblem(profile) : householdProblem(profile);
    showError(problem);
    if (problem) {
      if (currentStep === 1) els.location.focus();
      return;
    }
    if (currentStep === 1 && isEmergency()) {
      els.form.requestSubmit(els.submit);
      return;
    }
    showStep(currentStep + 1);
  }

  function onStepButton(event) {
    const button = event.target.closest('.step-btn');
    if (!button) return;
    const input = $(button.dataset.target);
    const next = Number(input.value || 0) + Number(button.dataset.delta);
    input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), next)));
  }

  /* ---------- network ---------- */
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
    const problem = locationProblem(profile) || householdProblem(profile);
    showError(problem);
    if (problem) {
      showStep(locationProblem(profile) ? 1 : 2);
      return;
    }
    const button = els.submit.hidden ? els.next : els.submit;
    setBusy(button, true, 'Checking live conditions…');
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
      setBusy(button, false);
      els.results.setAttribute('aria-busy', 'false');
    }
  }

  /* ---------- rendering ---------- */
  function metric(icon, label, value) {
    return el('li', { className: 'metric' }, [
      el('span', { className: 'metric-label', text: `${icon} ${label}` }),
      el('span', { className: 'metric-value', text: value }),
    ]);
  }

  function renderConditions(c) {
    const items = [];
    if (c) {
      if (c.temperature !== null) items.push(metric('🌡', 'Now', `${Math.round(c.temperature)}°C`));
      if (c.apparentTemperature !== null) items.push(metric('🥵', 'Feels like', `${Math.round(c.apparentTemperature)}°C`));
      if (c.maxTemp !== null) items.push(metric('☀️', 'Peak (3 days)', `${Math.round(c.maxTemp)}°C`));
      if (c.precip3d !== null) items.push(metric('🌧', 'Rain (3 days)', `${Math.round(c.precip3d)} mm`));
      if (c.maxWind !== null) items.push(metric('💨', 'Max wind', `${Math.round(c.maxWind)} km/h`));
      if (c.aqi !== null) items.push(metric('🫁', 'Air quality (AQI)', String(Math.round(c.aqi))));
    }
    if (!items.length) items.push(el('li', { className: 'metric-empty', text: 'Live data unavailable. The plan is based on your answers.' }));
    fill(els.conditions, items);
  }

  function renderAi(ai, source) {
    els.aiCard.hidden = !ai;
    if (!ai) return;
    els.aiSource.textContent = source === 'gemini' ? 'Google Gemini' : '';
    els.aiSource.hidden = source !== 'gemini';
    els.aiSummary.textContent = ai.summary;
    fill(els.aiActions, ai.topActions.map((a) => el('li', null, [el('strong', { text: a.title }), document.createTextNode(` ${a.detail}`)])));
    fill(els.aiNotes, (ai.householdNotes || []).map((n) => el('li', { text: n })));
    els.aiReassurance.textContent = ai.reassurance || '';
    els.aiReassurance.hidden = !ai.reassurance;
  }

  function updateProgress() {
    const boxes = els.checklist.querySelectorAll('input[type="checkbox"]');
    const done = [...boxes].filter((b) => b.checked).length;
    els.progress.textContent = `${done} of ${boxes.length} done`;
    els.progressBar.style.width = boxes.length ? `${Math.round((done / boxes.length) * 100)}%` : '0%';
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
        el('span', { className: 'why-text', text: item.why }),
      ]);
      return el('li', null, [el('label', { for: `chk-${item.id}` }, [box, text])]);
    }));
    updateProgress();
  }

  function renderMapLinks(place, plan) {
    const near = place ? place.name : 'me';
    const queries = [
      ['🏥', 'Hospitals', `hospital near ${near}`],
      ['⛺', 'Relief shelters', `relief shelter near ${near}`],
      ['💊', 'Pharmacies', `pharmacy open now near ${near}`],
      ['🚒', 'Fire stations', `fire station near ${near}`],
    ];
    if (plan.hazard === 'heatwave') queries.push(['❄️', 'Cooling centres', `cooling centre near ${near}`]);
    fill(els.mapLinks, queries.map(([icon, label, q]) => el('a', {
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': `${label} on Google Maps (opens in a new tab)`,
    }, [el('span', { 'aria-hidden': 'true', text: icon }), document.createTextNode(`${label} ↗`)])));
  }

  function renderGauge(readiness) {
    const score = Math.max(0, Math.min(100, readiness.score));
    els.score.textContent = String(score);
    els.gauge.setAttribute('aria-label', `Readiness score ${score} out of 100: ${readiness.label}`);
    // Animate from empty on the next frame so the transition is visible.
    els.gaugeFill.setAttribute('stroke-dashoffset', String(GAUGE_CIRCUMFERENCE));
    requestAnimationFrame(() => {
      els.gaugeFill.setAttribute('stroke-dashoffset', String(GAUGE_CIRCUMFERENCE * (1 - score / 100)));
    });
  }

  function setSos(number) {
    els.sosNumber.textContent = number;
    els.sosLink.href = `tel:${number}`;
    els.sosLink.setAttribute('aria-label', `Call emergency number ${number}`);
  }

  function render(result) {
    const { plan, place, conditions, ai, source } = result;
    els.results.hidden = false;
    els.askSection.hidden = false;
    setSos(plan.emergency.number);

    const urgent = plan.mode === 'emergency' || plan.severity === 'critical';
    els.banner.hidden = !urgent;
    if (urgent) {
      els.banner.replaceChildren(
        el('span', { text: 'If anyone is in danger, call now' }),
        el('a', { href: `tel:${plan.emergency.number}`, text: `📞 ${plan.emergency.number}` }),
      );
    }

    els.statusCard.className = `status-card sev-${plan.severity}`;
    els.hazardIcon.textContent = HAZARD_ICONS[plan.hazard] || '🧰';
    els.hazardLabel.textContent = plan.hazardLabel;
    els.placeName.textContent = place ? `· ${place.name}` : '';
    els.severity.textContent = `${plan.severity} severity`;
    els.severity.className = 'badge';
    renderGauge(plan.readiness);
    els.readinessLabel.textContent = `${plan.readiness.label} · Store ${plan.supplies.waterLitres} litres of water for your household`;

    renderConditions(conditions);
    renderAi(ai, source);

    els.immediateCard.hidden = plan.immediateActions.length === 0;
    fill(els.immediateList, plan.immediateActions.map((a) => el('li', { text: a })));

    renderChecklist(plan.checklist);
    fill(els.decisions, plan.decisions.map((d) => el('li', { text: d })));
    els.review.textContent = plan.reviewAdvice;
    renderMapLinks(place, plan);

    els.results.scrollIntoView({ block: 'start' });
    els.resultsTitle.focus({ preventScroll: true });
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

  function readAloud(button) {
    if (!('speechSynthesis' in window)) {
      button.textContent = 'Read aloud not supported';
      return;
    }
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      button.textContent = '🔊 Read plan aloud';
      return;
    }
    const utterance = new SpeechSynthesisUtterance(planText());
    utterance.lang = SPEECH_LANG[(lastProfile && lastProfile.language) || 'en'] || 'en-IN';
    utterance.rate = 0.95;
    utterance.onend = () => { button.textContent = '🔊 Read plan aloud'; };
    speechSynthesis.speak(utterance);
    button.textContent = '⏹ Stop reading';
  }

  async function sharePlan(button) {
    const text = planText();
    try {
      if (navigator.share) await navigator.share({ title: 'My Lifeline plan', text });
      else await navigator.clipboard.writeText(text);
      button.textContent = navigator.share ? '✓ Shared' : '✓ Copied!';
    } catch {
      button.textContent = 'Could not copy';
    }
    setTimeout(() => { button.textContent = '🔗 Copy plan to share'; }, 2500);
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
        els.useLocation.textContent = '◎ Use my location';
        showError('Could not get your location. Please type your city instead.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  /* ---------- network ---------- */
  function updateNetwork() {
    els.netStatus.textContent = navigator.onLine ? '' : 'Offline: last plan available';
  }

  /* ---------- init ---------- */
  els.form.addEventListener('submit', onSubmit);
  els.form.addEventListener('click', onStepButton);
  els.form.addEventListener('change', (e) => { if (e.target.name === 'mode') updateNav(); });
  els.next.addEventListener('click', onNext);
  els.back.addEventListener('click', () => { showError(''); showStep(currentStep - 1); });
  els.location.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onNext(); } });
  els.location.addEventListener('input', () => {
    coords = null;
    els.useLocation.textContent = '◎ Use my location';
    els.useLocation.removeAttribute('aria-pressed');
  });
  els.useLocation.addEventListener('click', useMyLocation);
  els.askForm.addEventListener('submit', onAsk);
  $('suggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('.suggestion');
    if (!chip) return;
    els.question.value = chip.textContent;
    els.askForm.requestSubmit();
  });
  $('edit-plan').addEventListener('click', () => {
    showStep(1, false);
    els.form.scrollIntoView({ block: 'start' });
    els.form.querySelector('[data-step="1"] .step-title').focus({ preventScroll: true });
  });
  $('read-aloud').addEventListener('click', (e) => readAloud(e.currentTarget));
  $('print-plan').addEventListener('click', () => window.print());
  $('share-plan').addEventListener('click', (e) => sharePlan(e.currentTarget));
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);

  updateNetwork();
  showStep(1, false);

  const cached = store.get(STORAGE_KEY, null);
  if (cached && cached.result && cached.result.plan) {
    lastProfile = cached.profile;
    lastResult = cached.result;
    if (cached.profile && cached.profile.location) els.location.value = cached.profile.location;
    setSos(cached.result.plan.emergency.number);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
