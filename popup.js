const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const when = (t) => (t ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca");
const hm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const WHY = {
  not_in_catalog: "Esta loja não está no catálogo (ainda).",
  cooldown: "Já ativada nas últimas horas.",
  disabled: "Desativada por você nesta loja.",
  skip_path: "Página de carrinho, checkout ou login: não ativa aqui.",
  tagged: "O link já tem marcação Livelo ou de afiliado.",
  manual: "Modo manual: use o banner para ativar.",
  need_cpf: "Informe o CPF para ativar esta loja.",
  need_login: "Entre na Livelo para ativar esta loja.",
  api_blocked: "API Livelo bloqueada temporariamente.",
  prerender: "Página pré-carregada: ativa quando você abrir.",
  error: "Erro ao gerar o link Livelo.",
  activated: "Livelo ativada nesta aba.",
};
const WHY_TONE = { activated: "ok", cooldown: "warn", manual: "warn", need_cpf: "warn", need_login: "warn", prerender: "warn", error: "bad", api_blocked: "bad" };
const label = (code) => WHY[code] || code;
const fmtCpf = (v) => {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "." + d.slice(3, 6);
  if (d.length > 6) out += "." + d.slice(6, 9);
  if (d.length > 9) out += "-" + d.slice(9, 11);
  return out;
};
const tag = (el, text, tone = "") => {
  el.textContent = text;
  el.className = `tag ${tone}`.trim();
  el.hidden = !text;
};

function renderJourney(st, hasCpf) {
  $("couponBox").hidden = st.journey !== "CUPOM" || !st.coupon;
  $("couponCode").textContent = st.journey === "CUPOM" ? st.coupon || "" : "";
  $("cpfHint").hidden = true;
  if (st.journey === "CUPOM") {
    tag($("badge"), "Precisa de cupom", "pink");
    $("hint").textContent = st.coupon ? "Cole o cupom no carrinho antes de pagar." : "Cupom indisponível no momento.";
  } else if (st.journey === "CPF") {
    tag($("badge"), "Só comprar", "ok");
    $("hint").textContent = "Seu CPF é aplicado automaticamente. Compre normalmente.";
    $("cpfHint").hidden = hasCpf;
  } else {
    tag($("badge"), "Só comprar", "ok");
    $("hint").textContent = "Compre normalmente pelo link ativado: não precisa de cupom.";
  }
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [res, saved] = await Promise.all([send({ type: "status", url: tab?.url, tabId: tab?.id }), chrome.storage.local.get(["mode", "cpf"])]);
  const st = res || {};
  const hasCpf = Boolean(saved.cpf);

  $("pillText").textContent = st.loggedIn ? "Sessão ativa" : "Deslogado";
  $("pill").className = `tag ${st.loggedIn ? "ok" : "warn"}`;
  $("login").hidden = Boolean(st.loggedIn);

  document.querySelector(`input[name=mode][value=${saved.mode === "banner" ? "banner" : "auto"}]`).checked = true;
  $("cpf").value = fmtCpf(saved.cpf);

  $("info").textContent = `${st.count ?? 0} lojas · atualizado ${when(st.updated)}`;
  $("failed").hidden = !st.failed;
  $("failed").textContent = st.failed ? `carregando mais ${st.failed} lojas em segundo plano` : "";
  if (st.blockedUntil > Date.now()) {
    $("api").textContent = `API Livelo bloqueada até ${hm(st.blockedUntil)} — aguardando para não piorar o bloqueio`;
    $("refresh").disabled = true;
  } else if (st.stats) {
    const s = st.stats;
    $("api").textContent = `Última hora: ${s.ok || 0} ok · ${(s.e403 || 0) + (s.e429 || 0)} bloqueios · ${(s.e5xx || 0) + (s.net || 0) + (s.other || 0)} erros`;
    $("refresh").disabled = false;
  } else {
    $("api").textContent = "";
    $("refresh").disabled = false;
  }

  const partner = Boolean(st.partner);
  $("store").hidden = !partner;
  $("nostore").hidden = partner;
  if (partner) {
    $("storeName").textContent = st.partner;
    tag($("pts"), st.pts || "");
    renderJourney(st, hasCpf);
    tag($("why"), st.why ? label(st.why) : "", WHY_TONE[st.why] || "");
    $("page").hidden = !st.page;
    $("page").href = st.page || "";
    $("reactivate").hidden = st.why !== "cooldown";
    $("reactivate").onclick = async () => {
      await send({ type: "reactivate", host: st.host, url: tab?.url });
      render();
    };
    $("off").checked = !st.disabled;
    $("off").onchange = () => send({ type: "toggle", host: st.host });
  } else {
    $("noWhy").textContent = st.why ? label(st.why) : "";
    $("noWhy").hidden = !st.why;
  }
  return st;
}

document.querySelectorAll("input[name=mode]").forEach((r) => (r.onchange = () => chrome.storage.local.set({ mode: r.value })));
$("cpf").oninput = () => ($("cpf").value = fmtCpf($("cpf").value));
$("cpf").onchange = () => chrome.storage.local.set({ cpf: $("cpf").value });
$("login").onclick = () => send({ type: "login" });
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("couponCode").textContent);
  } catch {
    return;
  }
  $("copy").textContent = "Copiado";
  setTimeout(() => ($("copy").textContent = "Copiar"), 1500);
};
$("refresh").onclick = async () => {
  $("refresh").disabled = true;
  $("msg").textContent = "Atualizando…";
  const res = await send({ type: "refresh" });
  const st = await render();
  $("msg").textContent = res?.error === "blocked"
    ? `API Livelo bloqueada até ${hm(res.until)}. Tente depois.`
    : res?.error === "too_soon"
    ? "Lista atualizada há pouco. Tente em alguns minutos."
    : res?.error
    ? "Não foi possível atualizar a lista agora. Tente novamente em alguns minutos."
    : `Lista atualizada em ${when(st.updated)}` + (st.failed ? ` · ${st.failed} lojas ainda carregando` : "");
};
render();
