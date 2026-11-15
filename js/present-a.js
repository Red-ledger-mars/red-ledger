// Cold Open: the presentation of one walk at Gale crater, shown as a film.
// The ground plays in a cinema frame at the top; every sentence sits under
// it like a subtitle; the only warm colour is the walker's body heat.
//
// Scrolling is the clock, as on the story page (js/story.js): the scroll
// position moves the walker. Every science sentence below is copied from
// js/story.js, and every number is read from data/routes.json and the body
// model (js/body.js). This file adds no science of its own.
import { loadTerrain } from './terrain.js';
import { MODEL, SOURCES } from './body.js';
import { pointAt } from './route.js';
import { createView3D, CREDIT_TEXT } from './view3d.js';
import { heatColor, heatShare } from './heat.js';
import { smoothScroll } from './smooth-scroll.js';
import { loadComms } from './comms.js';
import { loadReach, REACH_LEGEND } from './reach.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NARROW = matchMedia('(max-width: 760px)');
const fmt = (value, digits = 0) => value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const minutes = (s) => Math.round(s / 60);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const body = document.body;
const root = document.documentElement;

// The same two routes as the planner page, with its names.
const ROUTES = [
  { id: 'direct', pricing: 'direct', name: 'Direct', hint: 'shortest over the ground', colour: '#ffffff' },
  { id: 'body', pricing: 'body', name: 'Body-cost', hint: 'least walking energy', colour: '#8c8c8c' },
];

// Seconds of autoplay, as on the story page.
const PLAY = { title: 6, routes: 11, walk: 62, verdict: 8, reach: 11, test: 14 };

// Approved wording, copied from js/story.js.
const VERDICT = 'By the model\'s central estimate, both routes go over the heat limit unless the walker rests.';
const REACH_TEXT = {
  0: 'With no load a walker can go 630 to 1,140 m from the habitat, depending on the ground, and come back with no rest.',
  15: 'Carrying 15 kg, a walker can go 550 to 870 m from the habitat, depending on the ground, and come back with no rest.',
  30: 'Carrying 30 kg, a walker can go 490 to 700 m from the habitat, depending on the ground, and come back with no rest.',
};
const TEST_TEXT = 'The test and its pass mark were fixed in the repository before any measurement was collected. NASA has measured how hard people work when they walk on a treadmill at Moon and Mars gravity: we used 40 of those measurements, 19 of them in a spacesuit. On level ground people in the suit used 36% more energy than the model predicted. On climbs the model predicted up to 2.2 times too much. We corrected it by the rule we had set. The revised model is within 14% of all 12 sloped measurements, a fix made after seeing them.';
const KEY = '<b class="hollow keymark">00</b> Hollow numbers rest on an assumption';

// Wherever heat is shown to two decimals against the limit, the range
// measured on people stays in the same view.
const heatRange = (t) => `Range from NASA's measurements of people: ${t.peakHeatRange.map((v) => fmt(v, 1)).join(' to ')} kJ/kg`;
const LIMIT = () => fmt(MODEL.heatLimitKJkg, 1);

const state = {
  routes: {},
  active: 'direct',
  view: null,
  plans: {},
  loadKg: 0,
  chapters: [],     // measured chapters, top to bottom
  ranges: [],       // scroll range in which each chapter is the current one
  chapter: null,    // key of the current chapter
  kind: null,
  shown: null,      // id of the lower-third block on screen
  dist: -1,
  steepLeg: -1,
  comms: null,
  startMinute: null,
  reach: null,
  resting: false,
  glow: { q: -1, i: 0 },
  walkH: 200,
};

// A number as the page shows it. Assumed numbers are hollow; `colour`
// tints the number with body heat.
function num(value, digits, { assumed = false, colour = null, cls = '' } = {}) {
  const style = colour ? ` style="--stroke: ${colour};${assumed ? '' : ` color: ${colour};`}"` : '';
  return `<span class="${assumed ? 'hollow' : ''} ${cls}"${style}>${fmt(value, digits)}</span>`;
}

/* Loading */

function progress(share, label) {
  $('shutters').style.setProperty('--p', share);
  $('loader-step').textContent = label;
  $('loader-pct').textContent = Math.round(share * 100);
}

