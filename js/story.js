// The story page: one walk at Gale crater, told in chapters over the 3D
// ground. Scrolling moves the walker, so the scroll position is the clock.
// After loading, the story plays itself; any scroll, touch or key hands
// control to the viewer, and the Auto button gives it back.
//
// All numbers come from the planned routes (data/routes.json, made by
// tools/plan_routes.mjs) and the body model (js/body.js). This file adds no
// science of its own.
import { loadTerrain } from './terrain.js';
import { MODEL, SOURCES, energyLeftPct } from './body.js';
import { pointAt } from './route.js';
import { createView3D } from './view3d.js';
import { heatColor } from './heat.js';
import { smoothScroll } from './smooth-scroll.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const FULL = document.documentElement.dataset.mode === 'full';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (value, digits = 0) => value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const minutes = (s) => Math.round(s / 60);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The same two routes as the planner page, with its names.
const ROUTES = [
  { id: 'direct', pricing: 'direct', name: 'Direct', hint: 'shortest over the ground', colour: '#ffffff' },
  { id: 'body', pricing: 'body', name: 'Body-cost', hint: 'least walking energy', colour: '#8c8c8c' },
];

// Seconds of autoplay. The legs of the walk share PLAY.walk by length, so
// the whole story runs for about a minute.
const PLAY = { title: 5, routes: 8, detail: 5, walk: 34, verdict: 5, test: 8 };

const state = {
  routes: {},       // id -> planned route with no load carried
  active: 'direct',
  view: null,       // the 3D view
  chapters: [],     // measured chapter blocks, top to bottom
  chapter: null,    // the chapter in the middle of the screen
  dist: -1,         // metres walked along the active route
  steepLeg: -1,     // the leg that holds the steepest ground
};

// A number as the page shows it. Assumed numbers are hollow (see the key
// in the footer); `colour` tints the number with body heat.
function num(value, digits, { assumed = false, colour = null } = {}) {
  const style = colour ? ` style="--stroke: ${colour};${assumed ? '' : ` color: ${colour};`}"` : '';
  return `<span class="${assumed ? 'assumed' : ''}"${style}>${fmt(value, digits)}</span>`;
}

/* Loading */

function progress(share, label) {
  $('loader').style.setProperty('--p', share);
  $('loader-step').textContent = label;
  $('loader-pct').textContent = Math.round(share * 100);
}

async function boot() {
  progress(0.04, 'Terrain');
  let done = 0;
  const tick = (label) => (value) => { done += 1; progress(0.04 + done * 0.24, label); return value; };
  const [terrain, walk, planned] = await Promise.all([
    loadTerrain().then(tick('Elevation')),
    fetch('data/walk.json').then((r) => r.json()).then(tick('Stops')),
    fetch('data/routes.json').then((r) => r.json()).then(tick('Routes')),
  ]);
  for (const def of ROUTES) state.routes[def.id] = planned.loads[0][def.pricing];
  state.walk = walk;

  progress(0.8, 'HiRISE imagery and 3D ground');
  state.view = await createView3D($('stage'), {
    terrain,
    routes: state.routes,
    colors: Object.fromEntries(ROUTES.map((d) => [d.id, d.colour])),
    // Each route line is shaded by the body heat the plan gives at each point.
    pointColors: (id, route) => route.points.map((p) => heatColor(p.heat)),
  });
  if (state.view.available) {
    state.view.show();
    state.view.resize();
    state.view.setRoute(state.active);
    // The story needs only the route lines and a small walker dot, with the
    // scene moved right of the text column. These hooks come with the 3D
    // view's own update and are skipped until then.
    state.view.setMarks?.({ pins: false, ring: false });
    shiftView();
    // Dragging the walker along the route moves the page to that moment, so
    // the scroll position stays the one clock everything else follows.
    state.view.setWalkerDrag?.((dist) => {
      if (auto.on) setAuto(false);
      scrollTo({ top: scrollForDist(dist), behavior: 'instant' });
    });
  } else {
    document.body.classList.add('no3d');
  }

  build();
  progress(1, 'Ready');
  await wait(350);
  document.body.classList.remove('loading');

  addEventListener('resize', () => { state.view.resize(); shiftView(); measure(); update(); });
  addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  measure();
  update();
  bindAuto();
  smoothScroll();
  if (!REDUCED) setAuto(true);
}

