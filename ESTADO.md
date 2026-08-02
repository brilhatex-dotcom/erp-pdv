# ESTADO — onde o projeto está agora

> **Leia este arquivo primeiro.** Ele existe para que qualquer sessão nova de
> desenvolvimento continue de onde a anterior parou, sem reimplementar o que já existe.
>
> Última atualização: **01/08/2026** · Ramo de referência: **`main`**
>
> ⚠️ **Há trabalho vivo fora de `main`.** Confira a §0.1 antes de começar qualquer coisa
> que toque o PDV, a impressão ou a contingência offline.

---

## 0. Regra de ouro para quem chega agora

**`main` é a fonte da verdade.** Comece dela, sempre:

```bash
git fetch origin main
git checkout -B claude/<nome-do-trabalho> origin/main
```

E ao terminar: commit → push → PR → merge em `main` → **apaga a branch**.

**Por que essa regra existe:** em 31/07/2026 duas sessões trabalharam em paralelo sem
saber uma da outra, porque `main` estava vazia e cada sessão criou sua própria branch.
As duas implementaram autenticação — o mesmo módulo, duas vezes, com modelos diferentes.
A unificação custou uma tarde. `main` sempre atualizada é o que impede a repetição.

**E se repetiu.** Em 01/08/2026 aconteceu de novo, duas vezes: uma sessão construiu
ferramentas de impressão enquanto outra ligava a contingência à tela, e uma terceira
mexia no fechamento de caixa. Desta vez o custo foi baixo — as áreas quase não se
cruzaram e o merge saiu limpo. Foi sorte, não processo.

### 0.1 O que está fora de `main` agora

**Conferir isto é o primeiro passo de qualquer sessão.** A lista abaixo envelhece; o
comando não:

```bash
git fetch origin --prune
git branch -r                       # o que existe
git log --oneline origin/main..origin/<branch>   # o que ela tem a mais
```

| Branch | Situação em 02/08/2026 | O que ela mexe |
|---|---|---|
| `claude/projeto-andamento-47iofe` | Aguardando merge | Correções da 1ª execução do `instalador.yml`: NSIS instalado no runner, migração passa a morar no `apps/instalador` com o CLI do Prisma embarcado, e a ordem segredos↔`initdb` corrigida. Ao mesclar, apague-a e esvazie esta tabela |

> Já mescladas e apagadas: `claude/gestao-de-usuarios`, `claude/cadastro-de-empresa`,
> `claude/agente-local`, `claude/pwa-e-quiosque`, `claude/financeiro` e
> `claude/instalacao`.

**Se o seu trabalho encosta em PDV, impressão ou contingência**, fale com essa branch
antes: ou espere o merge, ou parta dela. Começar de `main` e mexer nos mesmos arquivos
produz um conflito grande, porque ela **move arquivos de lugar** — e conflito de
movimentação é o pior de resolver.

> **Quando esta seção ficar desatualizada, corrija-a.** Um `ESTADO.md` que afirma "não
> há trabalho fora de `main`" quando há é pior que nenhum: ele dá permissão explícita
> para a sessão nova ignorar o que existe.

---

## 1. O que já funciona

