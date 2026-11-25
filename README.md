# Lifeline: AI Disaster-Readiness Assistant

> **Every year, climate disasters (floods, heatwaves, cyclones, wildfires and toxic air) affect hundreds of millions of people.** Most deaths are not caused by the disaster itself but by being unprepared: no water stored, insulin spoiled in the heat, an elderly parent alone at home, no way to evacuate.
>
> **Lifeline** is a smart, dynamic assistant that reads **live weather and air-quality data** for your location, understands **who lives in your home**, and uses **Google Gemini** to turn a deterministic safety engine's decisions into a personal, plain-language, multilingual action plan, in under 10 seconds.

**Live demo:** _add your Cloud Run URL here_

---

## Chosen vertical

**Public safety and climate resilience: a personal emergency-preparedness assistant.**

Persona: a household head in a disaster-prone region (e.g. coastal India) who has elderly parents, children, or a family member with a medical need, and who wants to know *exactly* what to do today, or right now, to keep everyone safe.

## What makes it smart (logical decisions based on user context)

| Context Lifeline reads | Decision it makes |
|---|---|
| Live forecast: peak feels-like temperature ≥ 40°C | Auto-selects **Heatwave**, grades severity (IMD-style thresholds) |
| 3-day rainfall ≥ 75 mm / wind ≥ 62 km/h / US AQI ≥ 201 | Auto-selects **Flood / Cyclone / Air pollution** |
| Hot + windy + dry together | Detects **fire weather** |
| Elderly members + heatwave | Elder check-ins become **critical** (highest heat mortality group) |
| Insulin / oxygen / dialysis / infant | Medical items become **critical** and go to the top of the list |
| Wheelchair user in a 4th-floor-plus apartment | Step-free evacuation is **critical** (lifts fail) |
| No vehicle + a hazard that may need evacuation | Adds **transport planning** |
| Tin-roof / informal housing + flood, cyclone or heat | Finding a community shelter is **critical** |
| Many vulnerable members | Severity raised one level |
| "Emergency now" mode | Severity at least *high*, shows ordered life-safety steps first |
| Household size, pets, heat | Exact **water quantity** (e.g. "51 litres") and mask counts |
| Country of the place | Correct **local emergency number** (112 / 911 / 999 / 000…) |

Every decision is written to a **"Why did Lifeline decide this?"** trail shown to the user, so the AI is explainable, not a black box.

## How it works

```
Browser (accessible PWA)
   │  POST /api/plan  {household profile}
   ▼
Node.js server on Google Cloud Run (zero dependencies)
   ├─ validate.js   strict allow-list validation, text sanitising, GPS rounded to ~1 km
   ├─ weather.js    Open-Meteo geocoding + 3-day forecast + air quality (parallel, cached, timeouts)
   ├─ engine.js     deterministic decision engine → hazard, severity, prioritised checklist,
   │                readiness score, decisions trail   (works with NO AI and NO network)
   ├─ gemini.js     Google Gemini (schema-constrained JSON) personalises and explains the
   │                engine's plan in 13 languages; output is validated and length-capped
   └─ fallback.js   rule-based answers if Gemini is unavailable, so it is never silent
```

**Hybrid AI design (key idea):** Safety-critical content comes from a tested, deterministic engine. Gemini **cannot remove or contradict** it; it personalises, prioritises and explains. This gives the warmth and language coverage of an LLM with the reliability that emergencies demand.

### Features
- 3-step guided form; **Emergency now** skips straight to life-safety steps
- Results dashboard: colour-coded risk card, animated readiness gauge, live-condition tiles, checklist progress bar
- Header **SOS** button that updates to the local emergency number
- Auto hazard detection from live conditions, or manual choice of 7 hazards
- Personalised, prioritised, tickable checklist (progress saved on the device)
- Readiness score (0–100) with exact supply quantities
- Gemini briefing + **Ask Lifeline** follow-up Q&A with urgent-situation detection
- 13 languages (English, Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Malayalam, Gujarati, Spanish, French, Portuguese, Arabic)
- **Read plan aloud** (Web Speech, in the chosen language), print / save as PDF, share
- One-tap **Google Maps** searches for nearby hospitals, shelters, pharmacies, fire stations and cooling centres
- **Works offline** as an installable PWA; the last plan stays available without a network