async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  $('limit-a').textContent = LIMIT();
  $('heat-tick').style.left = `${(MODEL.heatLimitKJkg / MODEL.heatContingencyKJkg) * 100}%`;
  progress(0.04, 'Terrain');
  let done = 0;
  const tick = (label) => (value) => { done += 1; progress(0.04 + done * 0.24, label); return value; };
  const [terrain, walk, planned] = await Promise.all([
    loadTerrain().then(tick('Elevation')),
    fetch('data/walk.json').then((r) => r.json()).then(tick('Stops')),
    fetch('data/routes.json').then((r) => r.json()).then(tick('Routes')),
  ]);
  state.plans = planned.loads;
  for (const def of ROUTES) state.routes[def.id] = planned.loads[0][def.pricing];
  state.walk = walk;

  progress(0.8, 'HiRISE imagery and 3D ground');
  $('credit').textContent = CREDIT_TEXT;
  state.view = await createView3D($('stage'), {
    terrain,
    routes: state.routes,
    colors: Object.fromEntries(ROUTES.map((d) => [d.id, d.colour])),
    pointColors: (id, route) => route.points.map((p) => heatColor(p.heat)),
  });
  if (state.view.available) {
    state.view.show();
    state.view.resize();
    state.view.setRoute(state.active);
    state.view.setMarks?.({ pins: false, ring: false });
    state.view.setViewShift?.(0);
    mirrorCredit();
    state.view.setWalkerFigure?.('img/walker.png');
    state.view.setWalkerDrag?.((dist) => {
      if (auto.on) setAuto(false);
      cancelGlide();
      scrollTo({ top: scrollForDist(dist), behavior: 'instant' });
    });
  } else {
    showFlat();
  }
  $('stage').addEventListener('v3d-status', (e) => {
    if (!e.detail?.ok) showFlat();
    else { body.classList.remove('flat'); mirrorCredit(); }
  });

  build();
  progress(1, 'Ready');
  measure();
  update();
  bindTransport();
  await wait(350);
  setShutterTiming(REDUCED ? 200 : 1100, 'out');
  body.classList.remove('loading');
  $('start').disabled = false;

  addEventListener('resize', () => { state.view.resize(); measure(); layoutHaze(); update(); });
  addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  smoothScroll();
  bindAuto();
  if (!REDUCED) setTimeout(() => { if (!glide.raf && scrollY < 2) setAuto(true); }, 1100);
  // Orbiter passes only matter for the start time on the face-off.
  loadComms().then((comms) => { state.comms = comms; pickStart(); refreshEnd(); }).catch(() => {});
  loadReach().then((reach) => { state.reach = reach; if (state.kind === 'reach') showReach(); }).catch(() => {});
}

// The imagery credit is the view's own; it gains the AI line when the
// walker figure loads. The page shows it in the fine print.
function mirrorCredit() {
  const el = $('stage').querySelector('.v3d-credit');
  if (!el) return;
  const copy = () => { if (!body.classList.contains('flat')) $('credit').textContent = el.textContent; };
  copy();
  if (!state.creditWatch) {
    state.creditWatch = new MutationObserver(copy);
    state.creditWatch.observe(el, { childList: true, characterData: true, subtree: true });
  }
}

/* Building the chapters */

function routeButton(def) {
  const t = state.routes[def.id].totals;
  return `
    <button class="route" type="button" data-route="${def.id}" aria-pressed="${def.id === state.active}">
      <span class="s">${def.name} · ${def.hint}</span>
      ${num(t.peakHeatNoRest, 2, { assumed: true, colour: heatColor(t.peakHeatNoRest), cls: 'd' })}
      <span class="s"><span class="unit">kJ/kg</span> peak heat with no rest</span>
      <span class="s">${heatRange(t)}</span>
    </button>`;
}

function loadButtons() {
  const loads = Object.keys(state.plans).map(Number).sort((a, b) => a - b);
  return `<span class="segs">${loads.map((kg) => `<button type="button" data-load="${kg}" aria-pressed="${kg === state.loadKg}">${kg} kg</button>`).join('')}</span>`;
}

const loadGroup = () => `<div class="grp"><span class="s">Carried load</span>${loadButtons()}</div>`;