// The text column covers the left of the screen, so the scene centres in
// the rest of it. Phones stack text over the ground and keep it centred.
function shiftView() {
  state.view.setViewShift?.(innerWidth > 720 ? 0.15 : 0);
}

/* Chapters */

function routeButton(def) {
  const t = state.routes[def.id].totals;
  return `
    <button class="route" type="button" data-route="${def.id}" aria-pressed="${def.id === state.active}">
      <span class="route-name label">${def.name} · ${def.hint}</span>
      <span class="route-big">${num(t.peakHeatNoRest, 2, { assumed: true, colour: heatColor(t.peakHeatNoRest) })}<small class="label"><span class="unit">kJ/kg</span> peak heat with no rest</small></span>
      <span class="route-meta label">${heatRange(t)}</span>
    </button>`;
}

// Agreed with the Main chat: wherever heat is shown to two decimals against
// the limit, the range measured on people stays in the same view.
const heatRange = (t) => `Range from NASA's measurements of people: ${t.peakHeatRange.map((v) => fmt(v, 1)).join(' to ')} kJ/kg`;

function routeDetail() {
  const t = state.routes[state.active].totals;
  const name = ROUTES.find((d) => d.id === state.active).name;
  return `
    <div class="detail full-only" id="route-detail">
      <p class="label">${name} route in full</p>
      <dl>
        <dt>Energy</dt><dd>${num(t.kcal, 0, { assumed: true })} kcal</dd>
        <dt>Radiation</dt><dd>${num(t.dose, 1, { assumed: true })} µSv</dd>
        <dt>Climb</dt><dd>${fmt(t.climb)} m</dd>
        <dt>Steepest</dt><dd>${fmt(t.steepestDeg)}° · ${fmt(t.beyondMeasured)} m beyond tested slope</dd>
        <dt>Planned rests</dt><dd>${t.restCount} · ${minutes(t.restSeconds)} min</dd>
        <dt>Range from NASA's measurements of people</dt><dd>${t.peakHeatRange.map((v) => fmt(v, 1)).join(' to ')} kJ/kg</dd>
      </dl>
    </div>`;
}

