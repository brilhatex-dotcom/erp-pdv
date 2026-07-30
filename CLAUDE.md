# CLAUDE.md — Diretrizes permanentes do projeto ERP + PDV

> Este arquivo é lido automaticamente em toda sessão neste repositório.
> Ele vale para **todas** as decisões, do schema do banco ao texto de um botão.

---

## 1. Diretriz mestra: atuação multidisciplinar simultânea

Toda decisão neste projeto deve ser tomada considerando **simultaneamente** os nove
papéis abaixo. Não é rodízio nem consulta pontual: é um comitê permanente que se
reúne a cada decisão técnica.

O objetivo final é **software comercial de alta qualidade** — não protótipo, não
prova de conceito, não "funciona na minha máquina".

### Os nove papéis, o que cada um defende e onde tem veto

| # | Papel | O que defende | Onde tem **veto** |
|---|---|---|---|
| 1 | **Arquiteto de Software** | Fronteiras, acoplamento, decisões reversíveis, custo de mudança futura | Violação do grafo de dependências; regra de negócio fora do domínio |
| 2 | **Desenvolvedor Full Stack Sênior** | Código legível, testável, idiomático; ausência de complexidade acidental | Código sem teste; duplicação de regra; gambiarra sem ADR |
| 3 | **Especialista UX/UI** | Velocidade no balcão, clareza, acessibilidade, zero treinamento | Fluxo que exige mouse no PDV; erro técnico exibido ao operador |
| 4 | **DBA PostgreSQL** | Modelagem, índices, planos de execução, integridade, migrações seguras | Migração irreversível; consulta sem índice em caminho quente; FK ausente |
| 5 | **Especialista em Segurança** | Modelo de ameaças, criptografia, autenticação, LGPD, auditoria | Segredo em texto claro; autorização apenas no cliente; dependência vulnerável |
| 6 | **Especialista Fiscal BR** | NF-e/NFC-e, tributação, contingência, obrigações acessórias, Reforma | Cálculo tributário sem teste; layout fixo no código; guarda de XML falha |
| 7 | **Analista de Negócios** | Valor entregue, escopo, custo de suporte, modelo comercial | Funcionalidade sem caso de uso real; complexidade que ninguém paga |
| 8 | **QA / Testes** | Cobertura, casos de borda, regressão, testabilidade | Domínio abaixo de 90%; fluxo crítico sem teste E2E |
| 9 | **DevOps** | CI/CD, instalador, observabilidade, backup, atualização, rollback | Deploy sem rollback; build não reprodutível; ausência de verificação de saúde |

### Como o comitê opera na prática

1. **Antes de propor**, verificar a decisão contra os nove papéis.
2. **Ao apresentar**, tornar explícito quando papéis **conflitam** — e qual prevaleceu, com justificativa. Conflito escondido é decisão mal tomada.
3. **Veto é bloqueante.** Se um papel veta, ou a proposta muda, ou o veto é derrubado por decisão registrada em ADR.
4. **Não inventar consenso.** Quando os papéis divergem e a escolha é de negócio (custo, prazo, posicionamento), a decisão é do responsável pelo produto — cabe apresentar o trade-off, não escondê-lo.

### Hierarquia de desempate

Quando os papéis conflitam e não há decisão de negócio disponível, esta é a ordem:

```
1. Segurança e conformidade fiscal   (risco legal — não negociável)
2. Integridade dos dados             (dado perdido não volta)
3. Disponibilidade do PDV            (loja parada = prejuízo imediato)
4. Experiência do operador           (define se o produto é usado ou abandonado)
5. Manutenibilidade                  (define o custo dos próximos 5 anos)
6. Desempenho                        (só depois de medido)
7. Elegância técnica                 (último critério, sempre)
```

**Exemplo de aplicação:** o Especialista em Segurança quer senha forte no caixa;
o UX quer troca de operador em 2 segundos. Conflito real. Resolução: PIN de 6
dígitos com bloqueio progressivo no PDV (o ataque exige presença física) e senha
forte + 2FA na retaguarda. Nenhum papel foi ignorado — o contexto de ameaça foi
separado. Registrado em ADR-0011.

---

## 2. Princípios inegociáveis

Derivados de `docs/ARQUITETURA.md`. Qualquer violação exige ADR.

1. **O PDV nunca para.** Funcionalidade que pode impedir uma venda precisa de caminho degradado.
2. **O domínio não conhece infraestrutura.** `@erp/domain` tem zero dependências de runtime.
3. **Dependências apontam para dentro.** UI → Aplicação → Domínio. Nunca o contrário.
4. **Dinheiro é inteiro em centavos.** `float` para dinheiro é bug agendado para o fechamento de caixa.
5. **Fatos são imutáveis.** Estoque, caixa e fiscal são append-only. Correção gera novo evento, nunca `UPDATE`.
6. **Simples por padrão, extensível por contrato.** Abstração só onde já existe segunda implementação prevista.
7. **Erros são valores.** Falha de negócio retorna `Result`; `throw` só para bug de programação.

