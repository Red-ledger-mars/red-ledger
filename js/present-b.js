// The Bill: the presentation as a printed poster. One walk at Gale crater,
// billed to the walker's body. The masthead and the receipt stay in one place
// and change with the chapter; the round window shows the live 3D ground and
// the dial around it shows stored body heat against NASA's limit.
//
// Scroll is the clock, wired as on the story page (js/story.js): the page
// height is the chapters, the probe line is mid-screen, and in the walk the
// scroll position is the walker's distance along the route. Every sentence
// is the story page's approved wording; every number is read from the data.
import { loadTerrain } from './terrain.js';
import { MODEL, SOURCES } from './body.js';
import { pointAt } from './route.js';
import { createView3D, CREDIT_TEXT } from './view3d.js';
import { heatColor, heatState } from './heat.js';
import { smoothScroll } from './smooth-scroll.js';
import { loadComms } from './comms.js';
import { loadSky } from './sky.js';
import { createFreeWalk } from './freewalk.js';
import { loadReach, REACH_LEGEND } from './reach.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (value, digits = 0) => value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const minutes = (s) => Math.round(s / 60);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const narrow = () => innerWidth <= 900;

// Motion timings, in ms (see css/present-b.css for the curves).
const T = REDUCED
  ? { mastOut: 150, retract: 150, feed: 150, leaveWalk: 150, jump: 150 }
  : { mastOut: 160, retract: 260, feed: 520, leaveWalk: 400, jump: 200 };

const ROUTES = [
  { id: 'direct', pricing: 'direct', name: 'Direct', hint: 'shortest over the ground', colour: '#ffffff' },
  { id: 'body', pricing: 'body', name: 'Body-cost', hint: 'least walking energy', colour: '#8c8c8c' },
];

// Seconds of autoplay, the same as the story page.
const PLAY = { title: 6, routes: 11, detail: 7, walk: 62, verdict: 8, reach: 11, test: 14 };

// Approved wording (js/story.js).
const KICKER = 'One walk at Gale crater, Mars, and what it costs the body, step by step.';
const PLACE_LINE = 'Gale crater · Mount Sharp · boxwork ridges';
const VERDICT = 'By the model\'s central estimate, both routes go over the heat limit unless the walker rests.';
const REACH_TEXT = {
  0: 'With no load a walker can go 630 to 1,140 m from the habitat, depending on the ground, and come back with no rest.',
  15: 'Carrying 15 kg, a walker can go 550 to 870 m from the habitat, depending on the ground, and come back with no rest.',
  30: 'Carrying 30 kg, a walker can go 490 to 700 m from the habitat, depending on the ground, and come back with no rest.',
};
const TEST_TEXT = 'The test and its pass mark were fixed in the repository before any measurement was collected. NASA has measured how hard people work when they walk on a treadmill at Moon and Mars gravity: we used 40 of those measurements, 19 of them in a spacesuit. On level ground people in the suit used 36% more energy than the model predicted. On climbs the model predicted up to 2.2 times too much. We corrected it by the rule we had set. The revised model is within 14% of all 12 sloped measurements, a fix made after seeing them.';
const heatRange = (t) => `Range from NASA's measurements of people: ${t.peakHeatRange.map((v) => fmt(v, 1)).join(' to ')} kJ/kg`;
const LIMIT = () => `${fmt(MODEL.heatLimitKJkg, 1)} kJ/kg`;
// The limit inside a sentence: kept on one line, so the number never parts from its unit.
const LIMIT_NW = () => `<span class="nw">${LIMIT()}</span>`;

const state = {
  routes: {},
  plans: {},
  loadKg: 0,
  active: 'direct',
  view: null,
  chapters: [],
  chapter: null,      // the chapter record in the middle of the screen
  leg: -1,
  dist: -1,
  steepLeg: -1,
  move: Promise.resolve(true), // the latest camera move
  comms: null,
  startMinute: null,
  reach: null,
  overlay: false,
  free: null,
  credit: CREDIT_TEXT,
  bothOver: false,
  restsKeepUnder: false,
};

// A number as the page prints it. Assumed numbers are hollow; heat numbers
// take an ink by how close they are to the limit.
function num(value, digits, { assumed = false, heat = null, big = false, cls = '' } = {}) {
  const ink = heat == null ? '' : ` ink-${heatState(heat)}`;
  return `<span class="${assumed ? 'hollow' : 'num'}${ink}${big ? ' big' : ' strong'}${cls ? ` ${cls}` : ''}">${fmt(value, digits)}</span>`;
}
const KEY = '<p class="fine key"><b class="hollow key-mark">00</b> Hollow numbers rest on an assumption</p>';
const foot = (...lines) => `<div class="r-foot"><p class="fine r-credit">${esc(state.credit)}</p>${lines.join('')}</div>`;