function build() {
  const route = state.routes[state.active];
  const stops = route.stops;
  const total = route.totals.dist;
  const legs = stops.length - 1;
  const html = [];

  // Wording from the Main chat. Any other outcome of the data shows no
  // verdict line, so the page never says something nobody has checked.
  const bothOver = ROUTES.every((d) => state.routes[d.id].totals.peakHeatNoRest > MODEL.heatLimitKJkg);
  if (!bothOver) console.warn('Story: the routes no longer both pass the heat limit; the verdict line is hidden.');
  const VERDICT = 'By the model\'s central estimate, both routes go over the heat limit unless the walker rests.';

  html.push(`
    <section class="chapter" data-kind="title" data-play="${PLAY.title}">
      <div class="chapter-body">
        <h1 class="title">Mars is<br>costly</h1>
        ${bothOver ? `<p class="result">${VERDICT}</p>` : ''}
        <p class="actions"><button class="act primary" type="button" id="start">Start the walk</button></p>
        <p class="quiet">A planning forecast, not a diagnosis.</p>
      </div>
    </section>`);

  html.push(`
    <section class="chapter" data-kind="routes" data-play="${PLAY.routes}">
      <div class="chapter-body">
        <h2>Same stops.<br>Different heat.</h2>
        <div class="routes">${ROUTES.map(routeButton).join('')}</div>
        <p class="lede">Each big number is the most body heat the walker would store with no rest. <a href="${esc(SOURCES.heatLimit.url)}" target="_blank" rel="noopener">NASA's limit</a> for suited work is <b>${fmt(MODEL.heatLimitKJkg, 1)} kJ/kg</b>.</p>
        <p class="quiet">Hollow numbers rest on an assumption</p>
      </div>
    </section>`);

  // The full version gives the chosen route's details a chapter of their own.
  if (FULL) {
    html.push(`
    <section class="chapter" data-kind="routes" data-play="${PLAY.detail}">
      <div class="chapter-body">${routeDetail()}</div>
    </section>`);
  }

  for (let i = 0; i < legs; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const len = to.dist - from.dist;
    const place = to.place;
    html.push(`
      <section class="chapter" data-kind="leg" data-leg="${i}" data-play="${(PLAY.walk * len / total).toFixed(2)}" style="height: ${Math.max(120, Math.round(560 * len / total))}vh">
        <div class="chapter-body">
          <h2>${esc(place.name)}</h2>
          <p class="meta">Leg ${i + 1} of ${legs} · ${fmt(len)} m<span class="steep-note" hidden> · steepest ground</span>${place.assumption ? ' · Assumed place' : ''}</p>
          <p class="lede">${esc(place.text)}</p>
          ${place.source ? `<p class="detail full-only"><a href="${esc(place.source)}" target="_blank" rel="noopener">Source: ${esc(new URL(place.source).hostname)}</a>${place.sol ? ` · sol ${place.sol}` : ''}</p>` : ''}
        </div>
      </section>`);
  }

  const restsKeepUnder = ROUTES.every((d) => state.routes[d.id].totals.peakHeat < MODEL.heatLimitKJkg);
  html.push(`
    <section class="chapter" data-kind="verdict" data-play="${PLAY.verdict}">
      <div class="chapter-body">
        ${bothOver ? `<h2>${VERDICT}</h2>` : ''}
        ${restsKeepUnder ? `<p class="lede">With the planned rests, both stay under ${fmt(MODEL.heatLimitKJkg, 1)} kJ/kg.</p>` : ''}
      </div>
    </section>`);

  html.push(`
    <section class="chapter wide-text" data-kind="test" data-play="${PLAY.test}">
      <div class="chapter-body">
        <h2>We tested the model against NASA's measurements of people. It failed.</h2>
        <p class="lede">The test and its pass mark were fixed in the repository before any measurement was collected. NASA has measured how hard people work when they walk on a treadmill at Moon and Mars gravity: we used 40 of those measurements, 19 of them in a spacesuit. On level ground people in the suit used 36% more energy than the model predicted. On climbs the model predicted up to 2.2 times too much. We corrected it by the rule we had set. The revised model is within 14% of all 12 sloped measurements, a fix made after seeing them.</p>
        <p class="actions"><a class="act" href="classic.html#proof">How we tested it</a></p>
      </div>
    </section>`);

  html.push(`
    <section class="chapter end" data-kind="end" id="end">
      <div class="chapter-body">
        <h2>Face-off</h2>
        ${faceoff()}
        <div class="actions">
          <button class="act" type="button" id="replay">Replay</button>
          <a class="act" href="classic.html">Walk it yourself</a>
          <a class="act full-only" href="classic.html#brief">Walk brief</a>
          <a class="act full-only" href="classic.html#proof">Check vs Curiosity</a>
          <a class="act" href="CREDITS.md">Sources and credits</a>
        </div>
      </div>
    </section>`);

  $('story').innerHTML = html.join('');
  buildHud();

  for (const btn of document.querySelectorAll('.route')) btn.addEventListener('click', () => setActive(btn.dataset.route));
  $('replay').addEventListener('click', () => { scrollTo(0, 0); setAuto(true); });
  $('start').addEventListener('click', () => setAuto(true));
  findSteepLeg();
}