| Área | Situação | Onde está |
|---|---|---|
| Monorepo, CI, portões de qualidade | ✅ Completo | `turbo.json`, `.github/workflows/ci.yml` |
| Domínio — produto, estoque, venda, caixa | ✅ Completo | `packages/domain/src/` |
| Domínio — acesso (usuário, papel, permissão) | ✅ Completo | `packages/domain/src/acesso/` |
| Casos de uso | ✅ Completo | `packages/application/src/` |
| Persistência PostgreSQL + `UnitOfWork` | ✅ Completo | `packages/database/src/` |
| API HTTP (Fastify) com autenticação | ✅ Completo | `apps/server/src/rotas/` |
| Retaguarda web (React) | ✅ Completo | `apps/web/src/` |
| **Usuários — gestão e primeiro acesso** | ✅ Completo, ponta a ponta | `casos-de-uso/usuarios/`, `rotas/usuarios.ts`, `telas/Usuarios.tsx`, `telas/PrimeiroAcesso.tsx` |
| Design system | ✅ Completo | `packages/ui/src/` |
| Cliente HTTP + sessão compartilhados | ✅ Completo | `packages/cliente-api/src/` |
| **PDV — balcão, do primeiro bipe ao troco** | ✅ Completo | `apps/pdv/src/` |
| Cadastros — categoria, cliente, fornecedor | ✅ Completo, ponta a ponta | domínio → banco → API → telas |
| **Empresa da instalação** | ✅ Completo, ponta a ponta | `domain/cadastros/Empresa.ts`, `casos-de-uso/cadastros/DefinirEmpresa.ts`, `rotas/empresa.ts`, `telas/Empresa.tsx` |
| **Produtos — cadastro completo** | ✅ Completo, ponta a ponta | `casos-de-uso/catalogo/`, `rotas/produtos.ts`, `telas/Produtos.tsx` |
| **Estoque — movimento, saldo e extrato** | ✅ Completo, ponta a ponta | `casos-de-uso/estoque/`, `consultas/estoque.ts`, `rotas/estoque.ts`, `telas/Estoque.tsx` |
| **Compras — entrada de mercadoria** | ✅ Completo, ponta a ponta | `domain/compras/`, `casos-de-uso/compras/`, `rotas/compras.ts`, `telas/Compras.tsx` |
| Barreira de erro da retaguarda | ✅ Tela que quebra não derruba a página | `apps/web/src/BarreiraDeErro.tsx` |
| Cupom ESC/POS e gaveta | ✅ Completo, sem hardware nativo | `packages/printing/src/` |
| Pré-visualização e impressora virtual | ✅ Conferir o cupom sem impressora | `packages/printing/src/previsualizacao.ts`, `apps/pdv/src/ferramentas/` |
| Catálogo replicado na estação | ✅ `GET /api/catalogo/replica` → arquivo local | `packages/database/src/consultas/` |
| **Agente Local** | ✅ Serviço HTTP em `127.0.0.1:9787` — impressão, fila offline e catálogo | `apps/agente/` |
| Contrato tela ↔ Agente | ✅ Tipos e cliente HTTP compartilhados | `packages/agente-contrato/` |
| **Contingência offline do PDV** | ✅ Completa, da fila à tela | `apps/pdv/src/principal/`, `vendaComQueda.ts` |
| **Caixa — abertura e fechamento** | ✅ Completo, com contagem às cegas. **Sangria e suprimento só têm API, sem tela** — ver §2.4 | `casos-de-uso/caixa/`, `rotas/caixa.ts`, `telas/Abertura.tsx`, `telas/Fechamento.tsx` |
| Conferência dos caixas na retaguarda | ✅ Lista com divergência por sessão | `consultas/sessoesDeCaixa.ts`, `apps/web/src/telas/Caixas.tsx` |
| **PWA do PDV** | ✅ Manifesto, ícones e service worker — a tela abre com o servidor da loja fora do ar | `apps/pdv/public/`, `apps/pdv/src/sw/` |
| **Casca de quiosque** | ✅ Electron opcional, tela cheia, **sem lógica** (ADR-0023) | `apps/quiosque/` |
| **Financeiro — contas a receber e a pagar** | ✅ Completo, ponta a ponta. O crediário da venda vira título na mesma transação (ADR-0025) | `domain/financeiro/`, `casos-de-uso/financeiro/`, `rotas/financeiro.ts`, `telas/Financeiro.tsx` |
| **Servidor entrega as telas** | ✅ PDV na raiz, retaguarda em `/retaguarda`. **É o que faz o service worker registrar** | `apps/server/src/http/estaticos.ts` |
| **Instalador Windows** | ⚠️ Workflow verde e `.exe` de 77 MB gerado; nunca instalado num Windows — ver §2.1.1 | `apps/instalador/`, `.github/workflows/instalador.yml` |

**2.686 testes passando.** Todos os portões do `CLAUDE.md` §7 verdes (22 tarefas).
O grafo de dependências está **sem nenhum órfão**.

Verificação completa em um comando:

```bash
pnpm verify     # format:check + lint + typecheck + arch + test:cov + audit --prod
```

> Exige o PostgreSQL de teste no ar: `pnpm db:up`.

---

## 2. O que falta — na ordem decidida em 01/08/2026

> **A ordem abaixo é decisão do responsável pelo produto, não sugestão técnica.**
> O fiscal deixou de ser bloqueador (ADR-0022): entra **depois** de tudo isto.

### 2.1 As duas frentes que destravavam o resto — ambas concluídas

- ~~**Cadastro da empresa**~~ ✅ **Pronto.** CNPJ, razão social, endereço, regime
  tributário e contato, com índice único no esquema garantindo a linha única
  (ADR-0024). O CNPJ não muda depois de salvo: trocá-lo é outra empresa, e as
  notas já emitidas passariam a apontar para um emitente que nunca as emitiu.
  **Falta o logotipo** — entra junto com a impressão comum (módulo 19), que é
  quem vai usá-lo.
- ~~**Agente Local**~~ ✅ **Pronto** (ADR-0023). `apps/agente` é um serviço Node
  em `127.0.0.1:9787`, dono da impressão, da fila offline e do catálogo
  replicado. `FilaDeVendas`, `ReplicaCatalogo` e `Sincronizador` **mudaram de
  casa, não foram reescritos**. A casca Electron e a ponte IPC saíram; a tela
  fala HTTP pelo `@erp/agente-contrato`.

### 2.1.1 ⬅️ PRÓXIMO — instalar numa máquina Windows de verdade

O `instalador.yml` foi executado pela primeira vez em 02/08/2026 (run
30744827814). Tudo até a compilação passou: as dependências, o build, a montagem
do conteúdo, o download do Node, do PostgreSQL e do NSSM. **A compilação falhou**
— e a leitura do log expôs quatro defeitos que teriam quebrado *toda* instalação:

