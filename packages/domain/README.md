# @erp/domain

Núcleo de negócio. **Zero dependências de runtime** além de `@erp/utils` — regra
verificada no CI pelo `dependency-cruiser`.

## O que existe hoje (Etapa 1)

### `shared/`

| Módulo | Papel |
|---|---|
| `Result<T, E>` | Erro de negócio como valor. `throw` fica reservado a bug de programação |
| `DomainError` | Hierarquia de erros com **mensagem escrita para o operador**, não para o desenvolvedor |
| `ValueObject<T>` | Contrato de igualdade estrutural |
| `decimal` | Conversão texto → inteiro escalado, sem passar por ponto flutuante |

### `valores/`

| Objeto | Representação interna | Por que importa |
|---|---|---|
| `Dinheiro` | `bigint` de **centavos** | `0.1 + 0.2 ≠ 0.3` em float; o erro se acumula até o fechamento de caixa |
| `Quantidade` | `bigint` de **milésimos** + unidade | 3 casas é o que a NF-e aceita em `qCom` e o que a balança produz |
| `UnidadeMedida` | registro com `fracionavel` | Meio quilo existe; meia caixa não |
| `CPF` | 11 dígitos validados | CPF inválido não consegue chegar ao XML fiscal |
| `CNPJ` | 14 caracteres validados | Aceita numérico **e alfanumérico** (emitido desde 2026) |

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

**A unidade faz parte da `Quantidade`.** Somar 2 kg com 3 caixas devolve erro em
vez de um número sem sentido. Foi por não separar isso que sistemas de depósito
misturam palete com saco e o estoque nunca fecha.

## Testes

255 testes, **100% de cobertura** (statements, branches, functions e lines).

```bash
pnpm --filter @erp/domain test:cov
```

## Próximo

Etapa 2 — `Entity`, `AggregateRoot` e `DomainEvent`, junto com o primeiro
agregado (`Produto`), que é quando essas bases passam a ter uso real.
