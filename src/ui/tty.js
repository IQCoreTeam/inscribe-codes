// Typewriter for terminal-style reveals. Elements marked data-tty type their
// own text once; `type` drives a standalone target (the hero).
const speed = (ch) => (ch === " " ? 20 : /[.:]/.test(ch) ? 110 : 9 + Math.random() * 20);

export function type(el, full, onTick) {
  let n = 0;
  el.setAttribute("data-tty-on", "");
  return new Promise((resolve) => {
    (function step() {
      n++;
      el.textContent = full.slice(0, n);
      if (onTick) onTick(n);
      if (n < full.length && el.isConnected) setTimeout(step, speed(full[n - 1]));
      else { el.removeAttribute("data-tty-on"); resolve(); }
    })();
  });
}

export function typeLabels(container) {
  for (const el of container.querySelectorAll("[data-tty]")) {
    if (el.__tty) continue;
    el.__tty = 1;
    const full = el.textContent;
    if (!full.trim()) continue;
    if (!el.hasAttribute("data-tty-stable")) { type(el, full); continue; }
    el.classList.add("tty-stable");
    const space = document.createElement("span");
    space.className = "tty-stable-space";
    space.textContent = full;
    const reveal = document.createElement("span");
    reveal.className = "tty-stable-content";
    reveal.setAttribute("aria-hidden", "true");
    el.replaceChildren(space, reveal);
    type(reveal, full);
  }
}
