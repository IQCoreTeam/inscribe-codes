// Discover first, then let the selected button request the wallet connection.
let openPicker = null;

export function chooseWallet({ list, connect, activeId, subscribe }) {
  if (openPicker) return openPicker;
  const dialog = document.createElement("dialog");
  dialog.className = "win wallet-picker";
  dialog.setAttribute("aria-labelledby", "wallet-picker-title");
  dialog.innerHTML = `
    <div class="wh">
      <span id="wallet-picker-title">Choose a wallet</span>
      <button type="button" class="wh-right wh-x" aria-label="Close wallet picker">x</button>
    </div>
    <div class="wallet-picker-body">
      <div class="wallet-picker-options"></div>
      <p class="wallet-message" role="status">Looking for browser wallets…</p>
    </div>`;
  const options = dialog.querySelector(".wallet-picker-options");
  const status = dialog.querySelector(".wallet-message");
  const close = dialog.querySelector("button");
  let busy = false;
  let result = null;
  let off;
  let revision = 0;

  async function pick(button) {
    if (busy) return;
    busy = true;
    close.disabled = true;
    for (const button of options.querySelectorAll("button")) button.disabled = true;
    status.textContent = "Approve the connection in your wallet…";
    try {
      result = await connect(button.dataset.walletId);
      dialog.close();
    } catch (error) {
      status.textContent = error?.message || "Connection failed. Try again.";
      busy = false;
      close.disabled = false;
      for (const button of options.querySelectorAll("button")) button.disabled = false;
      button.focus();
    }
  }

  async function refresh() {
    if (busy) return;
    const request = ++revision;
    try {
      const wallets = await list();
      if (!dialog.open || busy || request !== revision) return;
      const focusedId = options.contains(document.activeElement) ? document.activeElement.dataset.walletId : null;
      options.replaceChildren();
      for (const wallet of wallets) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn2 wallet-picker-option";
        button.dataset.walletId = wallet.id;
        button.textContent = wallet.name + (wallet.id === activeId ? " · connected" : "");
        button.onclick = () => pick(button);
        options.append(button);
        if (wallet.id === focusedId) button.focus();
      }
      status.textContent = wallets.length
        ? activeId ? "To change accounts in one wallet, select the account there first." : ""
        : "No compatible browser wallet detected. Open your wallet’s browser or enable a wallet extension.";
    } catch (error) {
      if (dialog.open && request === revision) status.textContent = error?.message || "Could not load wallets.";
    }
  }

  close.onclick = () => dialog.close();
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog || busy) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  openPicker = new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      off?.();
      dialog.remove();
      openPicker = null;
      resolve(result);
    }, { once: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  off = subscribe?.(refresh);
  refresh();
  return openPicker;
}