| Defeito | Por que quebrava | Situação |
|---|---|---|
| NSIS não vem mais no runner `windows-latest` | `makensis não encontrado` | ✅ Instalado por `choco`, versão fixada |
| `initdb --pwfile` apontava para arquivo que ninguém criava | `initdb` falhava no 1º passo | ✅ `preparar` escreve o arquivo, e roda **antes** do `initdb` |
| Segredos gerados **depois** do `initdb` | `.env` com senha que o cluster nunca teve | ✅ Ordem invertida no NSIS |
| `migrar` chamava `npx prisma` | Só o `node.exe` é embarcado: não há `npx` | ✅ CLI do Prisma vai junto, chamado por caminho |
| Banco `erp_pdv` nunca era criado | `database does not exist` | ✅ Novo comando `criar-banco` |

Achados no mesmo caminho e corrigidos: reinstalar por cima de uma loja gerava
segredos novos e **perdia o acesso ao banco com as vendas dentro**; os atalhos
usavam `.lnk` para endereço `http`, que não abre nada; o `netsh` empilhava regra
duplicada a cada reinstalação; e as portas nunca eram conferidas, apesar de
`portaLivre` existir e ser testada.

| Parte | Situação |
|---|---|
| Servidor entregar as telas | ✅ **Testado** — 14 casos contra o servidor real |
| Preparação da instalação (segredos, `.env`, portas, banco) | ✅ **Testado** — 48 casos, 100% de cobertura |
| Migração pelo CLI embarcado | ✅ **Executada de verdade**, pela árvore do `pnpm deploy`, contra Postgres real |
| Montagem do conteúdo no runner Windows | ✅ **Executada** |
| Servidor subindo pela carga do instalador | ✅ **Executado** — PDV, `sw.js`, manifesto e retaguarda respondendo 200, lendo o `.env` gerado, contra Postgres real |
| Script NSIS | ✅ **Compila** — run 30746227226 |
| Executável gerado | ✅ `erp-pdv-0.1.0-teste-instalador.exe`, **77,2 MB** (de 450,9 MB de carga) |
| Sequência completa ensaiada no Linux | ✅ `preparar` → `conferir` → `initdb` → `criar-banco` → `migrar` → `verificar`, com Postgres real, 27 tabelas, primeiro acesso e reinstalação por cima preservando os segredos |
| Instalação numa máquina Windows | ⚠️ **1ª tentativa em 02/08/2026: falhou no `initdb`** por permissão de `Program Files`. Corrigido; falta repetir |

**Por que o resto não foi executado:** o ambiente de desenvolvimento é Linux.
Compilar NSIS e registrar serviço do Windows exige Windows. O `instalador.yml`
roda em `windows-latest` e é ali que a prova acontece — mas ele dispara **só
manualmente ou em tag `v*`**, para não gastar minuto de runner Windows a cada
commit.

**O próximo passo é:** baixar o artefato `instalador-windows` do run 30746227226
e executar o `.exe` numa máquina Windows real. É o único elo da corrente que
ainda nunca rodou — e onde moram `initdb`, os dois serviços, o firewall e a
verificação de saúde.

**O que observar na primeira instalação**, em ordem de risco:

1. o `initdb` com `--locale-provider=icu --icu-locale=pt-BR` aceita a locale na
   máquina do cliente (nunca foi executado no Windows);
2. o `nssm` sobe o serviço e o Node acha o `.env` ao lado do `index.js`;
3. a migração roda pelo motor embarcado, **sem** tentar baixar nada;
4. reinstalar por cima preserva os segredos e não recria o cluster.

Depois disso, o próximo módulo da ordem é **Relatórios (13)**.

> ⚠️ **O servidor da loja ainda não serve a PWA.** Hoje a PWA sobe pelo Vite em
> desenvolvimento; em produção quem entrega `index.html`, `sw.js` e os ícones é o
> servidor da loja, e isso ainda não existe. Sem esse passo o service worker não
> registra: ele só vale para conteúdo servido pela mesma origem. **É parte do
> módulo 16 (Instalação)** e está listado em §2.4.

### 2.2 Módulos do ERP, na ordem pedida

