// Smooth mouse-wheel scrolling for the story page.
//
// A mouse wheel moves the page in steps of about 100 px, and Chrome on Linux
// does not smooth them, so the text and the walker jump on every notch. Here a
// notch moves a target and the page glides toward it. Trackpads already scroll
// smoothly, so a burst of wheel events that starts small is left to the
// browser, as are the keyboard, the scrollbar and touch. Anything else that
// moves the page (autoplay, the jump to the top on Replay) wins: the glide
// stops and starts again from there. Off when less motion is asked for.

const TAU = 0.12; // s; the glide closes 63% of the gap in this time
const NOTCH = 50; // px; a first wheel event this large is a mouse wheel, not a trackpad
const BURST_GAP = 200; // ms between wheel events that still belong to one gesture

export function smoothScroll() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.scrollingElement || document.documentElement;
  let target = scrollY; // where the wheel wants the page
  let shown = scrollY; // where this module last put it
  let raf = 0;
  let last = 0;
  const burst = { at: -Infinity, smooth: false };

  const go = (y) => {
    shown = y;
    scrollTo({ top: y, behavior: 'instant' });
  };

  function frame(now) {
    raf = 0;
    // Something else moved the page: follow it instead of fighting it.
    if (Math.abs(scrollY - shown) > 1.5) {
      target = shown = scrollY;
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const gap = target - shown;
    if (Math.abs(gap) < 0.5) {
      go(target);
      return;
    }
    go(shown + gap * (1 - Math.exp(-dt / TAU)));
    raf = requestAnimationFrame(frame);
  }

  addEventListener('wheel', (e) => {
    if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight * 0.9 : 1);
    const now = performance.now();
    // The first event of a gesture decides: mouse wheel (smooth it) or trackpad (leave it).
    if (now - burst.at > BURST_GAP) burst.smooth = e.deltaMode !== 0 || Math.abs(dy) >= NOTCH;
    burst.at = now;
    if (!burst.smooth || document.querySelector('dialog[open]') || scrollsInside(e.target, dy)) return;
    e.preventDefault();
    if (!raf) {
      target = shown = scrollY;
      last = now;
      raf = requestAnimationFrame(frame);
    }
    target = Math.max(0, Math.min(root.scrollHeight - innerHeight, target + dy));
  }, { passive: false });
}

// True when the wheel is over something that scrolls by itself and can still
// move that way.
function scrollsInside(el, dy) {
  if (!(el instanceof Element)) return false; // a wheel sent to window or document
  for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  return false;
}
