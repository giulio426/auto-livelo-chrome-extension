# Chrome Web Store – ficha de cadastro (Livelo Auto)

Tudo abaixo está pronto para colar no painel: https://chrome.google.com/webstore/devconsole

## 1. Pacote
- Arquivo: `dist/livelo-auto-0.1.0.zip` (gerado a partir de `manifest.json`, `background.js`, `banner.js`, `livelo.js`, `popup.html`, `popup.js`, `seed.json`, `icons/`).
- Versão no manifest: `0.1.0`. Para cada novo envio, aumente `version` antes de gerar o zip.
- Não inclua `test/`, `tools/`, `.impeccable/`, `docs/`, `store/` nem `.git`.

## 2. Taxa e conta
- Taxa única de US$ 5 na primeira vez (conta de desenvolvedor).
- Confirme o e-mail de contato da conta; ele aparece para os usuários.

## 3. Aba "Loja" (Store listing)

**Nome** (máx. 75 caracteres):
```
Livelo Auto
```

**Resumo curto** (máx. 132 caracteres):
```
Ativa o link Livelo automaticamente ao entrar em lojas parceiras para você acumular pontos.
```

**Descrição detalhada** (cole como texto puro):
```
O Livelo Auto ativa o link de pontos da Livelo sempre que você entra em uma loja parceira. Assim, a compra soma pontos sem você precisar voltar ao site da Livelo.

Como funciona:
- Ao abrir uma loja parceira, a extensão verifica se ela está no catálogo da Livelo e prepara o link de pontos.
- Um banner aparece na página confirmando a ativação e os pontos estimados.
- Em lojas com jornada por CPF (como o Mercado Livre), o link é gerado com o seu CPF, informado no popup.
- Em lojas com cupom, o banner permite copiar o cupom para aplicar no checkout.

Recursos:
- Modo automático ou banner manual.
- Desative a ativação em lojas específicas.
- Não redireciona em carrinho, checkout ou tela de login.
- Limite de uma ativação a cada 24 horas por loja.

Privacidade:
- Não há servidor do desenvolvedor, analytics nem anúncios.
- Dados ficam no seu navegador. O CPF é enviado somente à API da Livelo, para gerar o link.
- Política completa: https://giulio426.github.io/auto-livelo-chrome-extension/privacy.html

Requisitos:
- Ter conta no livelo.com.br, logada no mesmo navegador.
- Visitar livelo.com.br ao menos uma vez com a extensão ativa.

Aviso: projeto independente, não afiliado nem patrocinado pela Livelo.
```

**Categoria:** Produtividade (ou Compras, se disponível e preferir).
**Idioma:** Português (Brasil).

**Ícone:** `icons/128.png` (já no pacote).

**Capturas de tela:** prontas em `store/screenshots/` (1280×800):
1. `01-popup.png`: popup com status, modo e CPF de exemplo (123.456.789-09).
2. `02-banner.png`: banner de ativação sobre uma página de exemplo ("Loja Exemplo").

Foram geradas a partir do código real da extensão (`popup.html`, `popup.js`, `banner.js`) com dados de exemplo, não em uma loja real. Se preferir capturas de uma loja parceira real, troque os arquivos.

**Imagem promocional pequena** (opcional): 440×280.

**Site:** `https://github.com/giulio426/auto-livelo-chrome-extension`

## 4. Aba "Privacidade" (Privacy practices)

**Política de privacidade (URL):**
```
https://giulio426.github.io/auto-livelo-chrome-extension/privacy.html
```
> Só funciona depois de ativar o GitHub Pages: Settings → Pages → Source: branch `main`, pasta `/docs`. O repositório precisa ser público (ou o Pages privado).

**Finalidade única (Single purpose):**
```
Ativar automaticamente o link de pontos da Livelo ao entrar em lojas parceiras.
```

**Tipos de dados coletados** (marque apenas este):
- [x] Informações de identificação pessoal: CPF, enviado à API da Livelo para gerar o link personalizado.

Desmarque os demais (web history, atividade do usuário, autenticação etc.): URLs e cookies são processados só localmente, sem sair do dispositivo.

**Certificações (marque as três):**
- [x] Não vendo nem transfiro dados do usuário a terceiros, exceto nos casos de uso aprovados.
- [x] Não uso nem transfiro dados para fins não relacionados à finalidade única.
- [x] Não uso nem transfiro dados para determinar elegibilidade a crédito ou empréstimo.

## 5. Justificativas de permissões (campo obrigatório)

Use estes textos em inglês, no campo de justificativa de cada permissão:

- **storage**
  `Stores the user's preferences (mode, disabled stores, CPF), a local catalog of partner stores, and cached links, all on the device.`
- **alarms**
  `Schedules the periodic refresh of the Livelo partner catalog and a retry after a temporary block by the server.`
- **webNavigation**
  `Detects when the user navigates to a partner store so the Livelo link can be activated at the right moment. Read-only.`
- **webRequest**
  `Observes main-frame navigation URLs only, to confirm that the Livelo link was requested. The extension does not block or modify any request.`
- **scripting**
  `Injects the activation banner into partner store pages, so the user can see the Livelo link is active.`
- **cookies**
  `Checks only whether the Livelo login session cookie exists, to show if the user is logged in to livelo.com.br. Cookie values are not read for use or sent anywhere.`
- **Host permission https://*/***
  `Partner stores are many and change often, so the extension needs to run on any HTTPS site. It only acts on sites listed in the Livelo partner catalog; on other sites it does nothing.`

**Uso remoto de código:** Não. Todo o código está no pacote.

## 6. Antes de enviar (checklist)
- [ ] `dist/livelo-auto-0.1.0.zip` gerado e testado com "Carregar sem compactação" em um perfil limpo.
- [ ] Página de privacidade publicada (GitHub Pages ativo, URL abrindo).
- [ ] Capturas de tela tiradas.
- [ ] Descrições coladas e revisadas (ortografia).
- [ ] Justificativas de permissões preenchidas.
- [ ] Aba Privacidade preenchida e certificações marcadas.
- [ ] Visibilidade: **Não listado** para liberar só por link, ou **Público** para aparecer na busca.
- [ ] Enviar para revisão.

## 7. Riscos de rejeição
- **Permissões amplas** (`https://*/*`, `webRequest`, `cookies`): pode gerar revisão manual mais longa. As justificativas acima cobrem isso.
- **Uso de marca "Livelo":** o aviso de não afiliação e o nome descritivo reduzem o risco de confusão. Se a revisão pedir, troque o nome para algo como "Auto Livelo Pontos (não oficial)".
- **Dados sensíveis (CPF):** a política precisa estar acessível sem login e bater com o que a extensão faz. Não altere o comportamento sem atualizar a política.