// The two routes face to face, one row per measure. The bar under each
// number is its length against the larger of the two.
const FACEOFF = [
  { label: 'Peak heat, no rests', unit: 'kJ/kg', value: (t) => t.peakHeatNoRest, digits: 2, assumed: true, heat: true, note: heatRange },
  { label: 'Time with rests', unit: 'min', value: (t) => t.seconds / 60, digits: 0 },
  { label: 'Energy', unit: 'kcal', value: (t) => t.kcal, digits: 0, assumed: true },
  { label: 'Radiation', unit: 'µSv', value: (t) => t.dose, digits: 1, assumed: true, full: true },
  { label: 'Distance', unit: 'km', value: (t) => t.dist / 1000, digits: 2, full: true },
  { label: 'Climb', unit: 'm', value: (t) => t.climb, digits: 0, full: true },
];

function faceoff() {
  const head = `<div class="fo-row fo-head label"><span></span>${ROUTES.map((d) => `<span>${d.name}<br>${d.hint}</span>`).join('')}</div>`;
  const rows = FACEOFF.map((row) => {
    const totals = ROUTES.map((d) => state.routes[d.id].totals);
    const values = totals.map(row.value);
    const most = Math.max(...values);
    const cells = values.map((v, i) => {
      const colour = row.heat ? heatColor(v) : null;
      const note = row.note ? `<span class="fo-note label">${row.note(totals[i])}</span>` : '';
      return `<span class="fo-cell"><b>${num(v, row.digits, { assumed: row.assumed, colour })}</b><small class="unit">${row.unit}</small>${note}<i style="width: ${((v / most) * 100).toFixed(1)}%;${colour ? ` background: ${colour};` : ''}"></i></span>`;
    });
    return `<div class="fo-row${row.full ? ' full-only' : ''}"><span class="label">${row.label}</span>${cells.join('')}</div>`;
  });
  return `<div class="faceoff">${head}${rows.join('')}</div>`;
}

/* The live number */

function buildHud() {
  $('hud').innerHTML = `
    <p class="label">Body heat</p>
    <p class="hud-line"><span class="label">about</span> <span class="hud-value assumed" id="hud-heat">0.0</span> <span class="label"><span class="unit">kJ/kg</span> · NASA limit ${fmt(MODEL.heatLimitKJkg, 1)}</span></p>
    <div class="meter"><i id="hud-fill"></i><b style="left: ${(MODEL.heatLimitKJkg / MODEL.heatContingencyKJkg) * 100}%"></b></div>
    <p class="label" id="hud-meta"></p>
    <p class="label hud-event" id="hud-event"></p>
    ${state.view.setWalkerDrag ? '<p class="label hud-hint">Drag the walker to move along the route</p>' : ''}
    <dl class="hud-rows full-only" id="hud-rows"></dl>`;
}

function renderHud(p, route) {
  const colour = heatColor(p.heat);
  const hud = $('hud');
  hud.style.setProperty('--hud-colour', colour);
  const value = $('hud-heat');
  value.textContent = fmt(p.heat, 1);
  value.style.setProperty('--stroke', colour);
  $('hud-fill').style.width = `${clamp01(p.heat / MODEL.heatContingencyKJkg) * 100}%`;
  $('hud-meta').textContent = `${fmt(p.dist)} m walked · ${minutes(p.seconds)} min`;
  const rest = route.restStops.find((r) => p.dist >= r.dist && p.dist < r.dist + 30);
  $('hud-event').textContent = rest ? `Planned rest · ${minutes(rest.seconds)} min` : '';
  if (FULL) {
    const left = energyLeftPct(p.kcal, p.backKcal);
    $('hud-rows').innerHTML = `
      <dt>Energy <span class="unit">kcal</span></dt><dd>${num(p.kcal, 0, { assumed: true })}</dd>
      <dt>Radiation <span class="unit">µSv</span></dt><dd>${num(p.dose, 1, { assumed: true })}</dd>
      <dt>Way home, energy left</dt><dd>${fmt(left)}%</dd>
      <dt>Sky blocked</dt><dd>${fmt(p.skyPct)}%</dd>`;
  }
}