| # | Módulo | Situação |
|---|---|---|
| 1 | Login | ✅ Pronto |
| 2 | Usuários | ✅ Pronto — domínio, casos de uso, rotas, tela e **primeiro acesso da instalação** |
| 3 | Empresas | ✅ Pronto — cadastro único por instalação, com aviso de aptidão a emitir. Falta só o logotipo, que entra com a impressão comum |
| 4 | Clientes | ✅ Pronto |
| 5 | Fornecedores | ✅ Pronto |
| 6 | Produtos | ✅ Pronto — cadastro, alteração, busca da retaguarda e correção de preço pelo supervisor |
| 7 | Estoque | ✅ Movimento, saldo e extrato prontos. **Falta a contagem de inventário em lote** — ver §2.4 |
| 8 | Compras | ✅ Nota de entrada, cancelamento com estorno e lista. **Falta o pedido de compra** — ver §2.4 |
| 9 | Vendas | ✅ Pronto |
| 10 | PDV | ⚠️ Já fala com o Agente por HTTP; **falta o manifesto PWA** (item 18) |
| 11 | Caixa | ⚠️ Abertura, fechamento e conferência prontos. **Sangria e suprimento têm rota e caso de uso, mas nenhuma tela os chama** — ver §2.4 |
| 12 | Financeiro | ✅ Contas a receber e a pagar, baixa parcial, estorno, parcelamento, adiamento e cancelamento. **Falta a conciliação bancária** — ver §2.4 |
| 13 | Relatórios | ⚠️ Só a conferência de caixa |
| 14 | **Dashboard** | ⬜ Nada existe |
| 15 | **Backup** | ⬜ Nada existe |
| 16 | Instalação | ⚠️ NSIS, PostgreSQL embarcado, dois serviços, firewall e verificação de saúde. Workflow **verde**, `.exe` gerado; **nunca instalado numa máquina Windows** — ver §2.1.1 |
| 17 | **Atualização** | ⬜ Com PWA, a tela se atualiza sozinha; falta o Agente Local e o servidor |
| 18 | PWA | ✅ Manifesto, ícones, service worker e instalação na área de trabalho. **Falta o servidor da loja entregar os arquivos** — módulo 16 |
| 19 | **Impressão comum** | ⬜ Impressora de folha A4, para relatórios e pedidos |
| 20 | **Impressoras térmicas por marca** | ⚠️ ESC/POS genérico pronto no Agente; faltam Bematech, Elgin, Epson e Daruma |

### 2.3 Só depois de tudo acima — fiscal com provedor real

Até lá o produto usa `ProvedorFiscalSimulado` (ADR-0022), que cobre emissão,
rejeição, cancelamento, inutilização, XML, DANFE, contingência e eventos.

**Instalação com simulado é válida para demonstração, homologação e implantação —
não para uma loja operar legalmente.** Quem vender o produto precisa saber disso.

### 2.4 Dívidas conhecidas, pequenas e nomeadas

- **Sangria e suprimento não têm tela.** `POST /api/caixa/sangria` e `/suprimento`
  existem, com caso de uso e testes; nenhuma tela os chama. A sangria ainda precisa
  do fluxo de autorização do supervisor, que a rota já devolve como terceiro estado
  (`AUTORIZACAO_NECESSARIA`), não como negativa. Sem isso a loja não tira dinheiro da
  gaveta pelo sistema.
- **`sessoes_caixa.operador_id` não tem FK.** O papel do DBA tem veto sobre FK
  ausente (`CLAUDE.md` §1), e esta escapou. A consulta de sessões já lida com o
  caso (mostra `—`), mas a integridade real depende da migração. Fazer junto com
  a próxima migração de caixa, no padrão expand-contract e com reversão testada.
- **Reabertura de caixa não existe.** A permissão `caixa:reabrir` está definida e
  não é usada por nada. Não foi implementada de propósito: reabrir invertendo o
  status é o `UPDATE` que o princípio 5 proíbe. Se o negócio precisar, o caminho é
  um evento de correção — e isso exige ADR.
- ~~O servidor da loja não serve a PWA~~ ✅ **Resolvido.** `http/estaticos.ts`
  entrega o PDV na raiz e a retaguarda em `/retaguarda`, com `sw.js` sem cache e
  arquivo com hash cacheado por um ano.
- **O instalador nunca foi executado numa máquina Windows.** Ver §2.1.1 — é a maior incerteza aberta
  no projeto hoje.
- **O instalador não é assinado.** Decisão registrada: certificado custa de
  R$ 1.500 a R$ 5.000 por ano e exige token físico ou HSM desde 2023. O Windows
  mostra "Editor desconhecido"; o `docs/operacao/INSTALACAO.md` explica ao
  técnico o que fazer. Quando houver certificado, é um passo `signtool` no
  workflow — nada no produto muda.
- **O modo "somente estação de caixa" não existe.** O instalador instala tudo.
  A estação precisaria só do Agente Local (ADR-0023), e o `INSTALACAO.md` já
  descreve o fluxo pretendido.
- **O ícone do PWA é provisório.** Gerado por `apps/pdv/scripts/gerar-icones.mjs`,
  um cupom estilizado sem tipografia. Serve para a instalabilidade; a marca do
  produto substitui os três PNG sem tocar em código.
- **O segredo do Agente vem de `VITE_SEGREDO_AGENTE` no build da PWA.** É
  provisório e está marcado como tal em `balcao.ts`: o certo é o servidor da loja
  entregá-lo junto com a sessão, para não viajar dentro de um bundle público.