function build() {
  const route = state.routes[state.active];
  const stops = route.stops;
  const total = route.totals.dist;
  const legs = stops.length - 1;

  // Any other outcome of the data shows no verdict line, so the page never
  // says something nobody has checked.
  const bothOver = ROUTES.every((d) => state.routes[d.id].totals.peakHeatNoRest > MODEL.heatLimitKJkg);
  const restsKeepUnder = ROUTES.every((d) => state.routes[d.id].totals.peakHeat < MODEL.heatLimitKJkg);
  if (!bothOver) console.warn('Cold Open: the routes no longer both pass the heat limit; the verdict line is hidden.');

  // Scroll length of each chapter.
  const ch = [
    { kind: 'title', name: 'Title', vh: 100, play: PLAY.title },
    { kind: 'routes', name: 'Routes', vh: 100, play: PLAY.routes },
  ];
  for (let i = 0; i < legs; i++) {
    const len = stops[i + 1].dist - stops[i].dist;
    ch.push({ kind: 'leg', leg: i, name: stops[i + 1].place.name, vh: Math.max(180, Math.round(1000 * len / total)), play: PLAY.walk * len / total });
  }
  ch.push(
    { kind: 'verdict', name: 'Verdict', vh: 100, play: PLAY.verdict },
    { kind: 'reach', name: 'Reach', vh: 100, play: PLAY.reach },
    { kind: 'test', name: 'Test', vh: 100, play: PLAY.test },
  );
  $('chapters').innerHTML = ch.map((c) => `<section class="chapter" data-kind="${c.kind}" data-name="${esc(c.name)}"${c.leg != null ? ` data-leg="${c.leg}"` : ''} data-play="${c.play.toFixed(2)}" style="height: ${c.vh}vh" aria-hidden="true"></section>`).join('')
    + `<section class="chapter end" id="end" data-kind="end" data-name="Face-off" aria-label="Face-off"><div class="fo" id="fo">${faceoffShell()}</div></section>`;

  // Title: the static block stays; only the data-gated verdict is filled.
  $('verdict-title').innerHTML = bothOver ? `<i class="sq" aria-hidden="true"></i>${VERDICT}` : '';

  const blocks = [];
  blocks.push(`
    <div class="blk" id="blk-routes">
      <div class="words">
        <h2 class="t t7">Same stops. Different heat.</h2>
        <p class="t">Each big number is the most body heat the walker would store with no rest. <a href="${esc(SOURCES.heatLimit.url)}" target="_blank" rel="noopener">NASA's limit</a> for suited work is <b>${LIMIT()} <span class="unit">kJ/kg</span></b>.</p>
      </div>
      <div class="nums">
        <div class="routes">${ROUTES.map(routeButton).join('')}</div>
        <p class="s key key-inline">${KEY}</p>
      </div>
    </div>`);

  for (let i = 0; i < legs; i++) {
    const len = stops[i + 1].dist - stops[i].dist;
    const place = stops[i + 1].place;
    blocks.push(`
      <div class="blk" id="blk-leg-${i}">
        <div class="words">
          <h2 class="t t7">${esc(place.name)}</h2>
          <p class="s meta">Leg ${i + 1} of ${legs} · ${fmt(len)} m<span class="steep-note" hidden> · steepest ground</span>${place.assumption ? ' · Assumed place' : ''}</p>
          <p class="t">${esc(place.text)}</p>
          ${place.source ? `<p class="s"><a href="${esc(place.source)}" target="_blank" rel="noopener">Source: ${esc(new URL(place.source).hostname)}</a>${place.sol ? ` · sol ${place.sol}` : ''}</p>` : ''}
        </div>
      </div>`);
  }

  const ramp = Array.from({ length: 13 }, (_, i) => `${heatColor((i / 12) * MODEL.heatLimitKJkg)} ${((i / 12) * 100).toFixed(1)}%`).join(', ');
  blocks.push(`
    <div class="blk" id="blk-verdict">
      <div class="words">
        ${bothOver ? `<h2 class="t t7">${VERDICT}</h2>` : ''}
        ${restsKeepUnder ? `<p class="t">With the planned rests, both stay under ${LIMIT()} <span class="unit">kJ/kg</span>.</p>` : ''}
      </div>
      <div class="nums">
        <div class="ramp-key">
          <p class="s">Line colour: body heat</p>
          <i class="ramp" style="background: linear-gradient(to right, ${ramp})"></i>
          <p class="s ramp-ends"><span>0</span><span>NASA limit ${LIMIT()} <span class="unit">kJ/kg</span></span></p>
        </div>
      </div>
    </div>`);

  const chips = ['none', '1', '2', '3+'].map((label, i) => `<li class="s"><i style="background: linear-gradient(${REACH_LEGEND[i].color}, ${REACH_LEGEND[i].color}), var(--ground)"></i>${label}</li>`).join('');
  blocks.push(`
    <div class="blk" id="blk-reach">
      <div class="words">
        <h2 class="t t7">How far can a body go without a rest?</h2>
        <p class="t">This map is coloured by the rests a body needs to walk from the habitat to each point and back.</p>
        <p class="t">Clear ground needs no rest. Each band of colour is one more rest the plan adds.</p>
      </div>
      <div class="nums">
        <p class="t">${REACH_TEXT[state.loadKg] ?? REACH_TEXT[0]}</p>
        ${loadGroup()}
        <div class="grp"><span class="s">Rests needed</span><ul class="chips">${chips}</ul></div>
        <p class="s">To walk from the habitat to a point and back, body-cost route, load shown.</p>
      </div>
    </div>`);

  blocks.push(`
    <div class="blk test" id="blk-test">
      <div class="words">
        <h2><span class="t t7">We tested the model against NASA's measurements of people.</span><span class="d">It failed.</span></h2>
        <p><a class="btn" href="classic.html#proof">How we tested it</a></p>
      </div>
      <div class="nums"><p class="t">${TEST_TEXT}</p></div>
    </div>`);

  $('blocks').innerHTML = blocks.join('');
  state.shown = state.shown === 'blk-title' ? 'blk-title' : null;
  bindChapterControls();
  findSteepLeg();
  buildScrubber();
}

