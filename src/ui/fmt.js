// Display formatting shared by every view.
export const shortAddr = (a) => (a && a.length > 10 ? a.slice(0, 4) + "..." + a.slice(-4) : a || "");

export const fmtSol = (lamports) => {
  const sol = lamports / 1e9;
  return (sol >= 1 ? sol.toFixed(1) : sol.toFixed(sol >= 0.01 ? 2 : 3)) + " SOL";
};

export const fmtUsd = (n) => {
  if (n == null || isNaN(n)) return "-";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Number(n).toFixed(n >= 1 ? 2 : 4);
};

export const fmtPct = (n) => (n == null ? "" : (n >= 0 ? "+" : "") + Number(n).toFixed(1) + "%");

export const fmtWhen = (unixSeconds) => {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "now";
  if (mins < 60) return Math.floor(mins) + "m ago";
  if (mins < 60 * 24) return Math.floor(mins / 60) + "h ago";
  if (mins < 60 * 24 * 7) return Math.floor(mins / 60 / 24) + "d ago";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