- **Cancelar a venda não cancela os títulos dela.** Não existe caso de uso de
  cancelar venda — o domínio tem `Venda.cancelar` e nada o chama —, então a
  função de cancelamento em massa **não foi escrita**: código sem chamador é
  código morto que ninguém mantém. **Gatilho:** quem escrever `CancelarVenda`
  precisa alcançar `titulos.porDocumento(vendaId)` e cancelá-los, senão a dívida
  sobrevive à venda e o cliente é cobrado por mercadoria devolvida. Título com
  recebimento lançado não cancela — o caminho é estornar antes.
- **Conciliação bancária não existe.** A permissão `financeiro:conciliar` está
  definida e **não é usada por nada**, como `estoque:inventario` e
  `caixa:reabrir`. Conciliar exige importar extrato (OFX) e casar lançamentos —
  domínio novo, não rota faltando. Não bloqueia nada: o lojista de bairro
  confere o extrato no aplicativo do banco.
- **O recebimento de fiado não entra na sessão de caixa.** É deliberado e está
  comentado em `MovimentarTitulo.ts`: a sessão é conferida contra a contagem
  física do turno da **venda**, e o fiado chega dias depois, muitas vezes com
  outro operador. Somá-lo faria o fechamento não bater por construção. Se o
  negócio quiser o dinheiro do fiado na gaveta, é decisão que exige ADR.
- **O PDV ainda não pergunta o número de parcelas.** O servidor aceita
  (`crediario: { parcelas }` em `FinalizarVenda`) e a retaguarda parcela no
  lançamento manual, mas a tela do balcão sempre manda uma parcela — a caderneta
  clássica. Falta o passo no fechamento da venda, que é onde a pressa é maior e
  o desenho precisa de cuidado.
- **Pedido de compra não existe.** O que existe é a **nota de entrada**: o
  documento do que já chegou. Falta o passo anterior — pedir ao fornecedor e
  conferir o recebimento contra o pedido. Não bloqueia a operação (a loja de
  bairro compra por telefone e confere com o papel na mão), e entra junto com a
  importação do XML da nota, que é quando o rascunho de nota passa a valer a pena.
- **Cancelar nota não desfaz o custo médio.** O estorno é `AJUSTE_NEGATIVO`, que
  corrige quantidade e **não** valor — o correto para um ajuste. Mas o custo médio
  já foi contaminado pela entrada errada e continua contaminado depois do
  cancelamento. Corrigi-lo exigiria reprojetar o saldo a partir dos movimentos,
  que é operação de manutenção e ainda não existe. **Gatilho:** quando houver
  recálculo de projeção, ligar os dois.
- **Contagem de inventário em lote não existe.** Dá para lançar `AJUSTE_POSITIVO` e
  `AJUSTE_NEGATIVO` um a um, com justificativa, e é o suficiente para corrigir
  divergência pontual. O que falta é o fluxo de **contagem às cegas** da loja
  inteira: gerar a folha, contar sem ver o saldo, aplicar as diferenças de uma vez.
  É domínio novo, não rota faltando. A permissão `estoque:inventario` está definida
  e **não é usada por nada** até ele existir — como `caixa:reabrir`.
- **Busca de produto da retaguarda faz varredura.** `ProdutoRepositorioPrisma.buscar`
  usa `contains` sobre `descricao_busca`: o índice B-tree só atende prefixo, e quem
  procura "coca" dentro de "REFRIGERANTE COCA COLA" precisa de contenção. Foi
  decisão consciente — **não** é o caminho quente (a bipada do balcão é `porCodigo`,
  por igualdade), o resultado é limitado a dezenas de linhas, e a alternativa (índice
  GIN com `pg_trgm`) acrescentaria uma extensão do PostgreSQL à responsabilidade do
  instalador. **Gatilho de revisão:** acima de ~50 mil produtos, ou busca passando de
  300 ms, medir e reconsiderar.

## 3. Armadilhas já pagas — não caia de novo

Cada item abaixo custou tempo real. Estão aqui para não custar duas vezes.

