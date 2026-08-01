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

## 2. Produto e mercado-alvo

Este é um **produto comercial**, vendido para pequenos e médios estabelecimentos
brasileiros. Não é software sob medida para um cliente.

**Segmentos-alvo (nove):** mercadinhos · padarias · mercearias · casas de construção ·
autopeças · lojas de conveniência · pequenos depósitos · açougues · hortifrutis.

**Perfil dominante:** 1 a 3 computadores por cliente, sem equipe de TI.

> ⛔ **Escopo: varejo apenas — venda de mercadoria.**
> Prestação de serviços, Ordem de Serviço e oficina **não fazem parte deste produto**
> (decisão de 30/07/2026) — serão um sistema separado. Consequência direta: **NFS-e está
> fora do roteiro fiscal**; o produto emite apenas NFC-e (65) e NF-e (55).
> Ver `docs/ANALISE-SEGMENTOS.md` §5.1.

### Os cinco critérios que decidem qualquer empate técnico

| Critério | O que significa na prática |
|---|---|
| **Simplicidade** | O usuário não deve perceber a complexidade interna. Zero treinamento formal |
| **Estabilidade** | Travar uma vez destrói a confiança. Falha deve ser degradação, nunca parada |
| **Velocidade** | Percebida no balcão, não em benchmark. Latência de tecla importa mais que throughput |
| **Facilidade de manutenção** | Um bug precisa ser diagnosticável remotamente, sem ir à loja |
| **Baixo custo operacional** | Sem mensalidade de infraestrutura por cliente. Suporte é o maior custo real |

> **Regra derivada:** "parece simples por fora, é profissional por dentro".
> Complexidade interna é aceitável **apenas** quando reduz complexidade para o usuário
> ou o custo de suporte. Complexidade que só agrada ao desenvolvedor é rejeitada.

**O custo de suporte é o critério econômico dominante.** Uma decisão que economiza duas
horas de desenvolvimento e gera um chamado por cliente é uma decisão ruim — o chamado
se multiplica por toda a base instalada, o desenvolvimento não.

### Regra permanente: decisão com custo recorrente exige alternativas

Sempre que uma decisão gerar **custo recorrente** — para o fabricante ou para o cliente
final — é **obrigatório apresentar antes**, por escrito:

1. **Todas as alternativas viáveis**, inclusive a de menor custo e a de não fazer nada.
2. Vantagens e desvantagens de cada uma, sem esconder o lado fraco da recomendada.
3. **Impacto financeiro estimado**, com a variável que mais o influencia identificada.
4. Quem paga a conta: o fabricante ou o cliente — e o que acontece se o volume crescer.

**Nunca assumir automaticamente a solução mais complexa ou mais cara.** A solução
recomendada precisa ser justificada contra as mais simples, não pressuposta.

Custo recorrente que cresce com o uso do cliente é o mais perigoso: um contrato
lucrativo vira prejuízo sem que nada tenha sido decidido errado no dia da assinatura.

---

## 3. Fluxo obrigatório de desenvolvimento

**Regra permanente.** Nenhum módulo é desenvolvido fora deste fluxo:

| # | Etapa | Critério de conclusão |
|---|---|---|
| 1 | **Analisar o problema** | Entender a dor real do estabelecimento, não só o requisito escrito |
| 2 | **Planejar a solução** | Modelo, fronteiras, impacto nos nove papéis (§1) |
| 3 | **Explicar o que será desenvolvido** | Antes de codar, por escrito, com trade-offs explícitos |
| 4 | **Aguardar — só se houver decisão importante** | Decisão de negócio, custo ou mudança de arquitetura. Caso contrário, **prosseguir sem perguntar** |
| 5 | **Desenvolver** | Solução robusta. **Nunca** implementação rápida só para fechar tarefa |
| 6 | **Revisar o código** | Contra o checklist dos nove papéis (§8) |
| 7 | **Executar testes** | Suíte completa, não apenas o teste novo |
| 8 | **Corrigir problemas** | Falha encontrada é corrigida antes de avançar, nunca adiada |
| 9 | **Documentar a etapa** | ADR se houve decisão; atualizar `docs/` |
| 10 | **Só então avançar** | Etapa incompleta não é "concluída" |

**Sobre a etapa 4 — quando parar e quando seguir:**

| Parar e perguntar | Seguir e informar |
|---|---|
| Mudança de arquitetura ou de ADR | Escolha de nome, estrutura de pasta, formato de teste |
| Decisão de escopo ou de modelo comercial | Detalhe de implementação dentro do plano aprovado |
| Trade-off com impacto em custo ou prazo | Refatoração local sem mudança de contrato |
| Nova dependência relevante | Correção de bug encontrado no caminho |

**Melhoria identificada durante o desenvolvimento:** apresentar a **justificativa antes**
de alterar a arquitetura. Nunca alterar primeiro e explicar depois.

### Regra permanente: `main` é o único lugar onde o trabalho existe

Sessões de desenvolvimento terminam sem aviso — token acaba, contexto estoura, máquina
é reciclada. A sessão seguinte só encontra o que estiver em `main`.

| Regra | Motivo |
|---|---|
| Todo trabalho concluído vai para **`main`** antes de a sessão terminar | Branch que ninguém conhece é trabalho perdido |
| Branch de trabalho é **descartável**: criada de `main`, mesclada, apagada | Branch sobrevivente vira segunda fonte da verdade |
| Sessão nova **começa lendo `ESTADO.md`** e recria a branch de `origin/main` | Impede reimplementar o que já existe |
| Ao concluir uma etapa, **atualizar `ESTADO.md`** (etapa 9 do fluxo acima) | Documento desatualizado é pior que ausente: engana |

