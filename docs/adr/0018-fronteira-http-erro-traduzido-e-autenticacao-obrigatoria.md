# ADR-0018 — Fronteira HTTP traduz erro e nenhuma rota de negócio existe sem autenticação

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Arquiteto · Dev Sênior · Segurança · UX/UI · DevOps · QA |

## Contexto

O servidor HTTP é a primeira camada do sistema que fala com o mundo, e duas
perguntas precisavam de resposta antes de qualquer rota existir.

### 1. O que o cliente vê quando algo dá errado

O domínio devolve erro como valor (`Result` com `DomainError`), e cada
`DomainError` traz três coisas: um `codigo` estável, um `tipo` (categoria) e uma
`mensagem` **escrita para o operador de caixa**. Também traz `detalhes`, que
carregam id de venda, código de barras, valor — contexto de diagnóstico.

O comportamento padrão do Fastify, quando uma rota lança, é responder com
`error.message`. Essa mensagem é escrita para desenvolvedor: vem em inglês, cita
coluna de tabela e ocasionalmente traz fragmento de SQL. Exibi-la ao operador é
proibido pelo CLAUDE.md §9; mostrá-la a quem sonda a API entrega o desenho
interno do sistema (ARQUITETURA.md §7.1).

Havia ainda um desalinhamento concreto entre domínio e protocolo:
`ErroInfraestrutura` — banco fora, transação abortada — se declara como
`CONFLITO`, porque o domínio não tem categoria melhor e **não deve** ter conceito
de indisponibilidade. Traduzido literalmente, banco fora responderia **409**, e o
PDV pediria ao operador para corrigir algo que está correto.

### 2. Quando a autenticação entra

A camada de aplicação já tem o fluxo de venda completo e testado contra
PostgreSQL. É tentador expor as rotas de venda e produto imediatamente — o
trabalho está pronto, e a etapa seguinte ficaria menor.

O ARQUITETURA.md §9.5 diz que a autorização é aplicada **sempre no servidor**, e
o CLAUDE.md §9 proíbe confiar em validação apenas no cliente. Mas nem
autenticação nem papéis existem ainda. Expor as rotas agora significaria, na
prática, uma API de escrita aberta a qualquer estação da rede da loja — a mesma
rede do Wi-Fi que o público usa em boa parte dos segmentos-alvo (§7.1).

## Decisão

**1. A tradução de erro é única e centralizada.** Todo erro sai da API no mesmo
envelope (`@erp/contracts`), com `codigo`, `tipo`, `mensagem` e `correlacao` — e
**nada mais**. `detalhes` nunca trafegam: vão para o log do servidor, ligados à
mesma correlação que o cliente recebeu. O mapa categoria → status é um só, com
duas escolhas explícitas:

| Categoria | Status | Por quê |
|---|---|---|
| `VALIDACAO` | 400 | O pedido está malformado — defeito do cliente |
| `NAO_AUTORIZADO` | 403 | Autenticado, sem permissão |
| `NAO_ENCONTRADO` | 404 | — |
| `CONFLITO` | 409 | Estado incompatível que o cliente pode resolver |
| `REGRA_NEGOCIO` | **422** | A API entendeu e a **regra** recusou |
| `INDISPONIVEL` | 503 | Dependência fora; repetir resolve |

`400` × `422` é a distinção que mais importa: ela separa "bug de software" de
"mensagem para o operador", e é por ela que o PDV decide entre exibir o texto e
registrar um defeito. Falha inesperada responde **500** com categoria
`INDISPONIVEL` — a categoria diz o que fazer, o status diz o que aconteceu.

**2. `INDISPONIVEL` existe só no fio.** É a sexta categoria do contrato, e a
tradução de `ErroInfraestrutura` para ela acontece na fronteira. O domínio
continua sem conhecer indisponibilidade.

**3. Nenhuma rota de negócio antes da autenticação.** A Etapa 6 entrega a
fundação HTTP — configuração validada, composição, correlação, tradução de erro,
limite de requisições, encerramento gracioso — e **apenas** `/saude` e `/pronto`.
As rotas de venda, produto, estoque e caixa entram na etapa da autenticação, já
protegidas. Não existe rota de negócio "temporariamente aberta".