/* Loading */

function progress(share, label) {
  const step = $('loader-step');
  if (!step) return;
  step.textContent = label;
  $('loader-pct').textContent = Math.round(share * 100);
}

async function boot() {
  const mast = $('mast');
  mast.innerHTML = mast.dataset.html = mastHtml('title');
  layout();
  addEventListener('resize', onResize);
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
  state.terrain = terrain;
  state.bothOver = ROUTES.every((d) => state.routes[d.id].totals.peakHeatNoRest > MODEL.heatLimitKJkg);
  state.restsKeepUnder = ROUTES.every((d) => state.routes[d.id].totals.peakHeat < MODEL.heatLimitKJkg);
  if (!state.bothOver) console.warn('Present: the routes no longer both pass the heat limit; the verdict line is hidden.');

  progress(0.8, 'HiRISE imagery and 3D ground');
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
    state.view.setWalkerFigure?.('img/walker.png');
    state.view.setViewShift?.(0);
    state.view.setWalkerDrag?.((dist) => {
      if (auto.on) setAuto(false);
      scrollTo({ top: scrollForDist(dist), behavior: 'instant' });
    });
    mirrorCredit();
  } else {
    showFlat();
  }
  $('stage').addEventListener('v3d-status', (e) => {
    if (!e.detail?.ok) showFlat();
    else document.body.classList.remove('flat');
  });

  build();
  // For checks only: ?debug exposes the page state in the console.
  if (new URLSearchParams(location.search).has('debug')) window.presentB = { state, update };
  progress(1, 'Ready');
  await wait(350);
  document.body.classList.remove('loading');

  addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  measure();
  update();
  bindAuto();
  smoothScroll();
  bindFree();
  if (!REDUCED) setAuto(true);
  loadComms().then((comms) => { state.comms = comms; pickStart(); if (show.key === 'end') refreshPaper(); }).catch(() => {});
  loadReach().then((reach) => { state.reach = reach; if (state.chapter?.kind === 'reach') showReach(); }).catch(() => {});
}

function onResize() {
  layout();
  if (!state.view) return;
  state.view.resize();
  measure();
  update();
}

// The view's imagery credit, shown on the page (it gains the walker note
// once the AI-made figure loads).
function mirrorCredit() {
  const el = $('stage').querySelector('.v3d-credit');
  const copy = () => {
    state.credit = el?.textContent || CREDIT_TEXT;
    $('credit').textContent = state.credit;
    for (const p of document.querySelectorAll('.r-credit')) p.textContent = state.credit;
  };
  copy();
  if (el) new MutationObserver(copy).observe(el, { childList: true, characterData: true, subtree: true });
}

/* The dial: a 24px bezel round the disc, a heat arc over the top, and a
   tick at NASA's limit. Drawn in screen pixels. */

const ARC_FROM = 150; // degrees, clockwise from the right, y down
const ARC_SWEEP = 240;
const dial = { cx: 0, cy: 0, R: 0 };
const polar = (r, deg) => [dial.cx + r * Math.cos(deg * Math.PI / 180), dial.cy + r * Math.sin(deg * Math.PI / 180)];