/* Scroll: the clock */

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

// The scroll position that puts the walker at `dist`: update() run backwards.
function scrollForDist(dist) {
  const route = state.routes[state.active];
  const legs = state.chapters.filter((c) => c.kind === 'leg');
  const c = legs.find((ch) => dist <= route.stops[ch.leg + 1].dist) ?? legs.at(-1);
  const a = route.stops[c.leg].dist;
  const b = route.stops[c.leg + 1].dist;
  return c.top + clamp01((dist - a) / (b - a)) * c.h - innerHeight * 0.5;
}

function update() {
  if (!state.chapters.length) return;
  const route = state.routes[state.active];
  const y = scrollY + innerHeight * 0.5;
  const c = chapterAt(y);
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

function setChapter(c) {
  if (state.chapter === c.el) return;
  for (const ch of state.chapters) ch.el.classList.toggle('is-active', ch.el === c.el);
  state.chapter = c.el;
  const walking = c.kind === 'leg';
  state.view.setMode(walking ? 'chase' : 'orbit');
  // The live number shows only during the walk, so it never sits under
  // the verdict text in the same left column.
  $('hud').hidden = !walking;
  // Long reading and the face-off dim the ground behind the text.
  document.body.classList.toggle('ending', c.kind === 'end' || c.kind === 'test');
}

function setDist(dist) {
  if (Math.abs(dist - state.dist) < 0.5) return;
  state.dist = dist;
  const route = state.routes[state.active];
  const p = pointAt(route, dist);
  // The view eases the walker toward this distance (a no-op option until
  // the 3D view supports it), so wheel steps glide instead of jump.
  state.view.setWalker(dist, { ease: true });
  const kind = state.chapter?.dataset.kind;
  if (dist > 0 && kind === 'leg') renderHud(p, route);
}

function setActive(id) {
  if (id === state.active) return;
  state.active = id;
  for (const btn of document.querySelectorAll('.route')) btn.setAttribute('aria-pressed', String(btn.dataset.route === id));
  state.view.setRoute(id);
  if (FULL) $('route-detail').outerHTML = routeDetail();
  findSteepLeg();
  state.chapter = null;
  state.dist = -1;
  update();
}

// The leg that holds the steepest ground is marked. (The 3D slope tint is
// red and orange, which here would read as heat, so it stays off for now.)
function findSteepLeg() {
  const route = state.routes[state.active];
  const steep = route.points.reduce((a, p) => (Math.abs(p.gradient) > Math.abs(a.gradient) ? p : a));
  state.steepLeg = route.stops.findIndex((s, i) => i < route.stops.length - 1 && steep.dist <= route.stops[i + 1].dist);
  for (const el of document.querySelectorAll('[data-kind="leg"]')) {
    el.querySelector('.steep-note').hidden = Number(el.dataset.leg) !== state.steepLeg;
  }
}

/* Autoplay */

const auto = { on: false, y: 0, last: 0 };

function setAuto(on) {
  auto.on = on;
  const btn = $('auto');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'Pause' : 'Auto';
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
  $('auto').addEventListener('click', () => {
    const atEnd = state.chapter?.dataset.kind === 'end';
    if (!auto.on && atEnd) scrollTo(0, 0);
    setAuto(!auto.on);
  });
  // Any input from the viewer takes over from autoplay.
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    addEventListener(type, (e) => {
      if (auto.on && !e.target.closest?.('#auto')) setAuto(false);
    }, { passive: true });
  }
}

boot().catch((err) => {
  console.error(err);
  progress(1, 'COULD NOT LOAD THE WALK · OPEN classic.html');
});
