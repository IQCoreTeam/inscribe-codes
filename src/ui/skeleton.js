// Loading placeholder shaped like a real card: a pulsing image block over a few
// text lines (.skel in base.css). Any grid that reads from chain fills itself
// with these while the feed loads. `variant` adds a modifier class so a grid can
// match its own card shape (e.g. "tk" = square dot-grid image for token cards).
export const skeleton = (n = 3, variant = "") =>
  `<div class="skel${variant ? " " + variant : ""}"><div class="a"></div><div class="b"><i></i><i style="width:40%"></i><i></i></div></div>`.repeat(n);