function bindChapterControls() {
  for (const btn of document.querySelectorAll('.route')) btn.addEventListener('click', () => setActive(btn.dataset.route));
  bindPlanner();
  $('replay').addEventListener('click', () => {
    cut(0, () => { if (!REDUCED) setAuto(true); });
  });
}

/* The face-off */

const FACEOFF = [
  { label: 'Planned rests', unit: (v) => (v === 1 ? 'rest' : 'rests'), value: (t) => t.restCount, digits: 0, note: (t) => `${minutes(t.restSeconds)} min resting` },
  { label: 'Time with rests', unit: 'min', value: (t) => t.seconds / 60, digits: 0 },
  { label: 'Energy', unit: 'kcal', value: (t) => t.kcal, digits: 0, assumed: true },
  { label: 'Radiation', unit: 'µSv', value: (t) => t.dose, digits: 1, assumed: true, cls: 'fo-rad' },
];

const contactShare = (contact) => contact.inContact.filter(Boolean).length / contact.inContact.length;
const CONTACT_ROW = {
  label: 'Orbiter in view',
  unit: '% of the walk',
  digits: 0,
  value: (t, id) => contactShare(state.comms.routeContact(state.routes[id].points, state.startMinute)) * 100,
  note: (t, id) => {
    const gap = state.comms.routeContact(state.routes[id].points, state.startMinute).longestGapMin;
    return gap > 0 ? `Up to ${Math.round(gap)} min with no contact` : 'Orbiter in view for the whole walk';
  },
};

function faceoffShell() {
  return `
    <div class="fo-live" id="fo-live">${faceoffLive()}</div>
    <div class="fo-actions">
      <button class="btn" type="button" id="replay">Replay</button>
      <a class="btn primary" href="classic.html">Open the map tool</a>
      <a class="btn" href="classic.html#proof">How we tested it</a>
      <a class="btn" href="CREDITS.md">Sources and credits</a>
      <p class="s fo-fine"><span>Made with NASA open data</span><span>A planning forecast, not a diagnosis.</span></p>
    </div>
    <p class="s key key-inline">${KEY}</p>`;
}

function faceoffLive() {
  const start = state.comms && state.startMinute != null ? `
    <label class="grp"><span class="s">Start, on the day modelled</span>
      <select id="plan-start">${startOptions()}</select>
    </label>` : '';
  const totals = ROUTES.map((d) => state.routes[d.id].totals);
  const side = (i) => (i === 0 ? 'l' : 'r');

  const peak = totals.map((t) => t.peakHeatNoRest);
  const peakMost = Math.max(...peak) || 1;
  const peakCells = peak.map((v, i) => {
    const colour = heatColor(v);
    return `<div class="fo-v ${side(i)}">${num(v, 2, { assumed: true, colour, cls: 'd' })}<span class="s">${heatRange(totals[i])}</span><i class="bar" style="width: ${((v / peakMost) * 100).toFixed(1)}%; background: ${colour}"></i></div>`;
  });
  const peakRow = `<div class="fo-row">${peakCells[0]}<div class="fo-label"><span class="t t7">Peak heat, no rests</span><br><span class="s unit">kJ/kg</span></div>${peakCells[1]}</div>`;

  const rows = [...FACEOFF, ...(state.comms && state.startMinute != null ? [CONTACT_ROW] : [])].map((row) => {
    const values = totals.map((t, i) => row.value(t, ROUTES[i].id));
    const most = Math.max(...values) || 1;
    const cells = values.map((v, i) => {
      const unit = typeof row.unit === 'function' ? row.unit(v) : row.unit;
      const note = row.note ? `<span class="s">${row.note(totals[i], ROUTES[i].id)}</span>` : '';
      return `<div class="fo-v ${side(i)}"><span class="val"><span class="t t7">${num(v, row.digits, { assumed: row.assumed })}</span><span class="s unit">${unit}</span></span>${note}<i class="bar" style="width: ${((v / most) * 100).toFixed(1)}%"></i></div>`;
    });
    return `<div class="fo-row ${row.cls ?? ''}">${cells[0]}<div class="fo-label t t7">${row.label}</div>${cells[1]}</div>`;
  });

  return `
    <div class="fo-top"><h2 class="t t7">Face-off</h2>${loadGroup()}${start}</div>
    <div class="fo-tape">
      <div class="fo-row fo-head s"><span class="fo-v l">${ROUTES[0].name} · ${ROUTES[0].hint}</span><span></span><span class="fo-v r">${ROUTES[1].name} · ${ROUTES[1].hint}</span></div>
      ${peakRow}
      ${rows.join('')}
    </div>`;
}

// Start times every 20 minutes of daylight on the sol the orbiter positions
// are for; the first pick keeps the body-cost route in contact longest.
const START_MINUTES = Array.from({ length: 37 }, (_, i) => 640 + i * 20);
const bodyShare = (minute) => contactShare(state.comms.routeContact(state.routes.body.points, minute));