## Google services used
- **Google Gemini API** (`gemini-2.5-flash`, configurable): structured-output generation for the plan and Q&A
- **Google Cloud Run**: serverless hosting, scale-to-zero, HTTPS
- **Google Cloud Build**: builds the container from source on deploy
- **Google Cloud Logging**: the server writes structured JSON logs (`severity`, `httpRequest`) that Cloud Logging parses natively
- **Google Maps** (URL API): nearby emergency services, no key needed
- **Google Fonts**: Plus Jakarta Sans, allowed through a narrow CSP exception

## Security
- API key kept **server-side only**, sent in the `x-goog-api-key` header (never in URLs or the browser)
- Strict **allow-list validation** of every field; text stripped of markup and control characters; length caps
- **Prompt-injection hardening:** user data is passed as a labelled untrusted DATA block, a system instruction forbids following it, output is schema-constrained and re-validated
- Strict **Content-Security-Policy** (no inline scripts, no third-party scripts), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, COOP/CORP
- All dynamic text rendered with `textContent` (no `innerHTML`), so XSS is not possible
- Per-client **rate limiting** (429 + `Retry-After`), 16 KB body limit, request/header timeouts, upstream timeouts
- Static files served **only from an in-memory allow-list**, so path traversal is impossible
- **Privacy:** no database, nothing stored server-side; GPS rounded to ~1 km; raw coordinates never sent to the AI
- Container runs as a **non-root** user with **zero npm dependencies** (no supply-chain risk)

## Efficiency
- Zero runtime dependencies, ~40 MB image, cold start well under 1 s
- Static assets pre-compressed (gzip) **once at start-up**, served from memory with ETags (304s)
- TTL + LRU cache for geocoding, weather and identical Gemini requests
- Forecast and air-quality requests run **in parallel**; every upstream call has a timeout and graceful fallback

## Accessibility (WCAG 2.2 AA minded)
- Semantic landmarks, skip link, labelled fieldsets/inputs, `aria-live` results, focus moved to results
- Full keyboard use, visible focus rings, 44 px minimum touch targets
- **Larger-text toggle**, automatic **dark mode**, `prefers-reduced-motion` and `forced-colors` support
- Read-aloud in 13 languages for low-literacy and visually impaired users; plain-language (reading age ~12) AI output
- Print stylesheet for a paper copy that works when phones die

## Testing
45 automated tests using Node's built-in test runner (~98% line coverage) covering validation, the decision engine, Gemini client (mocked: key handling, schema, caching, sanitising), weather client, cache, rate limiter, fallback logic and full HTTP integration (security headers, 400/404/405/413/415/429, path traversal, ETag/304, AI-failure fallback).

```bash
npm test
npm run test:coverage
```

## Run locally
Requires Node.js 20+. No `npm install` needed.

```bash
# optional: enables Gemini (works in rules-only mode without it)
export GEMINI_API_KEY=your_key        # PowerShell: $env:GEMINI_API_KEY="your_key"
npm start                             # http://localhost:8080
```

## Deploy to Google Cloud Run
```bash
gcloud run deploy lifeline \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 256Mi \
  --set-env-vars GEMINI_API_KEY=your_key
```

## Assumptions
- Users have intermittent internet; the core plan works without AI and the app shell works offline.
- Weather thresholds follow public guidance (IMD heatwave criteria, US EPA AQI bands, gale-force winds). They are deliberately conservative.
- Earthquakes cannot be forecast, so they are planned at moderate severity.
- Water: 4 L per person per day (5 L in heatwaves) for 3 days, plus 1 L per pet per day.
- Lifeline gives general guidance and **does not replace official instructions or medical advice**. It always points to the local emergency number.

## Project structure
```
server.js            entry point (Cloud Run ready, graceful shutdown)
src/
  app.js             routing, security headers, body parsing, logging
  engine.js          deterministic decision engine
  knowledge.js       curated safety knowledge (data, separate from logic)
  gemini.js          Google Gemini client + prompt/schema + output sanitising
  weather.js         Open-Meteo live data client
  validate.js        input validation
  fallback.js        rule-based answers
  cache.js           TTL + LRU cache
  rateLimit.js       per-client rate limiter
  static.js          in-memory, gzip, ETag static server
  config.js          environment configuration
public/              accessible PWA front-end (HTML, CSS, JS, service worker)
test/                45 automated tests
```

## License
MIT
