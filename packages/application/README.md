# @erp/application

Casos de uso e **portas**. Orquestra o domínio sem conhecer infraestrutura —
regra verificada no CI: este pacote não pode importar `@erp/database`,
`@erp/fiscal`, `@erp/printing` nem `@erp/ui`.

## Portas

| Porta | Papel |
|---|---|
| `Relogio` | Tempo injetado. Teste determinístico, e a hora vem do servidor — a da estação não é confiável |
| `GeradorId` | UUIDv7. O domínio só expõe a função pura; entropia e relógio são infraestrutura |
| `UnitOfWork` | Executa um trabalho numa transação. Erro devolvido **desfaz tudo** |
| `ProdutoRepository` | Busca por barras, SKU, referência ou código de balança |
| `VendaRepository`, `EstoqueRepository`, `CaixaRepository` | Coleções de agregados |
| `OutboxRepository` | Fila de eventos, gravada na mesma transação do dado |

Repositórios falam de **negócio**, não de banco. Não há `Repository<T>` genérico:
`porCodigoDeBarras` diz o que o PDV precisa, `findOne` não diz nada.

## Casos de uso

| Caso de uso | O que faz |
|---|---|
| `IniciarVenda` | Abre a venda. Exige caixa aberto |
| `AdicionarItemPorCodigo` | O caminho mais percorrido: trata etiqueta de balança e código comum |
| `RegistrarPagamento` | Devolve `faltaPagar` e `troco` junto, que é o que a tela mostra em seguida |
| `FinalizarVenda` | Venda + estoque + caixa + outbox, **numa transação só** |

### O que `FinalizarVenda` não faz

Não emite documento fiscal, não imprime e não gera conta a receber. Publica
`VendaFinalizada` e quem precisa reage. É isso que permite o módulo fiscal ser
opcional (ADR-0016) **sem um único `if` aqui dentro**.

## Dublês em memória

`src/testes/dubles.ts` implementa todas as portas em memória. Não é só
conveniência de teste: é a prova prática de que a arquitetura hexagonal funciona —
o fluxo inteiro do balcão roda sem banco, sem rede e sem impressora, e a suíte
leva menos de um segundo.

## Testes

38 testes, 100% de linhas por arquivo. O teste central percorre o fluxo completo:
bipar, pagar, fechar — e verifica que estoque, caixa e outbox foram todos
atualizados.

Guardas comprovadamente inalcançáveis são marcadas com `/* v8 ignore next */` e
uma justificativa, para que a afirmação apareça no diff em vez de ficar escondida
num limiar afrouxado.

```bash
pnpm --filter @erp/application test:cov
```
