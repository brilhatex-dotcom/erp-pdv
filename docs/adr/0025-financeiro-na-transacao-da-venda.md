# ADR-0025 — A conta a receber nasce na transação da venda

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 02/08/2026 |
| **Decisores** | Responsável pelo produto · Arquiteto · DBA PostgreSQL · Analista de Negócios |

## Contexto

O `FinalizarVenda` fecha a venda e propaga as consequências. Até aqui, três
delas aconteciam **dentro da transação** — baixa de estoque, crédito no caixa e
gravação da venda — e uma acontecia **fora**, pela outbox: a emissão fiscal
(ADR-0006).

O código trazia um comentário explícito dizendo que a conta a receber ficaria
com quem reage ao evento `VendaFinalizada`. Ele foi escrito quando o módulo
financeiro não existia, e a afirmação nunca foi exercida: `valorAReceber` era
calculado, publicado e ignorado.

Com o financeiro entrando (módulo 12), a pergunta precisou de resposta: o título
do crediário nasce **junto** com a venda, ou depois, reagindo ao evento?

## Decisão

**O título nasce na mesma transação da venda.** `FinalizarVenda` chama
`gerarTitulosDaVenda` antes de gravar, e um erro ali desfaz a venda inteira.

O comentário que dizia o contrário foi corrigido no mesmo commit.

## Por quê

**O fiscal é assíncrono por um motivo que o financeiro não tem.** A emissão
depende de rede externa, de um provedor e da SEFAZ; bloquear a venda esperando
qualquer um deles violaria o princípio 1 — o PDV nunca para. O financeiro é
local: mesmo banco, mesma transação, sem rede no caminho.

**Venda sem título é perda de dinheiro direta.** Se a venda gravasse e o título
não, o lojista teria entregado mercadoria sem registro da dívida. É exatamente o
defeito que o produto existe para corrigir: `docs/ANALISE-SEGMENTOS.md` §3.3
descreve o fiado em papel como "onde o dono mais perde dinheiro", e chama o
controle de crediário de um dos argumentos de venda mais fortes do produto.

**É a mesma regra que estoque e caixa já seguem.** Nenhum dos dois passa pela
outbox, e pelo mesmo motivo: meio caminho produz estoque baixado de venda que
não existe, ou dinheiro no caixa sem venda correspondente. Fiado sem venda é o
terceiro membro dessa família.

**A entrega eventual não seria de graça.** Reagir ao evento exigiria um
consumidor rodando, monitoramento de fila parada e um caminho de reprocessamento
— tudo para um efeito que acontece no mesmo banco, em micros­segundos. O papel do
DevOps rejeitou o custo operacional; o do Arquiteto observou que assincronismo
sem fronteira de rede é complexidade sem contrapartida.

## Consequências

- `FinalizarVenda` passa a depender de `TituloRepository`. A dependência é da
  aplicação para a aplicação, dentro da mesma camada — o grafo continua válido.
- `SaidaFinalizarVenda` ganha `titulos`, para o PDV mostrar o vencimento ao
  cliente no fim da venda.
- Cliente apagado do cadastro entre o início e o fechamento da venda **derruba a
  venda inteira**, em vez de gravar meia operação. O título grava o nome do
  cliente, e o nome vem do cadastro.
- `gerarTitulosDaVenda` é função, não classe: roda dentro da transação que já
  está aberta. Uma classe com `UnitOfWork` próprio abriria uma segunda transação
  e devolveria o problema que esta decisão resolve.

## Alternativas consideradas

**Reagir a `VendaFinalizada` pela outbox.** Rejeitada: introduz uma janela em
que a venda existe e a dívida não, para ganhar um desacoplamento que não paga
por si — não há fronteira de rede entre a venda e o título.

**Gerar o título fora da transação, logo depois.** Rejeitada pelo mesmo motivo,
com o agravante de esconder a janela: o código pareceria síncrono e não seria.

## O que esta decisão **não** diz

Ela não move o fiscal para dentro da transação. O ADR-0006 continua valendo, e
pelo motivo que sempre valeu: dependência de rede externa.

Ela também não decide o que acontece com os títulos quando a **venda é
cancelada**. Não existe caso de uso de cancelar venda — o domínio tem
`Venda.cancelar` e nada o chama. Quando existir, ele precisa alcançar os títulos
que a venda criou, senão a dívida sobrevive à venda e o cliente é cobrado por
mercadoria devolvida. Registrado em `ESTADO.md` §2.4.