---

## 3. Decisões já fechadas (não reabrir sem ADR)

| Decisão | Valor | Referência |
|---|---|---|
| **Banco de dados** | **PostgreSQL 17 único**, embarcado no instalador como serviço. Sem SQLite como sistema de registro | ADR-0013 · §5.2.1 |
| Cache de contingência do PDV | SQLite embarcado no Electron — **somente** catálogo replicado e fila offline | §12.2 |
| Topologia | Servidor local na loja + contingência na estação | ADR-0001 · §2.2 |
| Emissão fiscal | Assíncrona via Outbox, nunca bloqueando a venda | ADR-0006 · §15 |
| Estoque | Eventos comutativos, sem coluna de saldo mutável | ADR-0007 · §11.4 |
| Identificadores | UUIDv7 gerado no cliente | ADR-0008 · §11.2 |
| Dinheiro | Inteiro em centavos (`bigint`) | ADR-0009 · §6.3 |

---

## 4. Padrões de código

| Aspecto | Regra |
|---|---|
| Linguagem do domínio | **Português** (`Venda`, `SessaoCaixa`, `CalculadoraTributos`) |
| Linguagem de infraestrutura | Inglês onde é jargão (`Repository`, `UnitOfWork`) |
| Classes / tipos | `PascalCase` · Funções / variáveis: `camelCase` · Pastas: `kebab-case` |
| Tabelas | `snake_case` plural · Rotas: `/api/kebab-case` plural |
| TypeScript | `strict: true`. **`any` é proibido** — use `unknown` e estreite |
| Validação | Zod em toda fronteira (HTTP, arquivo, variável de ambiente) |
| Comentários | Explicam **por quê**, nunca **o quê**. Código óbvio não se comenta |
| Commits | Conventional Commits, em português, corpo explicando a motivação |

---

## 5. Portões de qualidade (bloqueiam o merge)

| Portão | Critério |
|---|---|
| Tipagem | `tsc --noEmit` sem erro, sem `any` |
| Lint | Zero avisos |
| Arquitetura | `dependency-cruiser` valida o grafo de `docs/ARQUITETURA.md` §3.3 |
| Testes — domínio | ≥ **90%** de cobertura |
| Testes — fiscal | **100%** no motor tributário. Sem exceção |
| Testes E2E | Venda completa, fechamento de caixa e emissão fiscal |
| Segurança | `npm audit` sem vulnerabilidade alta ou crítica; zero segredo no repositório |
| Migração | Script de reversão testado; padrão expand-contract |
| Desempenho | Metas RNF-01 a RNF-05 de `docs/ARQUITETURA.md` §1.5 |

---

## 6. Checklist obrigatório antes de entregar qualquer funcionalidade

Nenhum item é opcional. Cada um corresponde a um papel do comitê:

- [ ] **Arquiteto** — respeita o grafo de dependências? Decisão é reversível?
- [ ] **Dev Sênior** — tem teste? Alguma regra duplicada?
- [ ] **UX/UI** — funciona só com teclado? Estados de carregando/vazio/erro existem? Mensagem é compreensível por leigo?
- [ ] **DBA** — índices cobrem as consultas? Migração é reversível? FKs e constraints declaradas?
- [ ] **Segurança** — autorização validada **no servidor**? Entrada validada? Ação sensível auditada?
- [ ] **Fiscal** — impacta documento fiscal? Cálculo testado? Regra em tabela versionada, não no código?
- [ ] **Negócios** — resolve dor real? Custo de suporte que gera?
- [ ] **QA** — casos de borda: zero, negativo, nulo, concorrente, offline, estoque insuficiente?
- [ ] **DevOps** — observável em log? Migração segura? Rollback existe?

---

## 7. O que nunca fazer

- Colocar regra de negócio em componente React ou em rota HTTP.
- Confiar em validação apenas no cliente.
- Usar `float` para dinheiro.
- Fixar alíquota, prazo fiscal ou layout de documento no código.
- Escrever migração destrutiva na mesma versão que passa a usar o campo novo.
- Bloquear a venda esperando SEFAZ, impressora ou rede.
- Exibir stack trace ou erro técnico ao operador de caixa.
- Introduzir dependência nova sem justificar frente aos nove papéis.
- Marcar tarefa como concluída com teste falhando ou implementação parcial.

---

## 8. Referências do projeto

| Documento | Conteúdo |
|---|---|
| `docs/ARQUITETURA.md` | Arquitetura completa — fonte da verdade técnica |
| `docs/adr/` | Decisões arquiteturais. **Imutáveis**: revisão gera novo ADR que supersede |
| `docs/fiscal/` | Notas técnicas, layouts e tabelas fiscais |
| `docs/operacao/` | Instalação, backup, suporte |

**Divergência entre este arquivo e `docs/ARQUITETURA.md` é defeito.** Corrigir os dois
na mesma alteração.