| Armadilha | Como se manifesta | Regra |
|---|---|---|
| **Cobertura que não vê o arquivo** | Relatório verde, arquivo nunca medido | Todo `vitest.config.ts` precisa de `include: ["src/**/*.{ts,tsx}"]`. Ocorreu **três vezes** |
| **Helper de teste barrando o merge** | Cobertura reprova em `src/testes/**` | Excluir `src/testes/**` do `coverage` — helper com `VAR ?? padrão` tem ramo que só executa em outra máquina |
| **Turborepo apaga variável de ambiente** | Prisma falha com `self-signed certificate` | Modo estrito: variável não declarada não chega à tarefa. Suíte nova com banco próprio **declara a variável dela** em `turbo.json` |
| **`verify` divergir do CI** | Passa local, quebra no CI | `verify` roda exatamente o que o CI roda. Se o CI usa `test:cov`, `verify` também |
| **Dinheiro virando `double`** | Centavo somindo no fechamento | Dinheiro trafega como **texto** de inteiro (ADR-0019). `JSON.parse` transforma número em `double` |
| **CI rodando duas vezes** | 4 checks por push | Gatilho é `push:` puro. `push` + `pull_request` na mesma branch duplica |
| **Tamanho do artefato como prova de conteúdo** | Portão verde com peça faltando | `instalador.yml` conferia "o `.exe` tem 100 MB". Passa com o Postgres dentro e o `psql.exe` fora, e a compressão sólida move o limiar a cada dependência nova. **Confira os arquivos que importam, um a um** |
| **`pnpm deploy` não leva binário baixado** | `engine not found` na máquina do cliente | `deploy` remonta a árvore do armazém de pacotes; o que o `postinstall` baixou depois **não está lá**. Binário nativo de que a instalação depende é copiado explicitamente no workflow |
| **`npx` numa instalação embarcada** | Falha na loja sem internet | A instalação embarca só o `node.exe`. Nada de `npm`, `npx` ou download em tempo de instalação: o que for preciso viaja dentro do instalador |
| **Reinstalar regenerando segredo** | Vendas intactas e inalcançáveis | Instalador que gera senha nova por cima de banco existente destrói o **acesso** sem destruir o dado — nem o backup resolve. Segredo de instalação anterior é sempre preservado (`lerSegredosDoEnv`) |
| **Reinstalar por cima de serviço no ar** | Enxurrada de "erro ao abrir o arquivo pra gravação", uma por DLL | O serviço do banco segura os próprios binários. Quem clica em "Ignorar" fica com **binários de duas versões misturados**, e o estrago aparece longe da causa. O NSIS para os dois serviços **antes** do `File /r` |
| **API pronta sem tela que a chame** | Função "completa" que o usuário não alcança | `POST /api/caixa/abrir` existia desde sempre, testada, sem **nenhuma** tela chamando: o operador entrava, bipava e levava "abra o caixa antes de iniciar uma venda", sem lugar onde abrir. Achado na primeira instalação real. Ao dar um módulo por pronto, confira que cada rota tem quem a chame |
| **200 no HTML não prova que a tela abre** | Página em branco, documento respondendo 200 | A retaguarda pedia `/assets/…` absoluto e recebia o 404 do PDV. Conferir o status do documento não pega: é preciso buscar **o que o HTML referencia**. O `base` do Vite é `/retaguarda/`, e o workflow reprova se o `index.html` apontar para a raiz |
| **`nssm install` com caminho que tem espaço** | Serviço em laço de reinício, depois `Paused`; "o sistema não respondeu" | `nssm install <svc> <exe> <args>` junta os argumentos **sem re-aspar**: o Node recebia `C:\Program` e morria. O script vai em `AppParameters` com aspas literais (`$\"`) |
| **Carga sem `package.json`** | Node sobe por detecção de sintaxe e procura configuração até `C:\` | `"type": "module"` precisa estar ao lado do `index.js`. O `package.json` do `pnpm deploy` viaja junto, e a conferência do workflow o exige |
| **`initdb` em `Program Files`** | `alterando permissões no diretório existente … falha` | O `initdb` cria um **token restrito** sem o grupo Administradores e se re-executa; `Program Files` só dá escrita a esse grupo. Dado de serviço vai em `C:\ProgramData` |
| **`.nsi` sem BOM** | `Anote o cÃ³digo 1` na tela do lojista | O `makensis` lê como ACP quando não há BOM UTF-8. O log do build diz qual usou: `(ACP)` contra `(UTF8)` |
| **`.env` que ninguém lê** | Serviço morre na partida; verificação diz "não respondeu" | O Node **não** lê `.env` sozinho — exige `--env-file`, e o serviço sobe com `node index.js` e mais nada. `index.ts` chama `carregarArquivoDeAmbiente` ao lado do executável. Só apareceu porque a carga foi **executada**, não lida |
| **Caminho longo do pnpm no Windows** | `File: failed opening file` no meio do NSIS | O armazém `.pnpm` põe o nome do pacote com hash no caminho e passa de 230 caracteres, contra o limite de 260. `NPM_CONFIG_NODE_LINKER=hoisted` no `deploy`, e o workflow reprova qualquer caminho relativo acima de 180 |
| **Comparação de 32 bits no NSIS** | Recusa a máquina mais folgada | `${DriveSpace}` em kilobytes estoura em disco de 4 TB e vira negativo. Medir em megabytes |
| **Banco em `Program Files`** | `initdb` falha em "alterando permissões no diretório existente" | Ao ver privilégio de administrador, o `initdb` cria um **token restrito** sem o grupo Administradores — justamente o único com escrita ali. Dado de serviço vai em `C:\ProgramData`, e a pasta do cluster é criada **pelo `initdb`**, nunca antes |
| **`.nsi` UTF-8 sem BOM** | `código` vira `cÃ³digo` na tela do lojista | `Unicode true` diz respeito ao instalador gerado, não à leitura do script: sem BOM o `makensis` lê como ACP (o log do build diz `(ACP)`) |
| **Aviso de commit "Unverified"** | Hook aponta `8ba140f` | Falso positivo: é o merge commit do próprio GitHub. **Não reescrever** — está em `main` e exigiria force-push |
| **Dublê guarda referência, não cópia** | Teste de unicidade passa quando deveria falhar | O repositório em memória devolve a **mesma instância** que o caso de uso acabou de alterar. Verificação de duplicidade tem de vir **antes** da mutação — o que também é o certo contra o banco de verdade |
| **`unbound-method` em fábrica de objeto de valor** | Lint reprova `interpretarOpcional(x, Telefone.criar, erros)` | Passar método estático solto desassocia o `this`. Embrulhe: `(valor) => Telefone.criar(valor)` |
| **`/* v8 ignore next */` cobre uma linha só** | Guarda inalcançável de 3 linhas reprova a cobertura | Use `/* v8 ignore next 3 */` quando o `if` inalcançável tem corpo |
| **`.env` sumido em ambiente novo** | `P1012: Environment variable not found: DATABASE_URL` | O `.env` é ignorado pelo git e não sobrevive a um contêiner novo. Recrie: `cp packages/database/.env.example packages/database/.env` |
| **`prisma migrate dev` trava sem saída** | Comando fica parado; matá-lo deixa `P1002: timed out acquiring advisory lock` | `migrate dev` é **interativo** (pede nome da migração). Em sessão automatizada use `pnpm db:deploy`. Se já travou, mate o processo e derrube a conexão presa: `pg_terminate_backend` no banco |
| **`as CodigoUnidade` num dado de disco** | `Cannot read properties of undefined (reading 'fracionavel')` no meio da bipada | O domínio procura a unidade numa tabela. Afirmar o tipo sem checar troca recusa clara por tela branca — use `ehCodigoUnidade` antes |
| **Mock de teste desatualizado passa despercebido** | Teste verde com `An error occurred in the <p> component` no log | Ao mudar o que uma função devolve, o dublê que ainda devolve o formato antigo **não** quebra o teste — só faz o React estourar em segundo plano. Ler o log do `test:cov`, não só o placar |
| **`BigInt(texto)` de arquivo externo** | Exceção não tratada em vez de recusa | `BigInt("abc")` **lança**. Todo centavo lido de disco ou rede passa por `/^\d+$/` antes |
| **Variável de cancelamento em laço com `await`** | Lint acusa "value is always falsy" na segunda verificação | O compilador analisa a função de parada antes de ela existir. Leia por função (`const foiCancelado = () => cancelado`) |
| **Só o teste do pacote conta para a cobertura dele** | Consulta exercitada pelo servidor reprova em `packages/database` | Cobertura é medida por pacote. Código novo em `packages/` precisa de teste **naquele** pacote |
| **Docker morre no reinício do contêiner** | `P1001: Can't reach database server` e testes pulados em silêncio | `nohup dockerd > /tmp/dockerd.log 2>&1 &` e `docker compose up -d`. Suíte que não alcança o banco é **pulada**, não reprovada — verde enganoso |
| **Teste de desempenho com número cravado** | Verde local, vermelho no CI, sem nada ter mudado | Limite absoluto (`toBeLessThan(1000)`) mede a **máquina**, não o código: o runner roda dez pacotes em duas vCPUs e entregou 1.072 ms num trecho que leva ~200 ms ocioso. Guarde **ordem de grandeza** com teto folgado, e prove o que importa comparando duas medidas da mesma execução |
| **Ordenação sem desempate** | Consulta devolve uma ordem local e outra no CI, sem nada ter mudado | `ORDER BY` só por instante deixa a sequência a cargo do plano de execução quando há empate — e empate é normal: uma nota de entrada grava todos os itens no mesmo `ocorrido_em`. Desempate com o id, que é UUIDv7 e portanto monotônico (ADR-0008) |
| **Formulário grande digitado tecla a tecla estoura o CI** | Verde local, `Test timed out in 5000ms` no runner — e o estouro **contamina os casos seguintes**, que falham com valor de outro teste | `userEvent.type` re-renderiza o formulário a cada caractere. Em tela com mais de dez campos, preencha com `fireEvent.change` e guarde o teclado para o campo que o caso investiga (máscara, atalho). O sintoma enganoso é o teste **vizinho** falhando |
| **Componente de design system criado duas vezes** | Conflito `add/add` no merge, com duas APIs para a mesma coisa | Em 01/08/2026 duas sessões criaram `CampoSelecao` — uma com `value`/`onChange`, outra com `valor`/`aoMudar`. Antes de criar componente em `packages/ui`, rode `git log origin/main --oneline -20` e `ls packages/ui/src/componentes`. Quem chega depois **adota o que está em `main`** e estende, em vez de defender o seu |
| **`corpos[0]` capturando a chamada errada** | Teste "não chamou nada" falha sem motivo aparente | `ProvedorSessao` consulta `/api/acesso/eu` ao montar. Filtre o dublê de `fetch` pela rota que interessa |
| **403 confundido com 401** | Cliente tenta renovar token e joga o operador no login | Sem token é **401**; sem alçada é **403**. Trocar faz o operador achar que a sessão caiu |

