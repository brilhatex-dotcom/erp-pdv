# ERP + PDV

Sistema ERP com PDV (Ponto de Venda) para pequenas empresas brasileiras.

**Status atual: fase de arquitetura.** Nenhuma implementação iniciada — por decisão
de projeto, a arquitetura é definida e aprovada antes da primeira linha de código.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | **Documento de arquitetura completo** — visão geral, topologia, monorepo, estrutura de pastas, tecnologias, padrões, segurança, autenticação, permissões, backup, sincronização, offline, atualização, impressão, emissão fiscal e crescimento futuro |
| `docs/adr/` | Registro de decisões arquiteturais (a criar) |
| `docs/fiscal/` | Notas técnicas, layouts e tabelas fiscais (a criar) |
| `docs/operacao/` | Instalação, backup e suporte (a criar) |

## Resumo da proposta

- **Local-first**: uma máquina hospeda o servidor; as estações acessam pela rede local.
  O PDV continua vendendo mesmo sem internet e mesmo sem o servidor.
- **Monorepo** (pnpm + Turborepo) com domínio de negócio isolado em pacote sem
  dependências, seguindo arquitetura hexagonal.
- **Fiscal desacoplado**: NFC-e, NF-e e SAT entram como adapters, com contingência
  automática e preparação para a Reforma Tributária (CBS/IBS/IS).
- **Sem reescrita para crescer**: trocar SQLite por PostgreSQL, adicionar multi-loja
  ou expor API mobile são trocas de adapter, não mudanças de núcleo.

## Próximo passo

Aprovação do documento de arquitetura. Os pontos que exigem decisão explícita estão
listados na seção *Próximos passos* de [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).
