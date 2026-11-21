// Injetada na página via chrome.scripting (func serializada). Precisa ser autocontida.
// o = { text, actions: [{ label, type, text? }], autoHide? }
// action.type: "copy" (copia action.text) | "open" (abre action.url) | "go" (navega na mesma aba para action.url) | qualquer outro vira runtime.sendMessage({ type })
function showBanner(o) {
  const id = "livelo-auto-banner";
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .b{position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;
       max-width:min(560px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;
       background:#1b1b1f;color:#fff;font:14px/1.3 system-ui,sans-serif;box-shadow:0 4px 18px #0006}
    .b span{flex:1}
    button{border:0;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer;background:#c4005f;color:#fff}
    button.x{background:transparent;color:#bbb;padding:2px 6px}`;
  const box = document.createElement("div");
  box.className = "b";
  const label = document.createElement("span");
  label.textContent = o.text;
  box.append(label);
  for (const a of o.actions || []) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.onclick = async () => {
      if (a.type === "copy") {
        await navigator.clipboard.writeText(a.text);
        btn.textContent = "Copiado";
      } else if (a.type === "open") {
        window.open(a.url, "_blank", "noopener");
      } else if (a.type === "go") {
        location.href = a.url;
      } else {
        chrome.runtime.sendMessage({ type: a.type });
        if (a.type !== "login") host.remove();
      }
    };
    box.append(btn);
  }
  const close = document.createElement("button");
  close.className = "x";
  close.textContent = "×";
  close.onclick = () => {
    chrome.runtime.sendMessage({ type: "dismiss" });
    host.remove();
  };
  box.append(close);
  root.append(style, box);
  document.documentElement.append(host);
  if (o.autoHide) setTimeout(() => host.remove(), o.autoHide);
}