---

## 4. Decisões que não se reabrem sem ADR

Resumo; a fonte é `CLAUDE.md` §5 e `docs/adr/`.

- PostgreSQL 17 único, embarcado no instalador — **sem SQLite como sistema de registro**
  (ADR-0013). A contingência do PDV é **arquivo append-only, não SQLite** (ADR-0021).
- `@erp/cliente-api` é compartilhado entre retaguarda e PDV (ADR-0020).
- Fiscal via **provedor externo** atrás da porta `ProvedorFiscal`; o ERP nunca fala com
  SEFAZ nem conhece o fornecedor (ADR-0015).
- Módulo fiscal **opcional por empresa**, via Null Object. O domínio não tem
  `if (fiscalHabilitado)` (ADR-0016).
- Escopo é **varejo apenas**. Serviços, Ordem de Serviço e NFS-e estão **fora**
  (ADR-0014). Emite só NFC-e (65) e NF-e (55).
- Um papel por usuário (ADR-0018). PIN no PDV, senha forte na retaguarda (ADR-0011).
- **Sem a permissão base, limite não se discute**: o operador de caixa não sangra
  a gaveta nem com supervisor ao lado — ele **chama** o supervisor, que executa com
  a própria conta. A escalação por supervisor só vale para quem tem a permissão e
  estoura o teto de valor (`PoliticaAutorizacao`).
