# ADR-0028 — Servidor da loja em HTTP puro: o que o navegador da estação não tem

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 18/10/2026 |
| **Decisores** | Arquiteto · Especialista em Segurança · UX · DevOps · QA · Analista de Negócios |

## Contexto

O servidor da loja entrega a tela e a API por **HTTP puro** na rede local
(ADR-0023): sem domínio, sem certificado, sem ninguém de TI para renová-lo. O
computador do servidor abre o sistema por `http://localhost:3000` — e o
navegador trata `localhost` como **contexto seguro**. O segundo caixa, e a
retaguarda aberta do escritório, abrem `http://NOME-DO-SERVIDOR:3000`, que **não
é**.

Em 18/10/2026, abrindo o sistema por um IP de rede no Chromium, apareceu o que
nenhum teste, nenhum CI e nenhuma instalação no próprio servidor tinham visto:

| O que o navegador faz numa origem HTTP que não é `localhost` | Efeito no sistema |
|---|---|
| **Não expõe `crypto.randomUUID()`** | O login estourava antes de sair a requisição, e a tela traduzia qualquer `TypeError` como "sem conexão com o servidor" — com o servidor de pé. A estação também quebrava ao montar o caixa. **Só o computador do servidor conseguia entrar.** |
| **Descarta em silêncio o cookie `Secure`** | O cookie de renovação não era guardado: a renovação respondia 401, o operador era derrubado ao fim dos 15 minutos do token, e o F5 perdia a sessão. O servidor marcava `Secure` por `NODE_ENV=production` — que o instalador grava — apesar de a loja falar HTTP. |
| **Não registra service worker** | Sem tela guardada para abrir com o servidor desligado. |
| **Não oferece "instalar como aplicativo"** | A PWA não vira programa na área de trabalho. |
| Não expõe `crypto.subtle` nem `navigator.clipboard` | Ainda não usados; armadilhas iguais às primeiras. |

Os dois primeiros eram **defeitos** e foram corrigidos. Os dois seguintes são
**limites** do desenho e precisam estar escritos.

## Decisão

1. **Código de navegador não usa API que só existe em contexto seguro.** Hoje:
   `crypto.randomUUID`, `crypto.subtle` e `navigator.clipboard`. A regra é
   mecânica — o lint de `apps/pdv`, `apps/web`, `@erp/cliente-api` e `@erp/ui`
   (`@erp/config/eslint-navegador`) reprova o acesso, com a mensagem do que usar
   no lugar (`crypto.getRandomValues`, `novoUuid`, `novoIdentificador`).
2. **O atributo `Secure` do cookie segue o protocolo da requisição**, e não o
   ambiente: liga quando a conexão chegou por HTTPS (inclusive atrás de proxy,
   por `X-Forwarded-Proto`), e desliga em HTTP. Numa conexão que já é em claro, o
   atributo não protege nada e só impede o cookie de existir.
3. **O segundo computador funciona online, por HTTP.** Entra, vende, fecha o
   caixa e renova a sessão como o do servidor. O que ele **não** tem é a tela
   guardada nem a instalação como aplicativo.
4. **A tela guardada e o Agente Local valem na máquina do servidor**, onde o
   endereço é `localhost`. Para os demais computadores, a contingência exige que
   o Agente esteja instalado na estação (ver "Consequências").
5. **HTTPS na rede da loja não é adotado agora** (alternativas abaixo).
6. **O teste no navegador cobre a segunda origem**: `apps/e2e` abre o sistema
   pelo IP da máquina e confere login, F5 e renovação (`estacao-na-rede.spec.ts`).

## Alternativas consideradas

| Alternativa | A favor | Contra | Situação |
|---|---|---|---|
| **HTTP puro, sem as APIs de contexto seguro** | Nada a instalar nem renovar; funciona hoje | 2º computador sem tela guardada nem "instalar"; tráfego da rede da loja em claro | **Aceita** |
| HTTPS com certificado autoassinado | Contexto seguro em todas as estações | Aviso de segurança do navegador em cada estação, em cada renovação; o lojista aprende a clicar "continuar assim mesmo" — o que treina o contrário do que se quer | Rejeitada |
| HTTPS com autoridade certificadora local, instalada em cada estação | Sem aviso | Instalar a CA com privilégio de administrador em **cada** estação, renovar, e refazer ao trocar de computador: custo de suporte multiplicado pela base instalada | Adiada |
| HTTPS com domínio público e certificado automático (DNS-01) | Certificado confiável | Exige domínio, internet e conta de DNS por loja; custo anual por cliente; loja sem internet fica sem certificado | Rejeitada |
| Marcar a origem como confiável no navegador da estação (`--unsafely-treat-insecure-origin-as-secure`) | Contexto seguro sem certificado | Configuração por estação; só vale no atalho que leva o parâmetro. Candidata natural para a casca de quiosque (ADR-0023), que já é nossa | Em aberto |

## Custo

Nenhum recorrente. O custo de **não** adotar HTTPS é de funcionalidade (o 2º
computador não tem tela guardada); o de adotá-lo seria de suporte por estação —
exatamente a variável que decide empate neste produto (`CLAUDE.md` §2). Revisitar
quando houver base instalada que meça quantas lojas têm mais de um caixa.

## Segurança

PIN, senha e token trafegam em claro na rede da loja. O ataque exige **estar na
rede local** — o mesmo modelo de ameaça que justifica o PIN de seis dígitos no
balcão (ADR-0011) —, e o cookie continua `httpOnly` e `sameSite=strict`. Cookie
`Secure` sobre HTTP puro seria só aparência de proteção, com o custo de a sessão
não existir.

## Consequências

- ✅ O 2º computador e a retaguarda aberta de fora do servidor entram, mantêm a
  sessão e renovam — antes, não entravam.
- ✅ A classe de defeito não volta sem o lint reprovar, nem sem o teste da segunda
  origem reprovar.
- ⚠️ A tela de um computador que não é o servidor não abre se o servidor estiver
  desligado e a página for recarregada. Com a página já aberta, segue a venda
  pela fila — **se o Agente Local estiver instalado ali**.
- ⚠️ O Agente Local ainda não é instalado nem iniciado pelo instalador, e a tela
  fala com ele por um segredo provisório (`apps/pdv/src/balcao.ts`). Enquanto
  isso, a impressão sai pelo navegador e, sem servidor, a venda para. Registrado
  em `ESTADO.md` §2.4.
- ⚠️ Antes de acrescentar `Notification`, `navigator.mediaDevices`, geolocalização
  ou qualquer API "só HTTPS", consultar a lista acima: o 2º caixa não a terá.