function layout() {
  const box = $('disc').getBoundingClientRect();
  dial.cx = box.left + box.width / 2;
  dial.cy = box.top + box.height / 2;
  dial.R = box.width / 2;
  const { R } = dial;
  const Ra = R + 12;
  const [sx, sy] = polar(Ra, ARC_FROM);
  const [ex, ey] = polar(Ra, ARC_FROM + ARC_SWEEP);
  const arc = `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${Ra} ${Ra} 0 1 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const tickDeg = ARC_FROM + ARC_SWEEP * (MODEL.heatLimitKJkg / MODEL.heatContingencyKJkg);
  const [t0x, t0y] = polar(R, tickDeg);
  const [t1x, t1y] = polar(R + 36, tickDeg);
  const svg = $('dial');
  svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  svg.innerHTML = `
    <circle class="bezel" cx="${dial.cx}" cy="${dial.cy}" r="${R + 11}"/>
    <path class="track" d="${arc}"/>
    <path class="arc" id="arc" d="${arc}" pathLength="1" stroke-dasharray="0 1"/>
    <line class="tick" x1="${t0x}" y1="${t0y}" x2="${t1x}" y2="${t1y}"/>`;
  const label = $('limit');
  label.textContent = `NASA limit ${LIMIT()}`;
  if (narrow()) {
    label.style.left = '';
    label.style.right = `${Math.max(8, innerWidth - (dial.cx + R + 24))}px`;
    label.style.top = `${t1y - 38}px`;
  } else {
    label.style.right = '';
    label.style.left = `${t1x + 8}px`;
    label.style.top = `${t1y - 22}px`;
  }
  const flood = $('flood');
  flood.style.setProperty('--cx', `${dial.cx}px`);
  flood.style.setProperty('--cy', `${dial.cy}px`);
  if (state.heat != null) drawArc(state.heat);
}

function drawArc(heat) {
  state.heat = heat;
  const arc = $('arc');
  if (!arc) return;
  const share = clamp01(heat / MODEL.heatContingencyKJkg);
  arc.setAttribute('stroke-dasharray', `${share.toFixed(4)} 1`);
  arc.style.stroke = heatColor(heat);
  arc.style.visibility = share > 0.002 ? 'visible' : 'hidden';
}

/* Chapters: only scroll length */

function build() {
  const route = state.routes[state.active];
  const stops = route.stops;
  const total = route.totals.dist;
  const legs = stops.length - 1;
  const html = [
    `<section class="chapter" data-kind="title" data-play="${PLAY.title}"></section>`,
    `<section class="chapter" data-kind="routes" data-play="${PLAY.routes}"></section>`,
  ];
  for (let i = 0; i < legs; i++) {
    const len = stops[i + 1].dist - stops[i].dist;
    html.push(`<section class="chapter" data-kind="leg" data-leg="${i}" data-play="${(PLAY.walk * len / total).toFixed(2)}" style="height: ${Math.max(180, Math.round(1000 * len / total))}vh"></section>`);
  }
  html.push(
    `<section class="chapter" data-kind="verdict" data-play="${PLAY.verdict}"></section>`,
    `<section class="chapter" data-kind="reach" data-play="${PLAY.reach}"></section>`,
    `<section class="chapter" data-kind="test" data-play="${PLAY.test}"></section>`,
    '<section class="chapter" data-kind="end"></section>',
  );
  $('chapters').innerHTML = html.join('');
  findSteepLeg();
}

function measure() {
  state.chapters = [...document.querySelectorAll('.chapter')].map((el) => ({
    el,
    kind: el.dataset.kind,
    leg: Number(el.dataset.leg),
    play: Number(el.dataset.play) || 0,
    top: el.offsetTop,
    h: el.offsetHeight,
  }));
}

const chapterAt = (y) => state.chapters.findLast((c) => c.top <= y) ?? state.chapters[0];

function scrollForDist(dist) {
  const route = state.routes[state.active];
  const legs = state.chapters.filter((c) => c.kind === 'leg');
  const c = legs.find((ch) => dist <= route.stops[ch.leg + 1].dist) ?? legs.at(-1);
  const a = route.stops[c.leg].dist;
  const b = route.stops[c.leg + 1].dist;
  return c.top + 1 + clamp01((dist - a) / (b - a)) * (c.h - 2) - innerHeight * 0.5;
}

function update() {
  if (!state.chapters.length || state.free) return;
  const route = state.routes[state.active];
  const y = scrollY + innerHeight * 0.5;
  const end = state.chapters.at(-1);
  const c = end.kind === 'end' && end.top < scrollY + innerHeight * 0.85 ? end : chapterAt(y);
  let dist = 0;
  if (c.kind === 'leg') {
    const a = route.stops[c.leg].dist;
    const b = route.stops[c.leg + 1].dist;
    dist = a + clamp01((y - c.top) / c.h) * (b - a);
  } else if (c.kind === 'verdict' || c.kind === 'test' || c.kind === 'end') {
    dist = route.totals.dist;
  }
  setChapter(c);
  setDist(dist);
}

const keyOf = (kind) => (kind === 'leg' ? 'walk' : kind);

function setChapter(c) {
  if (state.chapter?.el === c.el) return;
  const was = state.chapter;
  state.chapter = c;
  const walking = c.kind === 'leg';
  state.move = state.view.setMode(walking ? 'chase' : 'orbit') || Promise.resolve(true);
  if (c.kind === 'reach') {
    state.view.setRoutesVisible?.(false);
    showReach();
  } else if (state.overlay) {
    state.overlay = false;
    state.view.setOverlay?.(null);
    state.view.setRoutesVisible?.(true);
    if ($('flat-reach')) $('flat-reach').hidden = true;
  }
  if (c.kind !== 'verdict') setFlood(false);

  const body = document.body;
  const wasWalking = body.classList.contains('walking');
  body.classList.toggle('walking', walking);
  body.classList.toggle('leaving', wasWalking && !walking);
  body.classList.toggle('tall', c.kind === 'reach' || c.kind === 'test');

  if (walking) {
    state.leg = c.leg;
    if (show.key === 'walk' && was?.kind === 'leg') updateLeg(true);
  }
  want(keyOf(c.kind), wasWalking && !walking);
}

function setDist(dist) {
  if (Math.abs(dist - state.dist) < 0.5) return;
  state.dist = dist;
  state.view.setWalker(dist, { ease: true });
  if (state.chapter?.kind === 'leg') renderLive();
}

/* The masthead and the receipt change together. The old ones go first (the
   receipt back into its slot, the headline faded), the content is swapped
   while hidden, then both come back. Within the walk they stay out and only
   their parts change. */

const show = { key: 'loading', want: 'loading', busy: false, leavingWalk: false };

function want(key, leavingWalk = false) {
  show.want = key;
  if (leavingWalk) show.leavingWalk = true;
  pump();
}

async function pump() {
  if (show.busy) return;
  show.busy = true;
  const mast = $('mast');
  const till = $('till');
  try {
    while (show.key !== show.want) {
      const key = show.want;
      const next = mastHtml(key);
      const mastChanges = key === 'blank' || next !== mast.dataset.html;
      const outMs = show.leavingWalk ? T.leaveWalk : T.mastOut;
      show.leavingWalk = false;
      if (mastChanges) {
        mast.style.setProperty('--mast-out', `${outMs}ms`);
        mast.classList.remove('enter');
        mast.classList.add('out');
      }
      till.classList.add('in');
      await wait(Math.max(T.retract, mastChanges ? outMs : 0) + 20);
      if (show.want !== key) { if (show.want === show.key) show.key = null; continue; }

      document.body.classList.toggle('wide', key === 'end');
      if (mastChanges && key !== 'blank') { mast.innerHTML = next; mast.dataset.html = next; }
      $('paper').innerHTML = paperHtml(key);
      $('paper').scrollTop = 0;
      bindPaper(key);
      show.key = key;
      if (key === 'walk') { updateLeg(false); renderLive(); }
      if (key === 'free' && state.free) renderFree();
      if (key === 'blank') continue;

      // The verdict waits for the camera to pull back from the walker.
      if (key === 'verdict') {
        await state.move;
        if (show.want !== key) continue;
        if (state.bothOver) setFlood(true);
      }
      document.body.classList.remove('leaving');
      if (mastChanges || mast.classList.contains('out')) {
        mast.classList.remove('out');
        void mast.offsetWidth;
        mast.classList.add('enter');
      }
      till.classList.remove('in');
    }
  } finally {
    show.busy = false;
  }
}

// Re-renders the receipt in place, for a control that changed it.
function refreshPaper() {
  if (!show.key || show.key === 'blank' || show.key === 'loading') return;
  const paper = $('paper');
  const top = paper.scrollTop;
  paper.innerHTML = paperHtml(show.key);
  bindPaper(show.key);
  paper.scrollTop = top;
  if (show.key === 'walk') { updateLeg(false); renderLive(); }
}

// Leaves the screen with no blank frame: the receipt and the masthead go,
// the page moves, and the chapter it lands in brings them back. The disc
// stays on screen throughout.
async function jump(y) {
  want('blank');
  await wait(T.jump + 40);
  scrollTo({ top: y, behavior: 'instant' });
  state.chapter = null;
  state.dist = -1;
  update();
}

function setFlood(on) {
  document.body.classList.toggle('red', on);
}

/* What each chapter prints */

function mastHtml(key) {
  const k = (kicker, giant) => `<span class="kicker"><span class="kicker-in" id="mast-kicker">${kicker}</span></span><span class="giant" id="mast-giant">${giant}</span>`;
  switch (key) {
    case 'loading':
    case 'title': return k(esc(KICKER), 'Mars is costly');
    case 'routes': return k('Same stops.', 'Different heat.');
    case 'walk':
    case 'free': return k('', '<span class="about">about</span><span class="hollow live" id="mast-heat">0.0</span><span class="unit-d">kJ/kg</span>');
    case 'verdict': return k('NASA\'s limit for suited work is', `${LIMIT()}.`);
    case 'reach': return k('How far can a body go', 'without a rest?');
    case 'test': return k('We tested the model against NASA\'s measurements of people.', 'It failed.');
    case 'end': return k('', 'Face-off');
    default: return $('mast').dataset.html || '';
  }
}

function paperHtml(key) {
  switch (key) {
    case 'title': return titlePaper();
    case 'routes': return routesPaper();
    case 'walk': return walkPaper();
    case 'verdict': return verdictPaper();
    case 'reach': return reachPaper();
    case 'test': return testPaper();
    case 'end': return endPaper();
    case 'free': return freePaper();
    default: return '';
  }
}

function titlePaper() {
  return `
    <p class="fine">${PLACE_LINE}</p>
    ${state.bothOver ? `<p class="lead">${VERDICT}</p>` : ''}
    <p><button class="btn solid full" type="button" id="start">Start the walk</button></p>
    ${foot('<p class="fine">A planning forecast, not a diagnosis.</p>', '<p class="fine">Made with NASA open data</p>')}`;
}

function routeButton(def) {
  const t = state.routes[def.id].totals;
  return `
    <button class="route" type="button" data-route="${def.id}" aria-pressed="${def.id === state.active}">
      <span class="name">${def.name}</span>
      <span class="fine">${def.hint}</span>
      ${num(t.peakHeatNoRest, 2, { assumed: true, heat: t.peakHeatNoRest, big: true })}
      <span class="fine">kJ/kg peak heat with no rest</span>
      <span class="fine">${heatRange(t)}</span>
    </button>`;
}

function routesPaper() {
  return `
    <div class="routes">${ROUTES.map(routeButton).join('')}</div>
    <p>Each big number is the most body heat the walker would store with no rest. <a href="${esc(SOURCES.heatLimit.url)}" target="_blank" rel="noopener">NASA's limit</a> for suited work is <b>${LIMIT()}</b>.</p>
    ${foot(KEY)}`;
}

function walkPaper() {
  return `
    <div id="w-head">
      <p class="fine" id="w-meta"></p>
      <p id="w-text"></p>
      <p class="fine" id="w-src"></p>
    </div>
    <hr class="dash">
    <p class="fine">Energy so far · kcal</p>
    <div class="rows" id="w-rows"></div>
    <p class="rest" id="w-rest"></p>
    ${foot(KEY)}`;
}

function verdictPaper() {
  const rows = ROUTES.map((d) => {
    const t = state.routes[d.id].totals;
    return `
      <div class="vrow">
        <p class="line"><b>${d.name}</b><span>${num(t.peakHeatNoRest, 2, { assumed: true, heat: t.peakHeatNoRest })} kJ/kg</span></p>
        <p class="fine">${heatRange(t)}</p>
      </div>`;
  }).join('');
  return `
    ${state.bothOver ? `<p class="lead">${VERDICT}</p>` : ''}
    ${state.restsKeepUnder ? `<p>With the planned rests, both stay under ${LIMIT_NW()}.</p>` : ''}
    <hr class="dash">
    <p class="fine">Peak heat, no rests</p>
    ${rows}
    ${foot(KEY)}`;
}

function loadButtons() {
  const loads = Object.keys(state.plans).map(Number).sort((a, b) => a - b);
  return `<span class="seg">${loads.map((kg) => `<button type="button" data-load="${kg}" aria-pressed="${kg === state.loadKg}">${kg} kg</button>`).join('')}</span>`;
}

function reachPaper() {
  const chips = ['none', '1', '2', '3+'].map((label, i) => `<li><span class="chip"><i style="background: ${REACH_LEGEND[i].color}"></i></span>${label}</li>`).join('');
  return `
    <p>This map is coloured by the rests a body needs to walk from the habitat to each point and back.</p>
    <p>Clear ground needs no rest. Each band of colour is one more rest the plan adds.</p>
    <p class="lead">${REACH_TEXT[state.loadKg] ?? REACH_TEXT[0]}</p>
    <div class="group"><span class="fine">Carried load</span>${loadButtons()}</div>
    <div class="group"><span class="fine">Rests needed</span><ul class="chips">${chips}</ul></div>
    ${foot('<p class="fine">To walk from the habitat to a point and back, body-cost route, load shown.</p>')}`;
}

function testPaper() {
  return `
    <p>${TEST_TEXT}</p>
    <p class="btns"><a class="btn" href="classic.html#proof">How we tested it</a></p>
    ${foot()}`;
}

/* Face-off */

const contactShare = (contact) => contact.inContact.filter(Boolean).length / contact.inContact.length;
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

const TAPE = [
  { label: 'Planned rests', unit: (v) => (v === 1 ? 'rest' : 'rests'), value: (t) => t.restCount, digits: 0, note: (t) => `${minutes(t.restSeconds)} min resting` },
  { label: 'Time with rests', unit: () => 'min', value: (t) => t.seconds / 60, digits: 0 },
  { label: 'Energy', unit: () => 'kcal', value: (t) => t.kcal, digits: 0, assumed: true },
  { label: 'Radiation', unit: () => 'µSv', value: (t) => t.dose, digits: 1, assumed: true },
];
const CONTACT_ROW = {
  label: 'Orbiter in view',
  unit: () => '% of the walk',
  digits: 0,
  value: (t, id) => contactShare(state.comms.routeContact(state.routes[id].points, state.startMinute)) * 100,
  note: (t, id) => {
    const gap = state.comms.routeContact(state.routes[id].points, state.startMinute).longestGapMin;
    return gap > 0 ? `Up to ${Math.round(gap)} min with no contact` : 'Orbiter in view for the whole walk';
  },
};

function endPaper() {
  const totals = ROUTES.map((d) => state.routes[d.id].totals);
  const cell = (inner, i) => `<div class="t-val${i ? ' right' : ''}">${inner}</div>`;
  const head = `<div class="t-head t-name">${ROUTES[0].name}<span class="fine">${ROUTES[0].hint}</span></div><div class="t-head t-label"></div><div class="t-head t-name right">${ROUTES[1].name}<span class="fine">${ROUTES[1].hint}</span></div>`;
  const peak = `<div class="t-label">Peak heat, no rests<br>kJ/kg</div>`;
  const peakCells = totals.map((t, i) => cell(`${num(t.peakHeatNoRest, 2, { assumed: true, heat: t.peakHeatNoRest, big: true })}<span class="fine">${heatRange(t)}</span>`, i));
  const rows = [...TAPE, ...(state.comms && state.startMinute != null ? [CONTACT_ROW] : [])].map((row) => {
    const cells = totals.map((t, i) => {
      const v = row.value(t, ROUTES[i].id);
      return cell(`${num(v, row.digits, { assumed: row.assumed })} <span class="t-unit">${row.unit(v)}</span>${row.note ? `<span class="fine note">${row.note(t, ROUTES[i].id)}</span>` : ''}`, i);
    });
    return `<div class="t-label">${row.label}</div>${cells[0]}${cells[1]}`;
  }).join('');
  const start = state.comms && state.startMinute != null ? `
    <label class="group"><span class="fine">Start, on the day modelled</span>
      <select id="plan-start">${START_MINUTES.map((m) => `<option value="${m}"${m === state.startMinute ? ' selected' : ''}>${state.comms.localTime(m)} · ${Math.round(bodyShare(m) * 100)}% in contact</option>`).join('')}</select>
    </label>` : '';
  return `
    <div class="controls"><div class="group"><span class="fine">Carried load</span>${loadButtons()}</div>${start}</div>
    <div class="tape">${head}${cellsRow(peakCells, peak)}${rows}</div>
    <div class="btns">
      <button class="btn solid" type="button" id="replay">Replay</button>
      ${state.view?.available ? '<button class="btn" type="button" id="free-open">Walk it yourself</button>' : ''}
      <a class="btn" href="classic.html">Open the map tool</a>
      <a class="btn" href="classic.html#proof">How we tested it</a>
      <a class="btn" href="CREDITS.md">Sources and credits</a>
    </div>
    ${foot('<p class="fine">Made with NASA open data</p>', '<p class="fine">A planning forecast, not a diagnosis.</p>', KEY).replace('r-foot', 'r-foot inline')}`;
}
const cellsRow = (cells, label) => `${label}${cells[0]}${cells[1]}`;

function bindPaper(key) {
  $('start')?.addEventListener('click', () => {
    const first = state.chapters.find((c) => c.kind === 'leg');
    if (REDUCED && first) { jump(scrollForDist(0)); return; }
    setAuto(true);
  });
  for (const btn of document.querySelectorAll('.route')) btn.addEventListener('click', () => setActive(btn.dataset.route));
  for (const btn of document.querySelectorAll('[data-load]')) btn.addEventListener('click', () => setLoad(Number(btn.dataset.load)));
  $('plan-start')?.addEventListener('change', (e) => { state.startMinute = Number(e.target.value); refreshPaper(); });
  $('replay')?.addEventListener('click', async () => {
    endFree();
    await jump(0);
    if (!REDUCED) setAuto(true);
  });
  $('free-open')?.addEventListener('click', startFree);
  $('free-end')?.addEventListener('click', endFree);
  if (key === 'free') bindFreeKeys();
}

/* The walk */

function findSteepLeg() {
  const route = state.routes[state.active];
  const steep = route.points.reduce((a, p) => (Math.abs(p.gradient) > Math.abs(a.gradient) ? p : a));
  state.steepLeg = route.stops.findIndex((s, i) => i < route.stops.length - 1 && steep.dist <= route.stops[i + 1].dist);
}

// The parts of the walk that change with the leg: the kicker, the stop's
// sentence and its source, and the rows of stops reached.
function updateLeg(animate) {
  const route = state.routes[state.active];
  const stops = route.stops;
  const i = Math.max(0, state.leg);
  const legs = stops.length - 1;
  const from = stops[i];
  const to = stops[i + 1];
  const place = to.place;

  const kicker = $('mast-kicker');
  if (kicker && kicker.textContent !== place.name) {
    kicker.textContent = place.name;
    if (animate) { kicker.classList.remove('swap'); void kicker.offsetWidth; kicker.classList.add('swap'); }
  }

  const head = $('w-head');
  if (!head) return;
  if (head.dataset.leg !== String(i)) {
    head.dataset.leg = String(i);
    $('w-meta').textContent = `Leg ${i + 1} of ${legs} · ${fmt(to.dist - from.dist)} m${i === state.steepLeg ? ' · steepest ground' : ''}${place.assumption ? ' · Assumed place' : ''}`;
    $('w-text').textContent = place.text;
    $('w-src').innerHTML = place.source ? `<a href="${esc(place.source)}" target="_blank" rel="noopener">Source: ${esc(new URL(place.source).hostname)}</a>${place.sol ? ` · sol ${place.sol}` : ''}` : '';
    if (animate && !REDUCED) { head.classList.remove('swap-in'); void head.offsetWidth; head.classList.add('swap-in'); }
  }

  // One row per stop reached; the last is the leg in progress.
  const rows = $('w-rows');
  const count = i + 1;
  while (rows.children.length > count) rows.lastElementChild.remove();
  while (rows.children.length < count) {
    const n = rows.children.length;
    const wrap = document.createElement('div');
    wrap.className = `row-wrap${animate && !REDUCED ? ' opening' : ''}`;
    wrap.innerHTML = `<div class="row"><span>${esc(stops[n + 1].place.name)}</span><span class="kcal"></span></div>`;
    rows.append(wrap);
  }
  [...rows.children].forEach((wrap, n) => {
    const row = wrap.firstElementChild;
    const live = n === count - 1;
    row.classList.toggle('live', live);
    row.firstElementChild.textContent = stops[n + 1].place.name;
    if (!live) row.lastElementChild.innerHTML = num(pointAt(route, stops[n + 1].dist).kcal, 0, { assumed: true });
  });
}

// The numbers that follow the scroll with no tween.
function renderLive() {
  const route = state.routes[state.active];
  const p = pointAt(route, state.dist);
  const heat = $('mast-heat');
  if (heat) {
    heat.textContent = fmt(p.heat, 1);
    heat.className = `hollow live ink-${heatState(p.heat)}`;
  }
  drawArc(p.heat);
  const rows = $('w-rows');
  const live = rows?.lastElementChild?.firstElementChild;
  if (live) live.lastElementChild.innerHTML = num(p.kcal, 0, { assumed: true });
  const rest = route.restStops.find((r) => p.dist >= r.dist && p.dist < r.dist + 30);
  const restEl = $('w-rest');
  if (restEl) restEl.textContent = rest ? `Planned rest · ${minutes(rest.seconds)} min` : '';
}

function setActive(id) {
  if (id === state.active) return;
  state.active = id;
  for (const btn of document.querySelectorAll('.route')) btn.setAttribute('aria-pressed', String(btn.dataset.route === id));
  state.view.setRoute(id);
  findSteepLeg();
  state.dist = -1;
  update();
}

// A new load changes every number: the routes, their rests, the heat along
// them. The chapters are measured again and the page stays where it was.
function setLoad(kg) {
  if (kg === state.loadKg || !state.plans[kg]) return;
  const here = state.chapter ?? state.chapters.at(-1);
  const kind = here.kind;
  const offset = scrollY - here.top;
  state.loadKg = kg;
  for (const def of ROUTES) state.routes[def.id] = state.plans[kg][def.pricing];
  state.view.setRoutes?.(state.routes);
  state.view.setRoute(state.active);
  build();
  measure();
  const there = state.chapters.find((ch) => ch.kind === kind) ?? state.chapters.at(-1);
  scrollTo({ top: there.top + offset, behavior: 'instant' });
  state.chapter = there;
  state.dist = -1;
  if (kind === 'reach') showReach();
  refreshPaper();
  update();
}

/* The reach map and the flat ground */

const reachImages = {};
function showFlat() {
  document.body.classList.add('flat');
  state.credit = CREDIT_TEXT;
  $('credit').textContent = CREDIT_TEXT;
  if ($('flat')) return;
  const box = document.createElement('div');
  box.id = 'flat';
  box.innerHTML = '<img src="img/ground-flat.jpg" alt="Orbital picture of the walk area at Gale crater"><img id="flat-reach" alt="" hidden>';
  $('stage').append(box);
  if (state.chapter?.kind === 'reach') showReach();
}

function showReach() {
  if (!state.reach) return;
  reachImages[state.loadKg] ??= state.reach.image(state.loadKg);
  state.overlay = true;
  state.view?.setOverlay?.(reachImages[state.loadKg], state.reach.bounds);
  const flat = $('flat-reach');
  if (flat) { flat.src = reachImages[state.loadKg]; flat.hidden = false; }
}

/* Walk it yourself */

const keys = new Set();
const freeClock = { last: 0, drawn: 0 };

function freePaper() {
  return `
    <p>You choose the ground and the body model runs on it. The planned route and its rests do not apply.</p>
    <p class="lead" id="free-msg"></p>
    <p class="fine" id="free-meta"></p>
    <hr class="dash">
    <div class="rows">
      <div class="row live"><span>Energy · kcal</span><span id="free-kcal"></span></div>
      <div class="row live"><span>Radiation · µSv</span><span id="free-dose"></span></div>
    </div>
    <div class="keys">
      <button type="button" class="btn" data-key="ArrowLeft">Turn left</button>
      <button type="button" class="btn solid" data-key="ArrowUp">Walk</button>
      <button type="button" class="btn" data-key="ArrowRight">Turn right</button>
    </div>
    <p class="btns"><button class="btn" type="button" id="free-end">End free walk</button></p>
    ${foot(KEY)}`;
}

function bindFreeKeys() {
  for (const btn of document.querySelectorAll('[data-key]')) {
    const key = btn.dataset.key;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); keys.add(key); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, () => keys.delete(key));
  }
}

async function startFree() {
  if (state.free || !state.view.available) return;
  setAuto(false);
  if (state.sky === undefined) state.sky = await loadSky().catch(() => null);
  state.freeScroll = scrollY;
  state.free = createFreeWalk({ terrain: state.terrain, sky: state.sky, walk: state.walk, loadKg: state.loadKg });
  document.body.classList.add('free');
  state.view.setRoutesVisible?.(false);
  state.view.clearTrail?.();
  state.move = state.view.setMode('chase');
  state.view.setWalkerAt?.(state.free.lat, state.free.lon, state.free.heading);
  want('free');
  freeClock.last = performance.now();
  requestAnimationFrame(freeFrame);
}

function endFree() {
  if (!state.free) return;
  state.free = null;
  keys.clear();
  document.body.classList.remove('free');
  state.view.clearTrail?.();
  state.view.setRoutesVisible?.(true);
  state.view.setRoute(state.active);
  state.view.setWalker(state.routes[state.active].totals.dist);
  state.chapter = null;
  state.dist = -1;
  update();
}

function freeFrame(now) {
  const f = state.free;
  if (!f) return;
  const dt = Math.min(0.2, (now - freeClock.last) / 1000);
  freeClock.last = now;
  if (f.tick(now, dt, keys)) state.view.setTrail?.(f.trail);
  state.view.setWalkerAt?.(f.lat, f.lon, f.heading);
  if (now - freeClock.drawn > 100 && show.key === 'free') { freeClock.drawn = now; renderFree(); }
  requestAnimationFrame(freeFrame);
}

function renderFree() {
  const f = state.free;
  const l = f.ledger;
  const heat = $('mast-heat');
  if (heat) {
    heat.textContent = fmt(l.heatKJkg, 1);
    heat.className = `hollow live ink-${heatState(l.heatKJkg)}`;
  }
  const kicker = $('mast-kicker');
  if (kicker && kicker.textContent !== 'Walk it yourself') kicker.textContent = 'Walk it yourself';
  drawArc(l.heatKJkg);
  $('free-msg').textContent = f.message || '';
  $('free-meta').textContent = `${fmt(f.dist)} m walked · ${minutes(l.seconds)} min · ${f.rests} forced rest${f.rests === 1 ? '' : 's'}`;
  $('free-kcal').innerHTML = num(l.kcal, 0, { assumed: true });
  $('free-dose').innerHTML = num(l.doseUSv, 1, { assumed: true });
}

function bindFree() {
  addEventListener('keydown', (e) => {
    if (!state.free) return;
    if (e.key.startsWith('Arrow')) { e.preventDefault(); keys.add(e.key); }
    if (e.key === 'Escape') endFree();
  });
  addEventListener('keyup', (e) => keys.delete(e.key));
  addEventListener('blur', () => keys.clear());
}

/* Autoplay */

const auto = { on: false, y: 0, last: 0 };

function setAuto(on) {
  auto.on = on;
  const btn = $('play');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Pause the walk' : 'Play the walk');
  if (!on) return;
  auto.y = scrollY;
  auto.last = performance.now();
  requestAnimationFrame(autoFrame);
}

function autoFrame(now) {
  if (!auto.on) return;
  const dt = Math.min(0.1, (now - auto.last) / 1000);
  auto.last = now;
  const c = chapterAt(auto.y + innerHeight * 0.5);
  let speed = c.play ? c.h / c.play : innerHeight / 1.2;
  if (c.kind === 'end') {
    if (auto.y >= c.top - 40) { setAuto(false); return; }
    speed = innerHeight / 1.2;
  }
  auto.y += speed * dt;
  scrollTo(0, auto.y);
  requestAnimationFrame(autoFrame);
}

function bindAuto() {
  $('play').addEventListener('click', async () => {
    endFree();
    const atEnd = state.chapter?.kind === 'end';
    if (!auto.on && atEnd) { await jump(0); setAuto(true); return; }
    setAuto(!auto.on);
  });
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    addEventListener(type, (e) => {
      if (auto.on && !e.target.closest?.('#play, #start')) setAuto(false);
    }, { passive: true });
  }
}

boot().catch((err) => {
  console.error(err);
  $('paper').innerHTML = '<p class="lead">Could not load the walk.</p><p><a class="btn" href="classic.html">Open the map tool</a></p>';
});
