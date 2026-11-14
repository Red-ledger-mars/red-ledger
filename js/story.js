// The story page: one walk at Gale crater, told in chapters over the 3D
// ground. Scrolling moves the walker, so the scroll position is the clock.
// After loading, the story plays itself; any scroll, touch or key hands
// control to the viewer, and the Auto button gives it back.
//
// All numbers come from the planned routes (data/routes.json, made by
// tools/plan_routes.mjs) and the body model (js/body.js). This file adds no
// science of its own.
import { loadTerrain } from './terrain.js';
import { MODEL, SOURCES } from './body.js';
import { pointAt } from './route.js';
import { createView3D } from './view3d.js';
import { heatColor, heatShare } from './heat.js';

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
const PLAY = { title: 5, routes: 8, walk: 36, verdict: 6 };

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
  progress(0.04, 'TERRAIN');
  let done = 0;
  const tick = (label) => (value) => { done += 1; progress(0.04 + done * 0.24, label); return value; };
  const [terrain, walk, planned] = await Promise.all([
    loadTerrain().then(tick('ELEVATION')),
    fetch('data/walk.json').then((r) => r.json()).then(tick('STOPS')),
    fetch('data/routes.json').then((r) => r.json()).then(tick('ROUTES')),
  ]);
  for (const def of ROUTES) state.routes[def.id] = planned.loads[0][def.pricing];
  state.walk = walk;

  progress(0.8, 'HIRISE 0.3 M · 3D GROUND');
  state.view = await createView3D($('stage'), {
    terrain,
    routes: state.routes,
    colors: Object.fromEntries(ROUTES.map((d) => [d.id, d.colour])),
  });
  if (state.view.available) {
    state.view.show();
    state.view.resize();
    state.view.setRoute(state.active);
  } else {
    document.body.classList.add('no3d');
  }

  build();
  progress(1, 'READY');
  await wait(350);
  document.body.classList.remove('loading');

  addEventListener('resize', () => { state.view.resize(); measure(); update(); });
  addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  measure();
  update();
  bindAuto();
  if (!REDUCED) setAuto(true);
}

/* Chapters */

function routeButton(def) {
  const t = state.routes[def.id].totals;
  return `
    <button class="route" type="button" data-route="${def.id}" aria-pressed="${def.id === state.active}">
      <span class="route-name mono">${def.name} · ${def.hint}</span>
      <span class="route-big">${num(t.peakHeatNoRest, 1, { assumed: true, colour: heatColor(t.peakHeatNoRest) })}</span>
      <span class="route-unit mono"><span class="unit">kJ/kg</span><br>peak heat</span>
      <span class="route-meta mono">${fmt(t.dist / 1000, 2)} km · ${minutes(t.seconds)} min with rests</span>
    </button>`;
}

function routeDetail() {
  const t = state.routes[state.active].totals;
  const name = ROUTES.find((d) => d.id === state.active).name;
  return `
    <div class="detail full-only" id="route-detail">
      <p class="mono">${name} route in full</p>
      <dl>
        <dt>Energy</dt><dd>${num(t.kcal, 0, { assumed: true })} kcal</dd>
        <dt>Radiation</dt><dd>${num(t.dose, 1, { assumed: true })} µSv</dd>
        <dt>Climb</dt><dd>${fmt(t.climb)} m</dd>
        <dt>Steepest</dt><dd>${fmt(t.steepestDeg)}° · ${fmt(t.beyondMeasured)} m beyond tested slope</dd>
        <dt>Planned rests</dt><dd>${t.restCount} · ${minutes(t.restSeconds)} min</dd>
        <dt>Heat on people</dt><dd>${t.peakHeatRange.map((v) => fmt(v, 1)).join(' to ')} kJ/kg across the spread measured</dd>
      </dl>
    </div>`;
}