function pickStart() {
  let best = { minute: START_MINUTES[0], share: -1 };
  for (const minute of START_MINUTES) {
    const share = bodyShare(minute);
    if (share > best.share) best = { minute, share };
  }
  state.startMinute = best.minute;
}

function startOptions() {
  return START_MINUTES.map((minute) => `<option value="${minute}"${minute === state.startMinute ? ' selected' : ''}>${state.comms.localTime(minute)} · ${Math.round(bodyShare(minute) * 100)}% in contact</option>`).join('');
}

function bindPlanner() {
  for (const btn of document.querySelectorAll('[data-load]')) {
    if (btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => setLoad(Number(btn.dataset.load)));
  }
  $('plan-start')?.addEventListener('change', (e) => { state.startMinute = Number(e.target.value); refreshEnd(); });
}

function refreshEnd() {
  const live = $('fo-live');
  if (!live) return;
  live.innerHTML = faceoffLive();
  bindPlanner();
  if (NARROW.matches) measure();
}

// A new load or route changes every number: the page is rebuilt and stays
// in the chapter the visitor changed it from.
function rebuildKeeping(change) {
  const here = state.chapters.find((c) => c.key === state.chapter) ?? state.chapters.at(-1);
  const kind = here.kind;
  const offset = scrollY - here.top;
  change();
  build();
  measure();
  state.chapter = null;
  state.dist = -1;
  const there = state.chapters.find((c) => c.kind === kind) ?? state.chapters.at(-1);
  scrollTo({ top: there.top + offset, behavior: 'instant' });
  update();
}

function setLoad(kg) {
  if (kg === state.loadKg || !state.plans[kg]) return;
  rebuildKeeping(() => {
    state.loadKg = kg;
    for (const def of ROUTES) state.routes[def.id] = state.plans[kg][def.pricing];
    state.view.setRoutes?.(state.routes);
    state.view.setRoute(state.active);
  });
}

function setActive(id) {
  if (id === state.active) return;
  rebuildKeeping(() => {
    state.active = id;
    state.view.setRoute(id);
  });
}

// The leg that holds the steepest ground is marked.
function findSteepLeg() {
  const route = state.routes[state.active];
  const steep = route.points.reduce((a, p) => (Math.abs(p.gradient) > Math.abs(a.gradient) ? p : a));
  state.steepLeg = route.stops.findIndex((s, i) => i < route.stops.length - 1 && steep.dist <= route.stops[i + 1].dist);
  document.querySelectorAll('[id^="blk-leg-"]').forEach((el) => {
    el.querySelector('.steep-note').hidden = Number(el.id.slice(8)) !== state.steepLeg;
  });
}

/* Reach and the flat ground */

const reachImages = {};
function showFlat() {
  body.classList.add('flat');
  $('credit').textContent = CREDIT_TEXT;
  if (state.kind === 'reach') showReach();
}

function showReach() {
  if (!state.reach) return;
  reachImages[state.loadKg] ??= state.reach.image(state.loadKg);
  state.view.setOverlay?.(reachImages[state.loadKg], state.reach.bounds);
  const flat = $('flat-reach');
  flat.src = reachImages[state.loadKg];
  flat.hidden = false;
}

function hideReach() {
  state.view.setOverlay?.(null);
  state.view.setRoutesVisible?.(true);
  $('flat-reach').hidden = true;
}

/* Scroll: the clock */

function measure() {
  state.chapters = [...document.querySelectorAll('.chapter')].map((el) => ({
    el,
    kind: el.dataset.kind,
    leg: el.dataset.leg != null ? Number(el.dataset.leg) : null,
    key: el.dataset.kind + (el.dataset.leg ?? ''),
    name: el.dataset.name,
    play: Number(el.dataset.play) || 0,
    top: el.offsetTop,
    h: el.offsetHeight,
  }));
  const H = innerHeight;
  const max = Math.max(0, root.scrollHeight - H);
  const starts = state.chapters.map((c, i) => {
    if (i === 0) return 0;
    if (c.kind === 'end') return Math.max(0, c.top - H * 0.85);
    return Math.max(0, c.top - H * 0.5);
  });
  state.ranges = state.chapters.map((c, i) => {
    const s0 = Math.min(starts[i], max);
    const s1 = i < starts.length - 1 ? Math.min(starts[i + 1], max) : max;
    return { s0, s1: Math.max(s1, s0 + 1) };
  });
  // The heat line sits above the tallest walk block, so it never moves
  // between legs.
  const legEls = [...document.querySelectorAll('[id^="blk-leg-"]')];
  const live = $('live');
  if (NARROW.matches) {
    root.style.setProperty('--live-h', `${live.offsetHeight + 14}px`);
  } else {
    state.walkH = Math.max(live.offsetHeight, ...legEls.map((el) => el.offsetHeight));
    root.style.setProperty('--walk-h', `${state.walkH}px`);
  }
  sizeScrubber();
}