- **A contagem do fechamento é às cegas.** Nem a tela nem a API entregam o esperado
  em dinheiro antes de o operador contar — conferência com a resposta à vista não
  detecta falta nenhuma.
- Dinheiro em centavos `bigint` (ADR-0009). Quantidade em milésimos. Percentual em
  centésimos de por cento — 5% é `500`.

---

## 5. Ambiente de desenvolvimento

```bash
pnpm install
cp packages/database/.env.example packages/database/.env   # não vem do git
pnpm db:up          # PostgreSQL 17 na porta 55432 (três bancos)
pnpm db:deploy      # aplica migrações; `db:migrate` é interativo, ver §3
pnpm verify         # suíte completa

pnpm --filter @erp/server dev   # API   → 3000
pnpm --filter @erp/web dev      # web   → 5173
pnpm --filter @erp/pdv dev      # PDV   → 5174
```

**Se o Docker estiver morto** (acontece após reinício do contêiner):

```bash
nohup dockerd > /tmp/dockerd.log 2>&1 &
sleep 5 && docker compose up -d
```

**Se o `docker compose up` não conseguir baixar a imagem** (aconteceu em 31/07/2026:
o proxy de saída recusou `production.cloudfront.docker.com` com 403), há um PostgreSQL
instalado no próprio contêiner. Serve para rodar a suíte, com a ressalva de ser a
versão **16**, e não a 17 do ADR-0013 — divergência aceitável para desenvolvimento,
nunca para validar migração antes de release:

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER SYSTEM SET port = 55432;\""
pg_ctlcluster 16 main restart
su postgres -c "psql -p 55432 -c \"CREATE USER erp WITH PASSWORD 'erp_dev_only' SUPERUSER;\""
su postgres -c "psql -p 55432 -c 'CREATE DATABASE erp_pdv OWNER erp;' \
  -c 'CREATE DATABASE erp_teste OWNER erp;' -c 'CREATE DATABASE erp_teste_api OWNER erp;'"
DATABASE_URL="postgresql://erp:erp_dev_only@localhost:55432/erp_pdv" pnpm db:deploy
```

---

## 6. Ordem de leitura para entrar no projeto

1. `CLAUDE.md` — diretrizes permanentes. **Prevalece sobre qualquer outra coisa.**
2. Este arquivo — onde o trabalho parou.
3. `docs/ARQUITETURA.md` — fonte da verdade técnica.
4. `docs/adr/README.md` — por que cada decisão foi tomada.

> **Manter este arquivo atualizado é parte da etapa 9 do fluxo** (`CLAUDE.md` §3:
> "Documentar a etapa"). Uma sessão que avança e não atualiza o `ESTADO.md` recria
> exatamente o problema que ele existe para evitar.

### Isto já aconteceu — atualize ao final de cada etapa, não só ao parar

Em 31/07 uma sessão escreveu aqui "trabalho em andamento na branch X, 1.296 testes" e
seguiu por mais oito commits sem voltar. No dia seguinte a branch não existia mais, eram
1.714 testes, e três itens listados como pendentes já estavam prontos — persistência, API
e telas dos cadastros. Quem lesse refaria trabalho concluído.

**Documento desatualizado engana com a autoridade de estar no lugar certo.** O `README.md`
sobreviveu porque foi atualizado a cada etapa; este arquivo não foi. A regra prática:
o commit que conclui uma etapa é o mesmo commit que atualiza o `ESTADO.md`.
