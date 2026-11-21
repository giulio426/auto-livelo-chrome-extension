# Livelo Auto

Extensão Chrome/Edge (MV3) que ativa o link Livelo ao entrar em lojas parceiras.

## Instalar
1. `chrome://extensions` → Modo desenvolvedor → **Carregar sem compactação** → esta pasta.
2. Faça login em livelo.com.br no mesmo navegador (a extensão detecta o cookie `KEYCLOAK_IDENTITY`).
3. Clique no ícone da extensão e informe seu CPF (necessário para lojas com jornada CPF, como Mercado Livre).

## Uso
- Popup: modo automático ou banner, desativar loja atual, CPF, atualizar lista.
- Cooldown de 24h por loja. Não redireciona em carrinho, checkout ou login.
- Lojas com cupom (jornada CUPOM): copie o cupom pelo banner e aplique no checkout.
- Deslogado: o ícone mostra "!" e o banner pede login.

## Como o link é montado (igual ao site da Livelo)
1. Base: `partnerLink` do parceiro. Na jornada CPF, é o link devolvido por `promotion-link` (traz o ID de rastreio, ex. `matt_word` no Mercado Livre).
2. Parceiro com pixel: acrescenta `?<param>=<gtm_ga_ids>` (`xtra` no Magalu, `livelo_origem` quando o parceiro não define). O `gtm_ga_ids` é lido do localStorage da Livelo por `livelo.js`; **visite livelo.com.br ao menos uma vez** com a extensão ativa.
3. A tela de transição da Livelo é só visual (redireciona em ~2s) e é pulada.

## Catálogo e bloqueio da API
A Livelo bloqueia o IP (403 na API e em `static.livelo.com.br`, deixando o site em branco) quando recebe muitas requisições seguidas.
O catálogo é incremental: 1 requisição de lista, detalhes só de parceiros novos/alterados, 15 por minuto (jornada CPF primeiro).
Ao tomar 403, para e tenta de novo em 30 min. Evite recarregar a extensão em sequência.

## Limites
- O token da Livelo fica só em memória na página, então o CPF não é lido da conta; é digitado no popup.
- APIs `apis.pontoslivelo.com.br` não são documentadas e podem mudar.
- Pontos só são confirmados com compra real (até 40 dias).
- Não use junto com outras extensões de cashback.