const chapterAt = (y) => state.chapters.findLast((c) => c.top <= y) ?? state.chapters[0];

// The scroll position that puts the walker at `dist`: update() run backwards.
function scrollForDist(dist) {
  const route = state.routes[state.active];
  const legs = state.chapters.filter((c) => c.kind === 'leg');
  const c = legs.find((ch) => dist <= route.stops[ch.leg + 1].dist) ?? legs.at(-1);
  const a = route.stops[c.leg].dist;
  const b = route.stops[c.leg + 1].dist;
  return c.top + 1 + clamp01((dist - a) / (b - a)) * (c.h - 2) - innerHeight * 0.5;
}

function update() {
  if (!state.chapters.length) return;
  const route = state.routes[state.active];
  const y = scrollY + innerHeight * 0.5;
  const end = state.chapters.at(-1);
  const c = end.kind === 'end' && end.top < scrollY + innerHeight * 0.85 ? end : chapterAt(y);
  let dist = 0;
  if (c.kind === 'leg') {
    const a = route.stops[c.leg].dist;
    const b = route.stops[c.leg + 1].dist;
    dist = a + clamp01((y - c.top) / c.h) * (b - a);
  } else if (c.kind === 'verdict' || c.kind === 'reach' || c.kind === 'test' || c.kind === 'end') {
    dist = route.totals.dist;
  }
  setChapter(c);
  setDist(dist);
  paintScrub();
}

const blockFor = (c) => (c.kind === 'leg' ? `blk-leg-${c.leg}` : c.kind === 'end' ? 'fo' : `blk-${c.kind}`);

function showBlock(id, slow = false) {
  if (state.shown === id) return;
  const old = state.shown && $(state.shown);
  if (old) {
    old.classList.remove('on', 'slow');
    old.classList.add('out');
    setTimeout(() => old.classList.remove('out'), 200);
  }
  state.shown = id;
  const el = id && $(id);
  if (el) { el.classList.toggle('slow', slow); el.classList.add('on'); }
}

function setChapter(c) {
  if (state.chapter === c.key) return;
  const was = state.kind;
  state.chapter = c.key;
  state.kind = c.kind;
  const walking = c.kind === 'leg';
  body.classList.toggle('walking', walking);
  body.classList.toggle('curtain', c.kind === 'test' || c.kind === 'end');
  body.dataset.kind = c.kind;
  if (!walking) setResting(false);

  const move = state.view.setMode(walking ? 'chase' : 'orbit');
  if (c.kind === 'reach') {
    state.view.setRoutesVisible?.(false);
    showReach();
  } else if (was === 'reach') {
    hideReach();
  }

  // The verdict waits for the camera to finish pulling back.
  if (c.kind === 'verdict' && move?.then) {
    showBlock(null);
    const key = c.key;
    move.then(() => { if (state.chapter === key) showBlock('blk-verdict', !REDUCED); });
  } else {
    showBlock(blockFor(c));
  }
  layoutHaze();
}

// The haze is solid up to the top of the words, then fades to clear.
function layoutHaze() {
  if (NARROW.matches || !state.kind) return;
  let h;
  if (state.kind === 'leg') h = state.walkH + 16 + 34;
  else if (state.kind === 'test' || state.kind === 'end') return;
  else h = $(blockFor({ kind: state.kind }))?.offsetHeight ?? 0;
  const band = parseFloat(getComputedStyle(root).getPropertyValue('--band')) || 112;
  const solid = Math.max(0, 80 + h - band);
  root.style.setProperty('--haze', `${Math.round(solid + 160)}px`);
}

function setDist(dist) {
  if (Math.abs(dist - state.dist) < 0.5) return;
  state.dist = dist;
  const route = state.routes[state.active];
  state.view.setWalker(dist, { ease: true });
  if (state.kind === 'leg' && dist > 0) renderLive(pointAt(route, dist), route);
}

function setResting(on) {
  if (state.resting === on) return;
  state.resting = on;
  state.view.setWalkerResting?.(on);
}

// The live number, the heat line and the glow, all from the same heat.
function renderLive(p, route) {
  const colour = heatColor(p.heat);
  const value = $('live-heat');
  value.textContent = fmt(p.heat, 1);
  value.style.setProperty('--stroke', colour);
  const fill = $('heat-fill');
  fill.style.width = `${clamp01(p.heat / MODEL.heatContingencyKJkg) * 100}%`;
  fill.style.background = colour;
  const rest = route.restStops.find((r) => p.dist >= r.dist && p.dist < r.dist + 30);
  const restEl = $('live-rest');
  const text = rest ? `Planned rest · ${minutes(rest.seconds)} min` : '';
  if (restEl.textContent !== text) restEl.textContent = text;
  restEl.style.color = colour;
  setResting(!!rest);
  setGlow(p.heat);
}