function build() {
  const route = state.routes[state.active];
  const stops = route.stops;
  const total = route.totals.dist;
  const legs = stops.length - 1;
  const html = [];

  html.push(`
    <section class="chapter centred" data-kind="title" data-play="${PLAY.title}">
      <div class="chapter-body">
        <p class="kicker mono">One walk at Gale crater, Mars</p>
        <h1 class="title">Mars is<br>costly</h1>
        <p class="lede">Two routes to the same rocks. What each one costs the body, step by step.</p>
        <p class="cue mono">Scroll ↓ or press Auto</p>
      </div>
    </section>`);

  html.push(`
    <section class="chapter centred" data-kind="routes" data-play="${PLAY.routes}">
      <div class="chapter-body">
        <p class="kicker mono">Two ways to walk it</p>
        <h2>Same stops.<br>Different heat.</h2>
        <div class="routes">${ROUTES.map(routeButton).join('')}</div>
        <p class="lede">Each big number is the body heat stored at its peak if the walker never rests. NASA's limit is <b>${fmt(MODEL.heatLimitKJkg, 1)} kJ/kg</b>.</p>
        ${FULL ? routeDetail() : ''}
      </div>
    </section>`);

  for (let i = 0; i < legs; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const len = to.dist - from.dist;
    const place = to.place;
    html.push(`
      <section class="chapter" data-kind="leg" data-leg="${i}" data-play="${(PLAY.walk * len / total).toFixed(2)}" style="height: ${Math.max(120, Math.round(560 * len / total))}vh">
        <div class="chapter-body">
          <p class="kicker mono">Leg ${i + 1} of ${legs} · ${fmt(len)} m<span class="steep-note" hidden> · steepest ground</span></p>
          <h2>→ ${esc(place.name)}</h2>
          <p class="lede">${esc(place.text)}</p>
          ${place.assumption ? '<p class="place-note mono">Assumed place</p>' : ''}
          ${place.source ? `<p class="detail full-only"><a href="${esc(place.source)}" target="_blank" rel="noopener">Source: ${esc(new URL(place.source).hostname)}</a>${place.sol ? ` · sol ${place.sol}` : ''}</p>` : ''}
        </div>
      </section>`);
  }

  const over = ROUTES.filter((d) => state.routes[d.id].totals.peakHeatNoRest > MODEL.heatLimitKJkg);
  const verdict = over.length === ROUTES.length
    ? 'Both routes go over the heat limit unless the walker rests.'
    : over.length === 1
      ? `Only the ${over[0].name.toLowerCase()} route goes over the heat limit without rests.`
      : 'Neither route reaches the heat limit.';
  const restsKeepUnder = ROUTES.every((d) => state.routes[d.id].totals.peakHeat < MODEL.heatLimitKJkg);
  html.push(`
    <section class="chapter centred" data-kind="verdict" data-play="${PLAY.verdict}">
      <div class="chapter-body">
        <p class="kicker mono">Home · the verdict</p>
        <h2>${verdict}</h2>
        ${restsKeepUnder ? `<p class="lede">With the planned rests, both stay under ${fmt(MODEL.heatLimitKJkg, 1)} kJ/kg.</p>` : ''}
      </div>
    </section>`);

  html.push(`
    <section class="chapter wide centred" data-kind="end" id="end">
      <div class="chapter-body">
        <p class="kicker mono">Face-off</p>
        <div class="faceoff">${ROUTES.map(column).join('')}</div>
        <div class="actions">
          <button class="act mono" type="button" id="replay">→ Replay</button>
          <a class="act mono" href="classic.html">→ Walk it yourself</a>
          <a class="act mono full-only" href="classic.html">→ Walk brief and check vs Curiosity</a>
        </div>
        ${sourcesBlock()}
      </div>
    </section>`);

  $('story').innerHTML = html.join('');
  buildHud();

  for (const btn of document.querySelectorAll('.route')) btn.addEventListener('click', () => setActive(btn.dataset.route));
  $('replay').addEventListener('click', () => { scrollTo(0, 0); setAuto(true); });
  findSteepLeg();
}

function column(def) {
  const t = state.routes[def.id].totals;
  return `
    <div class="col">
      <p class="col-name mono">${def.name} · ${def.hint}</p>
      <dl>
        <dt class="mono">Peak heat, no rests</dt>
        <dd>${num(t.peakHeatNoRest, 2, { assumed: true, colour: heatColor(t.peakHeatNoRest) })}<small>kJ/kg</small></dd>
        <dt class="mono">Time with rests</dt>
        <dd>${minutes(t.seconds)}<small>min</small></dd>
        <dt class="mono">Energy</dt>
        <dd>${num(t.kcal, 0, { assumed: true })}<small>kcal</small></dd>
        <dt class="mono full-only">Radiation</dt>
        <dd class="full-only">${num(t.dose, 1, { assumed: true })}<small>µSv</small></dd>
        <dt class="mono full-only">Distance · climb</dt>
        <dd class="full-only">${fmt(t.dist / 1000, 2)}<small>km</small> ${fmt(t.climb)}<small>m</small></dd>
      </dl>
    </div>`;
}

