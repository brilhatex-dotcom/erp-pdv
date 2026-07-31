# ADR-0019 — Dinheiro e quantidade trafegam como texto inteiro no JSON

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Arquiteto · Dev Sênior · DBA PostgreSQL · Fiscal BR · QA |

## Contexto

O ADR-0009 fixou dinheiro como inteiro de centavos (`bigint`), e o schema do
banco o armazena em `int8`. A Etapa 6 criou `@erp/contracts` e precisou responder
como esse valor **atravessa o JSON**, o que é uma pergunta diferente — e a
resposta padrão de qualquer biblioteca é a errada.

Os fatos que restringem a escolha:

1. **`JSON.parse` produz `double`.** Não existe inteiro em JSON: todo número
   vira ponto flutuante de 64 bits. Um total de venda em centavos passa por um
   tipo que o ADR-0009 proíbe justamente para dinheiro.
2. **`JSON.stringify` recusa `bigint`.** Lança `TypeError`. Serializar exige
   conversão explícita de qualquer jeito — a pergunta é para **o que**.
3. **`double` é exato até 2^53.** Em centavos isso são ~90 trilhões de reais, e
   nenhum estabelecimento-alvo chega perto. O risco imediato de perda de
   precisão é, honestamente, **nulo** — e é importante reconhecer isso, porque a
   decisão não se justifica por ele.
4. **O que acontece de verdade é arredondamento no caminho.** Assim que um valor
   monetário é número em JavaScript, qualquer código no caminho pode somá-lo,
   dividi-lo ou multiplicá-lo por alíquota, e o resultado sai com casas que não
   existem em centavos. O defeito não aparece na serialização: aparece no
   fechamento de caixa, com um centavo de diferença que ninguém explica.
5. **A quantidade tem o mesmo problema**, em milésimos — e piora com pesáveis,
   onde a divisão é rotina.

## Decisão

**Valor monetário trafega como texto de inteiro em centavos; quantidade, como
texto de inteiro em milésimos.**

```json
{ "total": "1990", "quantidade": "1500" }
```

`"1990"` são dezenove reais e noventa centavos; `"1500"` são 1,5 unidades.

Três regras acompanham:

1. **Representação única por valor.** `"0199"` e `"-0"` são recusados na
   fronteira. Duas grafias do mesmo valor transformam comparação de texto em
   fonte de defeito, e comparação de texto acontece — em log, em teste e em chave
   de idempotência.
2. **A conversão é do contrato**, em `inteiroDeTexto` / `textoDeInteiro`. Cada
   camada convertendo por conta própria é como uma delas passa a usar
   `Number()`.
3. **Reais decimais não são aceitos.** `"19.90"` é recusado, não arredondado:
   quem manda reais onde se espera centavos tem um defeito, e aceitar o valor
   silenciosamente erra o preço por um fator de cem.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Número inteiro de centavos** (`1990`) | O mais simples, e o mais fácil de estragar: uma vez que é `number`, nada impede somar, dividir e devolver `1990.0000000001`. Nenhum teste pega isso, porque cada operação isolada parece certa |
| **String decimal em reais** (`"19.90"`) | Legível, e exige que **todo** consumidor faça o parse decimal certo. O primeiro que usar `parseFloat` reintroduz o ponto flutuante — e o cupom sai com um centavo de diferença |
| **Objeto `{ centavos: 1990, moeda: "BRL" }`** | Explícito, mas o produto opera em uma moeda só (§1.6). Carregar `moeda` em cada linha de cada venda é peso no fio e complexidade que ninguém paga — veto do Analista de Negócios |
| **`BigInt` com serializador customizado** | Exigiria `JSON.parse` com *reviver* em todos os clientes, incluindo os que ainda não existem (retaguarda, PDV, integrações de terceiros). Contrato que só funciona com o parser certo não é contrato |
| **Número em reais** (`19.9`) | Junta os dois piores: ponto flutuante e unidade ambígua |

## Consequências

**Positivas**

- Nenhum valor monetário existe como `number` em nenhum ponto do sistema — do
  `int8` no PostgreSQL ao `Dinheiro` do domínio ao texto no fio.
- Reais decimais e zeros à esquerda são recusados na fronteira, não corrigidos
  na calada.
- Um valor tem uma grafia só: comparar respostas em teste e em log é confiável.

**Negativas — o custo aceito**

- **A resposta da API não é legível por humano.** Ler `"1990"` exige saber que
  são centavos. Custa no diagnóstico manual e em qualquer exploração com `curl`.
- **Todo cliente converte.** Nenhum consumidor usa o valor direto; passa por
  `inteiroDeTexto` antes de qualquer cálculo.
- **Integração de terceiro estranha o formato.** É o preço de não aceitar que
  ela mande `19.90` e receba um centavo de diferença de volta.

**Neutras**

- Texto ocupa um pouco mais que número no corpo da resposta. Irrelevante na
  escala de uma venda de balcão.

## Como reverter

O formato está declarado em um lugar (`packages/contracts/src/comuns/escalares.ts`)
e é validado na fronteira, então trocá-lo é uma alteração local **no código**.
No contrato, não: clientes instalados já leem este formato, e mudá-lo é
incompatível — exige incremento MAIOR de versão (§13.3), com o processo de
aprovação e comunicado que ele impõe.

## Relacionados

- ADR-0009 — dinheiro em centavos (`bigint`)
- [ADR-0018](0018-fronteira-http-erro-traduzido-e-autenticacao-obrigatoria.md) — fronteira HTTP
