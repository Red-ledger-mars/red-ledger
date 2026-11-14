// Plans a walk the visitor chooses: habitat -> chosen stops -> habitat.
// The search runs in a worker (js/planner-worker.js); this file is the small
// part the page talks to.
//
//   const planner = createPlanner();
//   const result = await planner.plan({ stops: [{ lat, lon }], loadKg: 30 },
//     (pricing, route) => { /* draw each route as soon as it is ready */ });
//   // result is { direct, body, ms }, or null when a newer request replaced
//   // this one. A route is null when no path exists under that pricing.
//   // Each route has the same shape as an entry of data/routes.json.
//
// Only one walk is searched at a time. A request made while another is
// running waits; a third request replaces the one that is waiting.

export function createPlanner() {
  const worker = new Worker(new URL('./planner-worker.js', import.meta.url), { type: 'module' });
  let nextId = 1;
  let running = null;
  let waiting = null;

  const start = (job) => {
    running = job;
    worker.postMessage({ id: job.id, ...job.request });
  };

  const finish = (settle) => {
    const job = running;
    running = null;
    settle(job);
    if (waiting) {
      const next = waiting;
      waiting = null;
      start(next);
    }
  };

  worker.onmessage = ({ data }) => {
    if (!running || data.id !== running.id) return;
    if (data.kind === 'route') {
      running.routes[data.pricing] = data.route;
      running.onRoute(data.pricing, data.route);
    } else if (data.kind === 'done') {
      finish((job) => job.resolve({ direct: job.routes.direct ?? null, body: job.routes.body ?? null, ms: data.ms }));
    } else if (data.kind === 'error') {
      finish((job) => job.reject(new Error(data.message)));
    }
  };
  worker.onerror = (event) => {
    if (running) finish((job) => job.reject(new Error(event.message || 'The planner stopped.')));
  };

  return {
    plan({ stops, loadKg = 0 }, onRoute = () => {}) {
      return new Promise((resolve, reject) => {
        const job = { id: nextId++, request: { stops, loadKg }, onRoute, resolve, reject, routes: {} };
        if (!running) { start(job); return; }
        waiting?.resolve(null);
        waiting = job;
      });
    },
    dispose() {
      worker.terminate();
      waiting?.resolve(null);
      running?.resolve(null);
      running = null;
      waiting = null;
    },
  };
}