function sourcesBlock() {
  const items = Object.values(SOURCES).map((s) => `
    <li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>${FULL ? esc(s.what) : ''} <span class="mono">${esc(s.status)}</span></li>`);
  return `
    <div class="sources" id="sources">
      <p class="kicker mono">Sources and assumptions</p>
      <ol>${items.join('')}</ol>
    </div>`;
}

/* The live number */

function buildHud() {
  $('hud').innerHTML = `
    <p class="hud-label mono">Body heat</p>
    <span class="hud-value assumed" id="hud-heat">0.00</span>
    <span class="hud-unit mono"><span class="unit">kJ/kg</span> · NASA limit ${fmt(MODEL.heatLimitKJkg, 1)}</span>
    <div class="meter"><i id="hud-fill"></i><b style="left: ${(MODEL.heatLimitKJkg / MODEL.heatContingencyKJkg) * 100}%"></b></div>
    <div class="meter-key mono"><span>0</span><span>limit</span></div>
    <p class="hud-meta mono" id="hud-meta"></p>
    <p class="hud-event mono" id="hud-event"></p>
    <dl class="hud-rows full-only mono" id="hud-rows"></dl>`;
}

function renderHud(p, route) {
  const colour = heatColor(p.heat);
  const hud = $('hud');
  hud.style.setProperty('--hud-colour', colour);
  const value = $('hud-heat');
  value.textContent = fmt(p.heat, 2);
  value.style.setProperty('--stroke', colour);
  $('hud-fill').style.width = `${clamp01(p.heat / MODEL.heatContingencyKJkg) * 100}%`;
  $('hud-meta').textContent = `${fmt(p.dist)} m walked · ${minutes(p.seconds)} min`;
  const rest = route.restStops.find((r) => p.dist >= r.dist && p.dist < r.dist + 30);
  $('hud-event').textContent = rest ? `Planned rest · ${minutes(rest.seconds)} min` : '';
  if (FULL) {
    const left = ((MODEL.energyBudgetKcal - p.kcal - p.backKcal) / MODEL.energyBudgetKcal) * 100;
    $('hud-rows').innerHTML = `
      <dt>Energy <span class="unit">kcal</span></dt><dd>${num(p.kcal, 0, { assumed: true })}</dd>
      <dt>Radiation <span class="unit">µSv</span></dt><dd>${num(p.dose, 1, { assumed: true })}</dd>
      <dt>Way home, energy left</dt><dd>${fmt(left)}%</dd>
      <dt>Sky blocked</dt><dd>${fmt(p.skyPct)}%</dd>`;
  }
  const glow = $('glow');
  glow.style.setProperty('--glow-colour', colour);
  glow.style.setProperty('--glow', clamp01((heatShare(p.heat) - 0.3) / 0.7).toFixed(3));
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
  } else if (c.kind === 'verdict' || c.kind === 'end') {
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
  $('hud').hidden = !(walking || c.kind === 'verdict');
  document.body.classList.toggle('ending', c.kind === 'end');
  if (!walking && c.kind !== 'verdict') $('glow').style.setProperty('--glow', 0);
}

function setDist(dist) {
  if (Math.abs(dist - state.dist) < 0.5) return;
  state.dist = dist;
  const route = state.routes[state.active];
  const p = pointAt(route, dist);
  state.view.setWalker(dist);
  const upTo = route.points.indexOf(p);
  if (dist > 0) state.view.setTrail(route.points.slice(0, upTo + 1));
  else state.view.clearTrail();
  const kind = state.chapter?.dataset.kind;
  if (dist > 0 && (kind === 'leg' || kind === 'verdict')) renderHud(p, route);
}

function setActive(id) {
  if (id === state.active) return;
  state.active = id;
  for (const btn of document.querySelectorAll('.route')) btn.setAttribute('aria-pressed', String(btn.dataset.route === id));
  state.view.setRoute(id);
  state.view.clearTrail();
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
  btn.textContent = on ? '❚❚ Auto' : '▶ Auto';
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