// Two glow layers cross-fade, one step of 0.25 kJ/kg at a time.
function setGlow(heat) {
  const q = Math.round(heat / 0.25) * 0.25;
  if (q === state.glow.q) return;
  state.glow.q = q;
  const layers = $('glow').children;
  const next = layers[state.glow.i ^ 1];
  const cur = layers[state.glow.i];
  next.style.color = heatColor(q);
  next.style.opacity = String(0.12 + 0.5 * Math.min(1, heatShare(q)));
  cur.style.opacity = '0';
  state.glow.i ^= 1;
}

/* The scrubber */

function buildScrubber() {
  const names = [...document.querySelectorAll('.chapter')].map((el) => ({ kind: el.dataset.kind, name: el.dataset.name, leg: el.dataset.leg }));
  $('track').innerHTML = names.map((c, i) => `<button type="button" class="seg${c.kind === 'leg' ? ' leg' : ''}" data-i="${i}"${c.leg != null ? ` data-leg="${c.leg}"` : ''} aria-label="${esc(c.name)}" title="${esc(c.name)}">${c.kind === 'leg' ? '<canvas width="1" height="1"></canvas>' : ''}<i class="dim"></i></button>`).join('');
  state.segs = [...$('track').children];
}

function sizeScrubber() {
  if (!state.segs) return;
  state.segs.forEach((el, i) => { const r = state.ranges[i]; if (r) el.style.flexGrow = String(Math.max(1, r.s1 - r.s0)); });
  drawRibbons();
}

// The four legs are a heat ribbon: each pixel is the body heat at that point
// of the route, with a notch at every planned rest.
function drawRibbons() {
  const route = state.routes[state.active];
  const ink = getComputedStyle(root).getPropertyValue('--ink').trim() || '#eef7ff';
  for (const seg of state.segs) {
    if (seg.dataset.leg == null) continue;
    const leg = Number(seg.dataset.leg);
    const canvas = seg.querySelector('canvas');
    const w = Math.max(1, Math.round(seg.clientWidth));
    const key = `${state.active}:${state.loadKg}:${leg}:${w}`;
    if (canvas.dataset.key === key) continue;
    canvas.dataset.key = key;
    canvas.width = w;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const a = route.stops[leg].dist;
    const b = route.stops[leg + 1].dist;
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = heatColor(pointAt(route, a + ((x + 0.5) / w) * (b - a)).heat);
      ctx.fillRect(x, 0, 1, 1);
    }
    ctx.fillStyle = ink;
    for (const r of route.restStops) {
      if (r.dist < a || r.dist > b) continue;
      const x = Math.round(((r.dist - a) / (b - a)) * w);
      ctx.fillRect(Math.max(0, Math.min(w - 2, x - 1)), 0, 2, 1);
    }
  }
}

function currentRange() {
  const r = state.ranges;
  let i = r.findIndex((x) => scrollY < x.s1);
  if (i < 0) i = r.length - 1;
  return { i, frac: clamp01((scrollY - r[i].s0) / (r[i].s1 - r[i].s0)) };
}

function paintScrub() {
  if (!state.segs?.length || !state.ranges.length) return;
  const { i, frac } = currentRange();
  state.segs.forEach((el, j) => el.style.setProperty('--reached', j < i ? 1 : j > i ? 0 : frac.toFixed(4)));
  const seg = state.segs[i];
  $('playhead').style.transform = `translateX(${(seg.offsetLeft + frac * seg.offsetWidth).toFixed(1)}px)`;
}

// Where a point on the track sends the page.
function scrollAtX(clientX) {
  const rect = $('track').getBoundingClientRect();
  const x = clientX - rect.left;
  let j = state.segs.findIndex((el) => x < el.offsetLeft + el.offsetWidth + 1);
  if (j < 0) j = state.segs.length - 1;
  const el = state.segs[j];
  const frac = clamp01((x - el.offsetLeft) / el.offsetWidth);
  const r = state.ranges[j];
  return { i: j, y: r.s0 + frac * (r.s1 - r.s0) };
}

// Where a click on a chapter lands: the exact moment in the walk, the
// middle of a reading chapter, the bottom for the face-off.
function landing(i, y) {
  const c = state.chapters[i];
  const r = state.ranges[i];
  if (c.kind === 'leg') return y ?? r.s0 + 2;
  if (c.kind === 'title') return 0;
  if (c.kind === 'end') return endLanding();
  return (r.s0 + r.s1) / 2;
}

