// Router only. Views are lazy modules so the heavy chain deps load per side.
const VIEWS = {
  home: () => import("./views/home.js"),
  token: () => import("./views/token/board.js"),
  nft: () => import("./views/nft/launchpad.js"),
};

const root = document.getElementById("app");
let unmount = null;

function viewName() {
  const v = new URLSearchParams(location.search).get("view");
  return VIEWS[v] ? v : "home";
}

async function render() {
  const name = viewName();
  const view = await VIEWS[name]();
  if (unmount) unmount();
  root.innerHTML = "";
  window.scrollTo(0, 0);
  unmount = (await view.mount(root)) || null;
  document.title = name === "home" ? "inscribe.codes" : "inscribe.codes · " + name;
}

// In-app navigation: any ?view= link routes without a reload.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="?view="]');
  if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  history.pushState(null, "", href === "?view=home" ? location.pathname : href);
  render();
});
window.addEventListener("popstate", render);

render();