**Origem desta regra:** em 31/07/2026, com `main` vazia, duas sessões trabalharam em
paralelo sem se conhecer e implementaram autenticação duas vezes, com modelos diferentes.
Nenhuma errou — a estrutura permitiu. Custou uma tarde de unificação.

---

## 4. Princípios inegociáveis

Derivados de `docs/ARQUITETURA.md`. Qualquer violação exige ADR.

1. **O PDV nunca para.** Funcionalidade que pode impedir uma venda precisa de caminho degradado.
2. **O domínio não conhece infraestrutura.** `@erp/domain` tem zero dependências de runtime.
3. **Dependências apontam para dentro.** UI → Aplicação → Domínio. Nunca o contrário.
4. **Dinheiro é inteiro em centavos.** `float` para dinheiro é bug agendado para o fechamento de caixa.
5. **Fatos são imutáveis.** Estoque, caixa e fiscal são append-only. Correção gera novo evento, nunca `UPDATE`.
6. **Simples por padrão, extensível por contrato.** Abstração só onde já existe segunda implementação prevista.
7. **Erros são valores.** Falha de negócio retorna `Result`; `throw` só para bug de programação.

---

## 5. Decisões já fechadas (não reabrir sem ADR)

| Decisão | Valor | Referência |
|---|---|---|
| **Banco de dados** | **PostgreSQL 17 único**, embarcado no instalador como serviço. Sem SQLite como sistema de registro | ADR-0013 · §5.2.1 |
| Cache de contingência do PDV | **Arquivos na estação** (fila append-only + catálogo em índice de memória) — **somente** catálogo replicado e fila offline | **ADR-0021** · §12.2 |
| Topologia | Servidor local na loja + contingência na estação | ADR-0001 · §2.2 |
| Emissão fiscal | Assíncrona via Outbox, nunca bloqueando a venda | ADR-0006 · §15 |
| **Comunicação fiscal** | **Via API fiscal externa, atrás da porta `ProvedorFiscal`. Sem SEFAZ direto.** O ERP nunca conhece o fornecedor | **ADR-0015** · `docs/fiscal/ARQUITETURA-FISCAL.md` |
| **Módulo fiscal** | **Opcional por empresa**, via Null Object na composição. O domínio **não** tem `if (fiscalHabilitado)` | **ADR-0016** |
| **Fiscal no roteiro** | **Não bloqueia a entrega.** Todo o ERP é concluído antes; até lá, `ProvedorFiscalSimulado` cobre emissão, rejeição, cancelamento, inutilização, XML, DANFE, contingência e eventos. **O instalador não depende do fiscal** | **ADR-0022** |
| **PDV** | **PWA** servida pelo servidor da loja + **Agente Local** instalado, dono da impressão, da fila offline e do catálogo | **ADR-0023** (supersede 0005) |
| **Empresas** | **Uma empresa por instalação.** Nenhuma tabela leva `empresa_id`; duas lojas são duas instalações | **ADR-0024** |
| Certificado digital | **É do cliente.** Custódia no provedor quando possível; o ERP guarda só hash, titular e validade | ADR-0015 · §6 |
| Numeração fiscal | Controlada pelo **ERP**, não pelo provedor. Uma série por estação de PDV | §8 do doc fiscal |
| Estoque | Eventos comutativos, sem coluna de saldo mutável | ADR-0007 · §11.4 |
| Identificadores | UUIDv7 gerado no cliente | ADR-0008 · §11.2 |
| Dinheiro | Inteiro em centavos (`bigint`) | ADR-0009 · §6.3 |

---

## 6. Padrões de código

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

## 7. Portões de qualidade (bloqueiam o merge)

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

## 8. Checklist obrigatório antes de entregar qualquer funcionalidade

Nenhum item é opcional. Cada um corresponde a um papel do comitê (§1):

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

## 9. O que nunca fazer

- Colocar regra de negócio em componente React ou em rota HTTP.
- Confiar em validação apenas no cliente.
- Usar `float` para dinheiro.
- Fixar alíquota, prazo fiscal ou layout de documento no código.
- Escrever migração destrutiva na mesma versão que passa a usar o campo novo.
- Bloquear a venda esperando SEFAZ, impressora, provedor fiscal ou rede.
- Deixar formato, vocabulário ou código de erro do provedor fiscal vazar para fora do adapter.
- Fazer qualquer funcionalidade fora do módulo fiscal depender de documento fiscal.
- Persistir certificado digital de cliente quando o provedor puder custodiá-lo.
- Exibir stack trace ou erro técnico ao operador de caixa.
- Introduzir dependência nova sem justificar frente aos nove papéis.
- Fazer a entrega da primeira versão depender de contratar API fiscal (ADR-0022).
- Acrescentar `empresa_id` a qualquer tabela sem novo ADR (ADR-0024).
- Guardar a fila de vendas offline no navegador: a garantia de `fsync` é do Agente Local (ADR-0023).
- Marcar tarefa como concluída com teste falhando ou implementação parcial.

---

## 10. Referências do projeto

| Documento | Conteúdo |
|---|---|
| **`ESTADO.md`** | **Onde o trabalho parou, o que vem em seguida e as armadilhas já pagas. Ler antes de continuar o desenvolvimento** |
| `docs/ARQUITETURA.md` | Arquitetura completa — fonte da verdade técnica |
| `docs/adr/` | Decisões arquiteturais. **Imutáveis**: revisão gera novo ADR que supersede |
| `docs/fiscal/` | Notas técnicas, layouts e tabelas fiscais |
| `docs/operacao/` | Instalação, backup, suporte |

**Divergência entre este arquivo e `docs/ARQUITETURA.md` é defeito.** Corrigir os dois
na mesma alteração.
