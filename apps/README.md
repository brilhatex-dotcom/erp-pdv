# apps/

Aplicações executáveis. Cada uma é **composição** — junta pacotes e adapters —
e não contém regra de negócio nova (`CLAUDE.md` §9).

| Aplicação | Descrição | Etapa do roadmap |
|---|---|---|
| `server/` | API + jobs (Fastify) | 3 |
| `web/` | Retaguarda (React SPA) | 4 |
| `pdv/` | Frente de caixa (React; Electron na etapa do hardware) | 6 |
| `cli/` | Administração: backup, restauração, diagnóstico | 11 |

Cada aplicação é criada na sua etapa, com conteúdo real. Diretório vazio criado
antecipadamente seria código morto — ver `docs/ARQUITETURA.md` §17.