**4. `/saude` e `/pronto` são públicas, por decisão.** Quem as consulta — o
serviço do Windows, o instalador, o monitor de rede, o PDV decidindo entrar em
contingência — não está em condição de fazer login. Em troca, elas não revelam
nada além de versão, hora do servidor, tempo no ar e o veredito das
verificações. E `/saude` **não toca o banco**: se tocasse, uma indisponibilidade
momentânea do PostgreSQL faria o supervisor de serviço reiniciar um processo
saudável, trocando um problema que se resolve sozinho por loja parada.

**5. O endereço de escuta padrão é `127.0.0.1`.** Atender as estações da loja é
decisão consciente de quem instala, não consequência de esquecer uma variável.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Deixar o Fastify formatar os erros** | Devolve `error.message` ao cliente: texto de desenvolvedor na tela do caixa e desenho interno para quem sonda a API |
| **Cada rota escolhe o status** | "Estoque insuficiente" voltaria 400 numa rota e 409 noutra, e o PDV teria de tratar as duas. Consistência de fronteira não sobrevive à revisão de código |
| **Colapsar 422 em 400** | Apaga a distinção entre recusa de negócio e pedido malformado — que é o sinal usado pelo cliente para decidir se mostra a mensagem ou registra defeito |
| **Traduzir `ErroInfraestrutura` como 409** | Literal e errado: faria o operador tentar corrigir um pedido correto enquanto o banco está fora |
| **Acrescentar `INDISPONIVEL` ao `TipoErro` do domínio** | Indisponibilidade é assunto de infraestrutura. O domínio passaria a conhecer um conceito que ele não pode observar |
| **Expor as rotas de venda agora, protegendo depois** | API de escrita aberta na rede da loja. Além do risco imediato, "protegendo depois" é a promessa que a próxima urgência adia — veto do papel 5 |
| **Autenticar `/saude` e `/pronto`** | O supervisor de serviço e o instalador não têm credencial. O efeito prático seria ninguém monitorar nada |
| **Escutar `0.0.0.0` por padrão** | Torna a exposição na rede o comportamento de quem esqueceu de configurar |

## Consequências

**Positivas**

- Um formato de erro em toda a API; o cliente trata uma forma, não três.
- Detalhe técnico só existe no log, ligado à correlação que o operador informa.
- Erro interno nunca vaza mensagem de exceção, em nenhuma rota, por construção.
- Nenhuma rota de negócio jamais existiu sem autorização — não há janela a fechar.

**Negativas — o custo aceito**

- A Etapa 6 entrega um servidor que responde apenas saúde e prontidão. O fluxo
  de venda continua alcançável só por teste de integração até a etapa seguinte.
- O mapa de tradução (`tipoNoFio`, `statusHttp`, `corpoDeErro`) é exercitado
  hoje somente pelos seus testes: quem o consome são as rotas da próxima etapa.
  Aceito de propósito — é o contrato da fronteira, e definí-lo antes da primeira
  rota é o que impede cada rota de inventar o seu.
- Mensagem genérica para 400 significa que o cliente não recebe o campo que
  falhou. Foi escolha de segurança sobre conveniência; se a retaguarda precisar
  do detalhe de formulário, ele será acrescentado como campo estruturado do
  contrato, não como texto de exceção.

**Neutras**

- `INDISPONIVEL` no contrato e ausente no domínio exige a tradução explícita da
  fronteira, que é onde ela pertence.

## Como reverter

A tradução é um módulo de apresentação, sem estado: trocar o mapa de status é
uma alteração local com teste que a cobre. A decisão de não expor rota sem
autenticação, ao contrário, só se reverte por ADR novo — e teria de explicar como
o produto atenderia §9.5 sem ela.

## Relacionados

- ADR-0006 — emissão fiscal assíncrona via Outbox
- ADR-0011 — PIN no PDV, senha + 2FA na retaguarda (autenticação da etapa seguinte)
- [ADR-0019](0019-dinheiro-como-texto-inteiro-no-json.md) — dinheiro como texto inteiro no JSON
