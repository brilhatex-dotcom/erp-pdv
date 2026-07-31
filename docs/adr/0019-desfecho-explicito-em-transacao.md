# ADR-0019 — Desfecho explícito em transação, para gravações que precisam sobreviver ao erro

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Arquiteto · Segurança · DBA PostgreSQL · QA |

## Contexto

O `UnitOfWork` (ADR-0006) tem um contrato simples e correto: **devolver `Result` de
erro desfaz a transação**. É o que garante a atomicidade da venda — estoque baixado
de venda que não existe é o defeito que ele existe para impedir.

Ao implementar a autenticação, esse contrato produziu um defeito grave e silencioso.

`Autenticar` fazia, dentro da transação:

```
usuario.registrarTentativaFalha(agora);
await repositorios.usuarios.salvar(usuario);
return err(credencialInvalida());   ← ROLLBACK: a gravação acima é desfeita
```

O contador de tentativas erradas **nunca era persistido**. Ele voltava a zero a cada
tentativa, jamais chegava à quinta, e o bloqueio progressivo — a única proteção contra
força bruta num PIN de seis dígitos — existia apenas no papel.

`RenovarSessao` tinha a mesma falha, com consequência pior: ao detectar reúso de
refresh token, ela revogava a família inteira e devolvia o erro que sinalizava o roubo.
O `ROLLBACK` desfazia a revogação. **O sistema detectava o token roubado e, no mesmo
instante, desfazia sua própria reação.**

Nenhum dos dois apareceu nos testes da camada de aplicação: o `UnitOfWork` em memória
guarda referências, não copia estado, e portanto não desfaz nada. Os dois só apareceram
nos testes de integração, contra PostgreSQL de verdade.

## Decisão

**Um caso de uso cuja gravação precisa sobreviver ao erro não devolve `err` de dentro
da transação.** Ele devolve um **desfecho** — união discriminada — e o erro é produzido
fora, depois do `COMMIT`:

```ts
type Desfecho =
  | { tipo: "AUTENTICADO"; saida: SaidaAutenticar }
  | { tipo: "CREDENCIAL_INVALIDA" }
  | { tipo: "RECUSADO"; erro: DomainError };

const desfecho = await unitOfWork.transacao(async (r) => ok(await this.#tentar(r, e)));
// a transação sempre confirma; o erro nasce aqui fora
```

O contrato do `UnitOfWork` **não muda**. Continua valendo que `err` desfaz — que é
exatamente o que a venda precisa. O que muda é o reconhecimento de que existem casos de
uso em que a falha do ponto de vista de quem chamou é, do ponto de vista do banco, uma
gravação bem-sucedida: registrar a tentativa, aplicar o bloqueio, revogar a família.

Para tornar a regressão visível, o `UnitOfWorkEmMemoria` passou a **contar** as
transações desfeitas, e os testes afirmam que essas gravações não estão sendo devolvidas
com `err`.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Segunda transação depois da que falhou** | Funciona, mas duas transações por login errado dobram o custo do caminho mais atacado do sistema — e o intervalo entre elas é uma janela real de concorrência |
| **`UnitOfWork` com "confirmar mesmo em erro"** | Enfraquece o contrato para todos os casos de uso, incluindo a venda. Um dia alguém liga a opção no lugar errado e o estoque baixa sem venda |
| **`SAVEPOINT` para o trecho que deve sobreviver** | Inverte a semântica do `SAVEPOINT`, que serve para desfazer parte e manter o resto. Aqui é o contrário, e o código ficaria enganoso |
| **Gravar fora da transação, direto no cliente** | Perde a atomicidade entre o contador e o evento de auditoria: o bloqueio poderia existir sem o registro que o explica |

## Consequências

**Positivas**

- O bloqueio progressivo e a revogação por reúso passaram a funcionar de verdade.
- O tipo `Desfecho` documenta, no próprio código, quais saídas gravam e quais não.
- O contrato do `UnitOfWork` permanece estrito para todo o resto.

**Negativas**

- Dois casos de uso ficaram mais longos: a tentativa vira método privado, e a tradução
  de desfecho para `Result` fica no método público.
- A distinção é sutil e não é verificável por ferramenta. Quem escrever um caso de uso
  novo com gravação-que-deve-sobreviver precisa conhecer este ADR — está referenciado
  no comentário dos dois arquivos.

## Como reverter

Não há o que reverter isoladamente: voltar ao `err` de dentro da transação reintroduz
o defeito. Se um dia o `UnitOfWork` ganhar semântica de "confirmar parcialmente", este
ADR é revisto por um novo.

## Relacionados

- ADR-0006 — emissão fiscal assíncrona via Outbox, que define o `UnitOfWork`
- ADR-0011 — PIN no PDV, senha + 2FA na retaguarda
- `docs/ARQUITETURA.md` §8.2 — rotação de refresh com detecção de reúso