function bindTransport() {
  const track = $('scrub');
  const drag = { id: null, x0: 0, moved: false, block: false };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag.id = e.pointerId;
    drag.x0 = e.clientX;
    drag.moved = false;
  });
  track.addEventListener('pointermove', (e) => {
    if (drag.id !== e.pointerId) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      track.setPointerCapture?.(e.pointerId);
      setAuto(false);
      cancelGlide();
    }
    scrollTo({ top: scrollAtX(e.clientX).y, behavior: 'instant' });
  });
  const stop = (e) => {
    if (drag.id !== e.pointerId) return;
    drag.id = null;
    if (drag.moved) { drag.block = true; setTimeout(() => { drag.block = false; }, 0); }
  };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
  track.addEventListener('click', (e) => {
    if (drag.block) { drag.block = false; return; }
    const seg = e.target.closest?.('.seg');
    if (e.detail === 0 && seg) { goTo(landing(Number(seg.dataset.i))); return; }
    const { i, y } = scrollAtX(e.clientX);
    goTo(landing(i, y));
  });

  $('play').addEventListener('click', () => {
    if (auto.on) { setAuto(false); return; }
    if (state.kind === 'end' || scrollY >= endLanding() - 2) cut(0, () => setAuto(true));
    else setAuto(true);
  });
  $('start').addEventListener('click', () => {
    const i = state.chapters.findIndex((c) => c.kind === 'routes');
    goTo(state.ranges[i].s0 + 2, () => { if (!REDUCED) setAuto(true); });
  });
}

/* Moving the page: glides, cuts and autoplay */

function bezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  const fy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let k = 0; k < 6; k++) {
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (fx(t) - x) / d;
    }
    return fy(clamp01(t));
  };
}
const IN_OUT = bezier(0.65, 0, 0.35, 1);

const glide = { raf: 0 };
function cancelGlide() {
  if (glide.raf) cancelAnimationFrame(glide.raf);
  glide.raf = 0;
}

const maxScroll = () => Math.max(0, root.scrollHeight - innerHeight);

function endLanding() {
  if (!NARROW.matches) return maxScroll();
  const fo = $('fo');
  return Math.min(maxScroll(), fo.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(root).getPropertyValue('--top')) - 8);
}

function goTo(y, done) {
  setAuto(false);
  cancelGlide();
  y = Math.max(0, Math.min(maxScroll(), y));
  const d = Math.abs(y - scrollY);
  if (d < 2) { done?.(); return; }
  if (REDUCED || d > 2 * innerHeight) { cut(y, done); return; }
  const from = scrollY;
  const ms = Math.min(1400, 600 + (800 * d) / (2 * innerHeight));
  const t0 = performance.now();
  const step = (now) => {
    const k = clamp01((now - t0) / ms);
    scrollTo({ top: from + (y - from) * IN_OUT(k), behavior: 'instant' });
    if (k < 1) glide.raf = requestAnimationFrame(step);
    else { glide.raf = 0; done?.(); }
  };
  glide.raf = requestAnimationFrame(step);
}

function setShutterTiming(ms, ease) {
  const sh = $('shutters');
  sh.style.setProperty('--sh-ms', `${ms}ms`);
  sh.style.setProperty('--sh-ease', `var(--${ease})`);
}

// A long jump closes the shutters, moves, and opens them again.
function cut(y, done) {
  setAuto(false);
  cancelGlide();
  const close = REDUCED ? 150 : 320;
  const open = REDUCED ? 150 : 700;
  setShutterTiming(close, 'in');
  body.classList.add('shut');
  setTimeout(() => {
    scrollTo({ top: y, behavior: 'instant' });
    update();
    setShutterTiming(open, 'out');
    requestAnimationFrame(() => body.classList.remove('shut'));
    done?.();
  }, close);
}

const auto = { on: false, y: 0, last: 0 };

function setAuto(on) {
  auto.on = on;
  const btn = $('play');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (!on) return;
  cancelGlide();
  auto.y = scrollY;
  auto.last = performance.now();
  requestAnimationFrame(autoFrame);
}

function autoFrame(now) {
  if (!auto.on) return;
  const dt = Math.min(0.1, (now - auto.last) / 1000);
  auto.last = now;
  const H = innerHeight;
  const c = chapterAt(auto.y + H * 0.5);
  let speed = c.play ? c.h / c.play : H / 1.2;
  const end = state.chapters.at(-1);
  const target = endLanding();
  // The end lands gently: the page slows as it reaches the face-off.
  if (auto.y + H * 0.85 >= end.top) {
    const gap = target - auto.y;
    if (gap <= 1) { scrollTo({ top: target, behavior: 'instant' }); setAuto(false); return; }
    speed = Math.min(H / 1.2, Math.max(24, gap * 1.6));
  }
  auto.y = Math.min(target, auto.y + speed * dt);
  scrollTo({ top: auto.y, behavior: 'instant' });
  requestAnimationFrame(autoFrame);
}

function bindAuto() {
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    addEventListener(type, (e) => {
      if (e.target.closest?.('#play, #start, #replay')) return;
      if (auto.on) setAuto(false);
      if (type !== 'mousedown' || !e.target.closest?.('#scrub')) cancelGlide();
    }, { passive: true });
  }
}

boot().catch((err) => {
  console.error(err);
  progress(1, 'Could not load the walk. Open the walk tool: classic.html');
});
