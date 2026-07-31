# Registro de Decisões Arquiteturais (ADR)

Um ADR registra **por que** uma decisão foi tomada — não o que foi feito. O código
mostra o que foi feito; só o ADR preserva as alternativas descartadas e o motivo.

## Regras

1. **ADRs são imutáveis.** Uma decisão revista **não** é editada: cria-se um ADR novo
   que a supersede, e o antigo é marcado como `Superseado por ADR-XXXX`. Preservar o
   raciocínio antigo evita reabrir a mesma discussão daqui a um ano.
2. **Numeração sequencial**, nunca reaproveitada.
3. **Um ADR por decisão.** Se o título precisa de "e", provavelmente são duas.
4. Toda decisão que altere `docs/ARQUITETURA.md` exige ADR (`CLAUDE.md` §3, etapa 9).

## Índice

| ADR | Decisão | Status |
|---|---|---|
| [0001](0001-topologia-local-first.md) | Servidor local com contingência no cliente | Aceito |
| 0002 | SQLite como banco padrão | ❌ **Superseado por [0013](0013-postgresql-unico-embarcado.md)** |
| 0003 | Monorepo com pnpm + Turborepo | Aceito |
| 0004 | Arquitetura hexagonal com domínio puro | Aceito |
| 0005 | Electron no PDV, web na retaguarda | Aceito |
| 0006 | Emissão fiscal assíncrona via Outbox | Aceito |
| 0007 | Estoque como eventos comutativos | Aceito |
| 0008 | UUIDv7 como identificador | Aceito |
| 0009 | Dinheiro em centavos (`bigint`) | Aceito |
| 0010 | Domínio nomeado em português | Aceito |
| 0011 | PIN no PDV, senha + 2FA na retaguarda | Aceito |
| 0012 | Migrações no padrão expand-contract | Aceito |
| [0013](0013-postgresql-unico-embarcado.md) | PostgreSQL único embarcado no instalador | Aceito |
| [0014](0014-escopo-varejo-apenas.md) | Escopo restrito a varejo; serviços fora do produto | Aceito |
| [0015](0015-emissao-fiscal-via-provedor-externo.md) | Emissão fiscal via provedor externo, atrás de abstração própria | Aceito |
| [0016](0016-modulo-fiscal-opcional-por-empresa.md) | Módulo fiscal opcional, habilitado por empresa | Aceito |
| [0017](0017-persistencia-chaves-naturais-e-projecao-travada.md) | Chave natural nas tabelas filhas; trava explícita na projeção de saldo | Aceito |
| [0018](0018-um-papel-por-usuario.md) | Um papel por usuário, com papéis personalizáveis | Aceito |

> Os ADRs 0001 a 0012 estão descritos em `docs/ARQUITETURA.md` §18 e serão extraídos
> para arquivos próprios conforme cada área for implementada. Os que já têm arquivo
> são os que exigiram análise de alternativas nesta fase.

## Modelo

```markdown
# ADR-XXXX — Título curto e afirmativo

| Campo | Valor |
|---|---|
| Status | Proposto \| Aceito \| Superseado por ADR-YYYY |
| Data | DD/MM/AAAA |
| Decisores | papéis do comitê (CLAUDE.md §1) envolvidos |

## Contexto
O que forçou a decisão. Fatos e restrições, sem opinião.

## Decisão
O que foi decidido, em uma frase afirmativa.

## Alternativas consideradas
Cada uma com o motivo real da rejeição.

## Consequências
### Positivas
### Negativas — o custo aceito, declarado honestamente
### Neutras

## Como reverter
O que precisaria acontecer para esta decisão ser revista.
```
