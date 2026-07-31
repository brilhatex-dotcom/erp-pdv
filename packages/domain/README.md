# @erp/domain

Núcleo de negócio. **Zero dependências de runtime** além de `@erp/utils` — regra
verificada no CI pelo `dependency-cruiser`.

## O que existe hoje (Etapas 1 e 2)

### `shared/`

| Módulo | Papel |
|---|---|
| `Result<T, E>` | Erro de negócio como valor. `throw` fica reservado a bug de programação |
| `DomainError` | Hierarquia de erros com **mensagem escrita para o operador**, não para o desenvolvedor |
| `ValueObject<T>` | Contrato de igualdade estrutural |
| `decimal` | Conversão texto → inteiro escalado, sem passar por ponto flutuante |
| `Identificador` | UUIDv7 — gerado no cliente (offline) e ordenável por tempo |
| `Entity` / `AggregateRoot` | Identidade e acúmulo de eventos até a transação confirmar |

### `valores/`

| Objeto | Representação interna | Por que importa |
|---|---|---|
| `Dinheiro` | `bigint` de **centavos** | `0.1 + 0.2 ≠ 0.3` em float; o erro se acumula até o fechamento de caixa |
| `Quantidade` | `bigint` de **milésimos** + unidade | 3 casas é o que a NF-e aceita em `qCom` e o que a balança produz |
| `UnidadeMedida` | registro com `fracionavel` | Meio quilo existe; meia caixa não |
| `CPF` | 11 dígitos validados | CPF inválido não consegue chegar ao XML fiscal |
| `CNPJ` | 14 caracteres validados | Aceita numérico **e alfanumérico** (emitido desde 2026) |

### `catalogo/`

| Objeto | Papel |
|---|---|
| `Produto` | Agregado: pesável/unitário, embalagens, referências, preço e custo |
| `CodigoBarras` | EAN-8/12/13 e DUN-14 com dígito verificador GS1 |
| `CodigoBalanca` | Lê a etiqueta da balança — peso ou preço embutido no EAN-13 |
| `Embalagem` | Conversão fardo → unidade, para entrada de mercadoria |
| `ReferenciaProduto` | Código de fabricante, original e similar — busca de autopeças |

### `estoque/`

| Objeto | Papel |
|---|---|
| `MovimentoEstoque` | Fato imutável. Quantidade sempre positiva; o **tipo** dá o sinal |
| `SaldoEstoque` | Projeção **comutativa** dos movimentos + custo médio ponderado móvel |
| `TipoMovimento` | Direção de cada tipo e quais afetam o custo médio |

### `vendas/`

| Objeto | Papel |
|---|---|
| `Venda` | Agregado central: itens, pagamentos, descontos, finalização e cancelamento |
| `VendaItem` | Preço e descrição **congelados** no instante da venda |
| `Pagamento` | Múltiplas formas na mesma venda, com parcelamento e NSU |
| `FormaPagamento` | Registro com `tPag` fiscal e classificação para o caixa |

### `caixa/`

| Objeto | Papel |
|---|---|
| `SessaoCaixa` | Abertura com fundo de troco, sangria, suprimento e fechamento com conferência |
| `MovimentoCaixa` | Sangria e suprimento — fatos imutáveis, com motivo obrigatório |

## Decisões que merecem atenção

**Rateio com resgate de sobra.** `Dinheiro.ratear(3)` sobre R$ 10,00 devolve
`[3,34 · 3,33 · 3,33]`, e a soma fecha exatamente. Arredondar cada parte
isoladamente perderia um centavo — e é por esse centavo que a SEFAZ rejeita nota
cuja soma dos itens não bate com o total.

**`ratearProporcional` usa o método do maior resto** e desempata pela ordem
original. Isso torna o rateio **determinístico**: reprocessar a mesma venda
produz o mesmo XML.

**Arredondamento é comercial (meio para cima), não bancário.** R$ 0,125 vira
R$ 0,13. Arredondamento bancário distorceria o total em relação ao que o cliente
lê no cupom.

**Formatação é manual, sem `Intl`.** A saída do `Intl` muda conforme a build de
ICU do runtime — inclusive o tipo de espaço depois de "R$". Cupom fiscal não pode
sair diferente conforme a máquina do cliente.

**O total da venda é exatamente a soma dos itens.** Parece óbvio, e é onde os
sistemas erram: um desconto dado na venda inteira precisa ser **rateado entre os
itens**, porque o documento fiscal exige valor por item. Se o rateio perder um
centavo, a SEFAZ rejeita a nota — com a venda já feita e o cliente fora da loja.
Há teste verificando que a soma dos itens fecha com o total.

**O fechamento nunca é bloqueado por divergência.** Impedir o fechamento deixaria
a loja com o caixa aberto e o operador sem saída — e a diferença continuaria
existindo de qualquer forma. A divergência é calculada, registrada e vira alerta na
retaguarda.

**A sessão acumula totais, não a lista de vendas.** Carregar 2.000 vendas para abrir
a gaveta quebraria a meta de resposta do PDV. O caixa só precisa dos totais por forma.

**Crediário conta como a receber, nunca como recebido.** `FormaPagamento` separa
três coisas: o que entra na gaveta (só dinheiro), o que gera conta a receber (só
crediário) e o que devolve troco (só dinheiro). Somar fiado como dinheiro faria o
caixa fechar com sobra inexistente, e o histórico ficaria irrecuperável.

**Vender fiado exige cliente identificado.** Sem isso é dinheiro que ninguém
consegue receber depois.

**Preço e descrição são congelados no item.** Referenciar o cadastro faria o
histórico mudar retroativamente quando o produto mudasse de preço.

**Saldo de estoque é projeção, não coluna.** `SaldoEstoque` soma movimentos, e a
soma é comutativa — há um teste que verifica as **120 permutações** de 5 movimentos e
exige o mesmo resultado. É essa propriedade que faz duas estações de PDV convergirem
sem trava distribuída (ADR-0007). Com saldo mutável, uma venda sobrescreveria a outra.

**Saldo negativo é permitido por padrão.** Acontece quando a venda é lançada antes da
entrada da nota de compra, o que é rotina em comércio de bairro. Recusar a venda por
atraso administrativo seria parar a loja — o oposto do princípio 1. Quem controla
estoque com rigor liga o bloqueio.

**Ajuste e perda exigem justificativa.** Ajuste sem motivo é a rota preferida de quem
desvia mercadoria; exigir texto torna o desvio rastreável.

**A unidade faz parte da `Quantidade`.** Somar 2 kg com 3 caixas devolve erro em
vez de um número sem sentido. Foi por não separar isso que sistemas de depósito
misturam palete com saco e o estoque nunca fecha.

## Testes

734 testes, **100% de cobertura por arquivo** (statements, branches, functions e lines).
O limiar é `perFile`, não média: média deixa um módulo mal coberto passar escondido
atrás dos bem cobertos.

```bash
pnpm --filter @erp/domain test:cov
```

## Próximo

O domínio da Fase 1 está completo. A próxima etapa sai de `@erp/domain`:
`@erp/application`, com as portas e os casos de uso que orquestram estes agregados.
