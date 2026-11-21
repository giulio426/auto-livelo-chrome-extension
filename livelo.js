// Content script em livelo.com.br: espelha o gtm_ga_ids (ID do Google Analytics da Livelo) para o service worker,
// que o acrescenta ao link do parceiro como o próprio site faz. Só lê, não altera a página.
const save = () => {
  const ids = localStorage.getItem("gtm_ga_ids");
  if (ids) chrome.storage.local.set({ gaIds: ids });
};
save();
setTimeout(save, 4000); // o GTM pode gravar o valor depois do carregamento
