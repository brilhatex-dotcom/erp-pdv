# ADR-0017 — Chaves naturais nas tabelas filhas e trava explícita na projeção de saldo

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Arquiteto · DBA PostgreSQL · Dev Sênior · QA |

## Contexto

A implementação de `@erp/database` trouxe duas decisões que o desenho anterior deixava
em aberto, e ambas apareceram como defeito antes de aparecer como escolha.

### 1. Identidade das linhas filhas

As tabelas `referencias_produto`, `embalagens`, `venda_itens` e `pagamentos` existem
**apenas dentro** de um agregado. Elas não são consultadas por identidade própria, não
são referenciadas de fora e não sobrevivem ao pai.

A primeira implementação deu a cada uma um `id` UUID, seguindo o ADR-0008 por hábito.
Isso criou um problema imediato: o repositório regrava a coleção inteira a cada
`salvar`, e um UUID novo a cada regravação faria a tabela crescer sem limite. A
tentativa de contornar — derivar o UUID do pai fatiando a string — produziu um valor
que **não é um UUID válido**, e que quebraria assim que alguém confiasse no formato.

### 2. Atualização da projeção de saldo

`saldos_estoque` é projeção derivada de `movimentos_estoque` (ADR-0007). Atualizá-la
exige **ler o saldo, calcular no domínio e gravar** — porque o custo médio ponderado é
regra de negócio, e escrevê-la em SQL a duplicaria fora do domínio.

Ler-calcular-gravar sob `READ COMMITTED`, que é o padrão do PostgreSQL, é um
*lost update*: duas estações vendendo o mesmo produto leem o mesmo saldo, e a segunda
gravação sobrescreve a primeira. A loja perde estoque sem que nada acuse erro.

## Decisão

### 1. Chave natural, não UUID, nas tabelas filhas

| Tabela | Chave primária |
|---|---|
| `referencias_produto` | `(produto_id, tipo, normalizado)` |
| `embalagens` | `(produto_id, unidade)` |
| `venda_itens` | `(venda_id, numero)` |
| `pagamentos` | `(venda_id, ordem)` |

Cada uma dessas chaves **já era única por regra de negócio** — o domínio recusa
referência duplicada e embalagem com unidade repetida, e o número do item é sequencial
dentro da venda. Declará-la como chave primária faz o banco garantir o que o domínio
já garante, e elimina a pergunta "que id dar a esta linha ao regravar".

O ADR-0008 (UUIDv7 gerado no cliente) continua valendo integralmente para **agregados**:
`produtos`, `vendas`, `sessoes_caixa`, `movimentos_estoque`, `movimentos_caixa` e
`eventos_outbox`. A razão do UUIDv7 é permitir criar o registro offline, sem consultar
o banco; linha filha não é criada isoladamente, então a razão não se aplica a ela.

### 2. `SELECT ... FOR UPDATE` antes de projetar o saldo

`EstoqueRepositorioPrisma.registrar` trava a linha de `saldos_estoque` do produto antes
de ler. A trava dura o que dura a transação da venda — milissegundos — e vale **por
produto**, não por tabela: duas vendas de produtos diferentes não se esperam.

No primeiro movimento de um produto não há linha para travar. Nesse caso a chave
primária resolve: uma das transações concorrentes falha por chave duplicada e é
repetida, em vez de sobrescrever silenciosamente.

O fato permanece íntegro em qualquer cenário — `movimentos_estoque` é append-only, e a
projeção pode ser reconstruída inteira a partir dele.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **UUID nas filhas + cálculo de diferença ao salvar** | Resolve o crescimento, mas move a complexidade para a lógica de *diff* — que é exatamente onde este tipo de código erra, e o erro se manifesta como item de venda perdido |
| **`UPDATE saldos SET milesimos = milesimos + ?`** | Atômico e sem trava, mas o custo médio ponderado não é expressável assim. Escrevê-lo em SQL duplicaria regra de negócio fora do domínio — veto do Dev Sênior |
| **`SERIALIZABLE` na transação da venda** | Correto, porém troca uma trava por produto por aborto de transação sob concorrência, e o PDV passaria a exibir erro ao operador em vez de esperar 3 ms |
| **Não materializar o saldo** | Somar os movimentos a cada bipada não cabe nos 100 ms do RNF-02 assim que a loja acumula histórico |

## Consequências

**Positivas**

- Regravar um produto ou uma venda é idempotente por construção.
- O banco recusa referência e embalagem duplicadas mesmo que o domínio seja contornado.
- A projeção de saldo é correta sob concorrência, e o teste que a exercita roda contra
  PostgreSQL de verdade.

**Negativas**

- Alterar o valor de uma referência é `DELETE` + `INSERT`, não `UPDATE`. Aceitável: o
  repositório já regrava a coleção inteira.
- A trava serializa vendas **do mesmo produto** na mesma transação. Em um balcão com
  três caixas, o custo é desprezível; em um cenário de centenas de estações
  concorrentes o desenho precisaria mudar — e esse cenário está fora do produto.

## Relacionados

- ADR-0007 — estoque como eventos comutativos
- ADR-0008 — UUIDv7 gerado no cliente
- [ADR-0013](0013-postgresql-unico-embarcado.md) — PostgreSQL único embarcado
- ADR-0012 — migrações no padrão expand-contract, que estas seguem
