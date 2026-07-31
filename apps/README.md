# apps/

Aplicações executáveis. Cada uma é **composição** — junta pacotes e adapters —
e não contém regra de negócio nova (`CLAUDE.md` §9).

| Aplicação | Descrição | Etapa do roadmap |
|---|---|---|
| `server/` | API + jobs (Fastify) — **fundação entregue**; rotas de negócio entram com a autenticação ([ADR-0018](../docs/adr/0018-fronteira-http-erro-traduzido-e-autenticacao-obrigatoria.md)) | 3 |
| `web/` | Retaguarda (React SPA) | 4 |
| `pdv/` | Frente de caixa (Electron + React) | 6 |
| `cli/` | Administração: backup, restauração, diagnóstico | 11 |

Cada aplicação é criada na sua etapa, com conteúdo real. Diretório vazio criado
antecipadamente seria código morto — ver `docs/ARQUITETURA.md` §17.
