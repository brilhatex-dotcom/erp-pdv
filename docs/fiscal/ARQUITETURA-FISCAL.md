# Arquitetura Fiscal — Provedor Externo Desacoplado

| Campo | Valor |
|---|---|
| **Versão** | 1.0 |
| **Data** | 30/07/2026 |
| **Status** | Projeto aprovado — implementação na Etapa 9 |
| **Decisão** | ADR-0015 (provedor externo) · ADR-0016 (módulo opcional) |
| **Escopo desta fase** | **Projeto apenas.** Nenhuma comunicação com SEFAZ ou com provedor é implementada agora |

---

## 1. A decisão e por que ela está certa

O ERP **não implementa comunicação direta com a SEFAZ**. A emissão fiscal acontece
através de uma **API fiscal especializada**, atrás de uma abstração (`ProvedorFiscal`)
que impede o ERP de conhecer qualquer detalhe do fornecedor escolhido.

```
┌─────────────────────────────────────────┐
│  ERP / PDV  (regras de negócio)         │  ← nunca conhece o provedor
└──────────────────┬──────────────────────┘
                   │ evento VendaFinalizada
┌──────────────────▼──────────────────────┐
│  Módulo Fiscal  (@erp/fiscal)           │  ← orquestra, enfileira, controla estado
└──────────────────┬──────────────────────┘
                   │ porta ProvedorFiscal
┌──────────────────▼──────────────────────┐
│  Adapter do provedor                    │  ← ÚNICO lugar que conhece o fornecedor
│  FocusNFe · PlugNotas · NuvemFiscal ...  │
└──────────────────┬──────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────┐
│  API fiscal → SEFAZ                     │
└─────────────────────────────────────────┘
```

### Avaliação do comitê

| Papel | Posição | Justificativa |
|---|---|---|
| **Analista de Negócios** | ✅ Forte a favor | Reduz o bloco fiscal de 5–8 sessões para 2–3. Antecipa o produto ao mercado em semanas |
| **Fiscal BR** | ✅ A favor, com uma ressalva | O provedor absorve mudanças de layout, notas técnicas e a Reforma Tributária — que é trabalho contínuo, não pontual. Ressalva na §5 (contingência) |
| **Segurança** | ✅ A favor | Deixa a custódia do certificado com quem tem estrutura para isso. Ver §6 |
| **DevOps** | ✅ A favor | Elimina certificação junto à SEFAZ, manutenção de XSD e monitoramento de 27 UFs |
| **Arquiteto** | ✅ A favor | A porta já estava prevista (ADR-0006). Muda o adapter, não a arquitetura |
| **QA** | ⚠️ Atenção | Testar passa a exigir simulação do provedor. Resolvido com adapter falso |
| **DBA** | ⚪ Neutro | Sem impacto no modelo de dados |

**O que sustenta a decisão:** implementar SEFAZ direto significa manter, para sempre,
27 conjuntos de endpoints, validação de XSD versionado, assinatura XMLDSig, e
acompanhar cada nota técnica. Não é custo de construção — é **custo perpétuo de
manutenção**, e ele recai sobre um time pequeno. Terceirizar isso é a decisão
economicamente correta para este produto.

---

## 2. Análise de custo — a informação que decide

> ⚠️ **Valores levantados em 30/07/2026 e sujeitos a mudança.** Antes de fechar
> contrato, confirmar diretamente com cada fornecedor. Esta seção existe para mostrar
> o **modelo de cobrança** e a variável que realmente importa, não para fixar preço.

### 2.1 A variável decisiva: volume de NFC-e

Este é o ponto que costuma ser descoberto tarde demais:

| Documento | Quem emite | Volume mensal típico |
|---|---|---|
| NF-e (55) | Indústria, atacado, B2B | **dezenas** |
| **NFC-e (65)** | **Varejo — uma por venda** | **milhares a dezenas de milhares** |

Um mercadinho com 200 vendas/dia emite **~6.000 NFC-e/mês**. Um mercado movimentado
com 2.000 vendas/dia emite **~60.000/mês**.

**Consequência:** modelo de cobrança por documento, que é irrelevante para NF-e, pode
inviabilizar o negócio em NFC-e. A R$ 0,05 por documento, 60.000 notas custam
**R$ 3.000/mês** — mais que o próprio ERP.

Referência de mercado levantada: a Nuvem Fiscal parte de **R$ 360/mês** (pagamento
anual) para **10.000 operações fiscais/mês**, com faixa seguinte em 100.000 operações.
Cancelamento e inutilização **também contam** como operação.

### 2.2 As duas formas de estruturar o negócio

Esta é uma decisão comercial sua, e muda completamente quem paga o quê:

| | **Modelo A — Você contrata** | **Modelo B — Cliente contrata** |
|---|---|---|
| Quem paga o provedor | Você | Cada cliente |
| Custo recorrente para você | **Alto e crescente** | **Zero** |
| Preço ao cliente | ERP + fiscal embutido | Só o ERP |
| Implantação | Simples: já vem funcionando | Cliente precisa abrir conta |
| Risco de margem | **Seu** — volume do cliente corrói sua margem | Do cliente |
| Negociação de volume | Você agrega e negocia melhor | Cada um paga tabela cheia |
| Se o cliente vende muito | Você perde dinheiro | Cliente paga mais, você não sente |

**Recomendação: Modelo B como padrão, Modelo A como opção comercial.**

O motivo é de sobrevivência do negócio: no Modelo A, um único cliente que cresça
transforma um contrato lucrativo em prejuízo, e você não controla o volume dele.
No Modelo B, seu custo é zero e previsível — você vende software, não intermedia
custo fiscal variável.

O Modelo A vira interessante depois, quando houver base instalada suficiente para
negociar volume e transformar a diferença em margem. **A arquitetura suporta os dois
sem alteração**: no Modelo B, a tela de configuração recebe as credenciais do cliente;
no Modelo A, recebe as suas.

### 2.3 Alternativas completas, com impacto financeiro

| Alternativa | Custo p/ você | Custo p/ cliente | Esforço | Risco |
|---|---|---|---|---|
| **A. Provedor, cliente paga** ⭐ | **R$ 0** | Plano do provedor | 2–3 sessões | Baixo |
| **B. Provedor, você paga e revende** | Plano por volume agregado | Embutido na mensalidade | 2–3 sessões | **Margem corroída por volume** |
| **C. SEFAZ direto (própria)** | **R$ 0 recorrente** | **R$ 0** | **8–14 sessões + manutenção perpétua** | **Alto** — cada nota técnica é urgência |
| **D. Híbrido: provedor agora, própria depois** | R$ 0 agora | Plano do provedor | 2–3 agora, 8–14 depois | Baixo agora |
| **E. Sem módulo fiscal** | R$ 0 | R$ 0 | 0 | Limita o mercado |

**Nota honesta sobre a alternativa C:** ela é a única com custo recorrente zero, e por
isso não deve ser descartada para sempre. Se a base instalada crescer muito, o custo
agregado que os clientes pagam ao provedor pode justificar internalizar. **A abstração
desta arquitetura é exatamente o que mantém essa porta aberta** — migrar seria escrever
um novo adapter, sem tocar em nada mais.

A alternativa **E** também é real: parte do público-alvo (MEI, comércio muito pequeno)
opera sem emissão fiscal. Por isso o módulo é **opcional** (§4).

---

## 3. A porta `ProvedorFiscal`

### 3.1 Princípio: Anti-Corruption Layer

O ERP fala **a sua própria linguagem**. O JSON do fornecedor, seus códigos de erro e
seu vocabulário param no adapter. Se o formato do provedor vazasse para dentro, trocar
de fornecedor deixaria de ser trocar um adapter.

```ts
// packages/application/src/portas/servicos/ProvedorFiscal.ts
export interface ProvedorFiscal {
  /** Identificação para log e diagnóstico. */
  readonly nome: string;

  /** O que este provedor sabe fazer — permite degradar em vez de falhar. */
  readonly capacidades: CapacidadesProvedor;

  emitir(comando: ComandoEmissao): Promise<Result<DocumentoEmitido, ErroFiscal>>;
  consultar(ref: ReferenciaDocumento): Promise<Result<SituacaoDocumento, ErroFiscal>>;
  cancelar(cmd: ComandoCancelamento): Promise<Result<EventoConfirmado, ErroFiscal>>;
  inutilizar(cmd: ComandoInutilizacao): Promise<Result<EventoConfirmado, ErroFiscal>>;

  obterXml(ref: ReferenciaDocumento): Promise<Result<string, ErroFiscal>>;
  obterDanfe(ref: ReferenciaDocumento): Promise<Result<Uint8Array, ErroFiscal>>;

  /** Consultado antes de transmitir; alimenta o circuit breaker. */
  verificarSaude(): Promise<Result<StatusProvedor, ErroFiscal>>;
}

export interface CapacidadesProvedor {
  readonly modelos: readonly ModeloDocumento[];   // 55, 65
  readonly contingenciaOffline: boolean;          // 🔑 ver §5
  readonly custodiaCertificado: boolean;          // 🔑 ver §6
  readonly danfePdf: boolean;
  readonly webhookRetorno: boolean;
}
```

### 3.2 Idempotência é obrigatória

Todo comando carrega a **referência interna** — o `Identificador` UUIDv7 do documento
no ERP. Reenviar após timeout **não pode** gerar duas notas.

```ts
export interface ComandoEmissao {
  readonly referenciaInterna: Identificador;  // 🔑 chave de idempotência
  readonly modelo: ModeloDocumento;
  readonly emitente: DadosEmitente;
  readonly destinatario?: DadosDestinatario;
  readonly itens: readonly ItemFiscal[];
  readonly pagamentos: readonly PagamentoFiscal[];
  readonly serie: number;
  readonly numero: number;
  readonly ambiente: AmbienteFiscal;
}
```

Emitir duas vezes a mesma venda é o pior defeito possível deste módulo: gera obrigação
tributária em duplicidade, e desfazer exige cancelamento dentro de prazo legal curto.

### 3.3 Erros normalizados, nunca códigos do fornecedor

```ts
export type CategoriaErroFiscal =
  | "REJEICAO_VALIDACAO"     // dado errado — corrigir e reemitir
  | "REJEICAO_CADASTRAL"     // emitente/destinatário irregular na SEFAZ
  | "DUPLICIDADE"            // já emitida — consultar, não reemitir
  | "SERVICO_INDISPONIVEL"   // SEFAZ ou provedor fora — contingência
  | "CREDENCIAL_INVALIDA"    // token/certificado — exige ação do administrador
  | "CERTIFICADO_VENCIDO"
  | "LIMITE_PLANO_EXCEDIDO"  // 🔑 estourou a franquia contratada
  | "ERRO_INTERNO_PROVEDOR";
```

Cada categoria tem tratamento distinto: `REJEICAO_VALIDACAO` não deve ser retentada,
`SERVICO_INDISPONIVEL` deve, e `LIMITE_PLANO_EXCEDIDO` precisa alertar o responsável
**antes** de a loja parar de emitir.

---

## 4. Módulo fiscal opcional por empresa

### 4.1 Como o desligamento funciona sem contaminar o código

**O domínio não tem `if (fiscalHabilitado)`.** Quem decide é a composição:

```
ConfiguracaoFiscal.ativo === false
        ↓
container registra  ProvedorFiscalNulo
        ↓
FinalizarVenda publica VendaFinalizada normalmente
        ↓
manipulador fiscal não encontra provedor ativo → não enfileira
        ↓
PDV imprime "RECIBO — SEM VALOR FISCAL"
```

É o padrão **Null Object**, já previsto na arquitetura. Consequência prática: **todo o
resto do sistema funciona idêntico** — venda, estoque, caixa, relatórios, backup. A
Empresa B do exemplo usa o ERP inteiro sem nunca tocar no módulo fiscal.

### 4.2 O que muda com o módulo desligado

| Área | Com fiscal | Sem fiscal |
|---|---|---|
| Venda, estoque, caixa | idêntico | idêntico |
| Impressão | DANFE NFC-e com QR Code | Recibo sem valor fiscal |
| Tela de configuração fiscal | visível | oculta |
| Relatórios fiscais | disponíveis | ocultos |
| Guarda de XML | 5 anos | não se aplica |

### 4.3 Regra de produto

Ligar o módulo depois **não pode exigir reinstalação nem migração de dados**. A venda
já gravada permanece válida; passam a ter documento fiscal apenas as vendas seguintes.

---

## 5. ⚠️ Contingência offline — o critério que deve decidir o fornecedor

**Este é o ponto técnico mais importante desta arquitetura, e o que mais influencia a
escolha do provedor.**

O princípio 1 do projeto é *o PDV nunca para*. Uma API fiscal em nuvem exige internet.
A pergunta é: **o que acontece quando a loja está sem internet e o cliente está no
balcão esperando?**

### 5.1 As três posturas possíveis

| Postura | Como funciona | Consequência |
|---|---|---|
| **1. Provedor com componente local** | Um módulo instalado na loja gera e assina o XML em contingência offline (`tpEmis=9`), imprime o DANFE de contingência e transmite depois | ✅ Cumpre a lei e o princípio 1. **Postura preferida** |
| **2. Fila com recibo não fiscal** | A venda conclui, imprime recibo comum, e a NFC-e é emitida quando a internet volta | ⚠️ A venda nunca para, mas o cliente sai **sem documento fiscal no momento** |
| **3. Bloquear a venda** | Espera a internet | ❌ **Inaceitável.** Viola o princípio 1 |

A postura 3 está descartada por decisão de arquitetura. A escolha real é entre 1 e 2.

### 5.2 Por que isso muda a escolha do fornecedor

Contingência offline **exige gerar e assinar o XML localmente**, porque o DANFE precisa
sair impresso, com chave de acesso válida, no instante da venda. Um provedor
exclusivamente em nuvem **não consegue** fazer isso — não por limitação do produto, mas
por física: sem internet, não há como chamá-lo.

Alguns fornecedores oferecem exatamente esse componente local. O **PlugNotas
(TecnoSpeed)** documenta um módulo chamado **NeverStop**, descrito como capaz de emitir
NFC-e sem internet e com a SEFAZ indisponível, transmitindo e regularizando
automaticamente quando a conexão retorna.

> **Recomendação:** tratar *"suporta contingência offline de NFC-e"* como **requisito
> eliminatório** na escolha, e não como diferencial. Para o público-alvo — comércio de
> bairro, internet instável — a postura 2 gera atrito recorrente no balcão, que é
> exatamente o tipo de coisa que vira chamado de suporte e má reputação.

### 5.3 Como a arquitetura acomoda as duas

A flag `capacidades.contingenciaOffline` permite ao módulo fiscal **degradar de forma
consciente**:

```
sem internet + provedor com contingência local  → emite NFC-e em contingência
sem internet + provedor só nuvem                → recibo não fiscal + fila
```

O PDV não muda. Quem decide é o módulo fiscal, conforme a capacidade declarada.

> ⚠️ Prazos de transmissão de contingência e sua aceitação **variam por UF** e mudam com
> frequência. Validar com o contador do cliente antes de ir a produção.

---

## 6. Certificado digital — o certificado é do cliente

### 6.1 Princípio de custódia

O certificado A1 é a **identidade fiscal da empresa cliente**. Quem o possui pode
emitir documentos em nome dela. Isso não é um dado de configuração — é uma credencial
com efeito jurídico.

**Decisão: sempre que o provedor oferecer custódia, o certificado é enviado a ele e
o ERP não o armazena.**

```
Tela de configuração  →  upload do .pfx + senha
        ↓
ERP encaminha ao provedor (HTTPS, uma única vez)
        ↓
ERP guarda apenas:  impressão digital (hash) · titular · validade
        ↓
Arquivo e senha são DESCARTADOS da memória
```

**Por que isso importa para o senhor, comercialmente:** guardar o certificado de
dezenas de clientes transforma o seu servidor num alvo de altíssimo valor e coloca a
sua empresa na cadeia de custódia de uma credencial jurídica de terceiros. Um
vazamento não seria um incidente técnico — seria emissão de notas fiscais em nome dos
seus clientes. Delegar a custódia a quem tem estrutura para isso **reduz seu risco
legal**, não só o técnico.

### 6.2 Quando o provedor não custodia

Se o provedor exigir o certificado a cada requisição, o ERP mantém um cofre local:

- Cifrado com **AES-256-GCM**, chave derivada por **Argon2id** de senha mestra
- Fora do banco de dados, com permissão restrita ao serviço
- Decifrado apenas em memória, no momento do uso, e descartado em seguida
- **Nunca** em log, **nunca** em API, **nunca** em backup em texto claro

### 6.3 Monitor de validade

Independente de quem custodia, o ERP guarda a data de validade e alerta em **30, 15, 7
e 1 dia**. Certificado vencido para a emissão fiscal da loja — e o cliente sempre
descobre isso na pior hora, com fila no caixa.

---

## 7. Tela de configuração fiscal

Uma tela por empresa, na retaguarda, com permissão `config:fiscal` (apenas ADMIN).

| Campo | Tipo | Observação |
|---|---|---|
| **Módulo fiscal ativo** | liga/desliga | 🔑 controla todo o resto da tela |
| Provedor | seleção | Focus NFe · PlugNotas · Nuvem Fiscal · eNotas · NFE.io |
| Ambiente | Homologação / Produção | Começa **sempre** em homologação |
| Token / credenciais da API | senha | Cifrado em repouso; exibido mascarado |
| Certificado A1 | arquivo `.pfx` | Encaminhado ao provedor quando possível (§6) |
| Senha do certificado | senha | Nunca persistida quando há custódia externa |
| Validade do certificado | leitura | Preenchido automaticamente; base do alerta |
| Regime tributário | seleção | Simples · Presumido · Real |
| Série NFC-e | número | **Uma série por estação de PDV** (§8) |
| Número inicial | número | Continuidade ao migrar de outro sistema |
| Série NF-e | número | |
| CSC (Código de Segurança do Contribuinte) | senha | Obrigatório para NFC-e |
| CSC ID (Token ID) | texto | Identificador do CSC |
| CNAE / Inscrição Estadual | texto | |
| Contingência automática | liga/desliga | Só habilitado se o provedor suportar |

### Regras de usabilidade (não negociáveis)

- **Botão "Testar configuração"** que emite uma nota em homologação e mostra o resultado
  em português claro. Sem isso, o erro só aparece na primeira venda real.
- **Trocar para Produção exige confirmação explícita** e um teste bem-sucedido em
  homologação.
- Nenhum segredo é reexibido depois de salvo — apenas mascarado, com opção de substituir.
- Toda alteração é **auditada**: quem, quando, o que mudou (valor antigo/novo, exceto
  segredos).

---

## 8. Numeração e séries

**Uma série por estação de PDV.** PDV 1 usa série 1, PDV 2 usa série 2. Isso elimina
disputa de numeração entre caixas, inclusive offline — cada estação tem faixa exclusiva
e nunca colide.

O ERP **controla a numeração**, não o provedor. Motivo: numeração fiscal precisa ser
sequencial e sem lacuna por série, e é o ERP quem responde ao Fisco por lacunas. Se o
provedor numerasse, trocar de fornecedor quebraria a sequência.

Números não utilizados são **inutilizados** formalmente, o que exige registrar cada
número emitido, rejeitado ou perdido.

---

## 9. Estratégia de testes

| Camada | Como testar |
|---|---|
| Domínio fiscal | Puro, sem rede. 100% de cobertura obrigatória |
| Porta `ProvedorFiscal` | **`ProvedorFiscalFalso`** — simula autorização, rejeição, timeout, duplicidade, indisponibilidade e estouro de plano |
| Adapter real | Testes de contrato contra o **ambiente de homologação** do provedor |
| Módulo desligado | Suíte completa roda com `ProvedorFiscalNulo`, provando que nada depende do fiscal |

O `ProvedorFiscalFalso` é o que permite testar todos os caminhos de erro **sem
internet, sem certificado e sem custo por documento** — inclusive os que são difíceis
de provocar de propósito num ambiente real.

---

## 10. O que **não** é feito nesta fase

- ❌ Comunicação com SEFAZ
- ❌ Geração e assinatura de XML
- ❌ Adapter de qualquer provedor específico
- ❌ Contratação de fornecedor

Nesta fase existe apenas o **projeto**. A implementação começa pelo
`ProvedorFiscalNulo` e pelo `ProvedorFiscalFalso`, que já permitem o sistema inteiro
funcionar e ser testado ponta a ponta antes de qualquer contrato ser assinado.

---

## 11. Impacto no roteiro

| Antes | Depois |
|---|---|
| Fiscal: **5–8 sessões** (XML, assinatura, 27 UFs, XSD, contingência) | Fiscal: **2–3 sessões** (porta, adapter, configuração) |
| Manutenção perpétua de layout e notas técnicas | Absorvida pelo provedor |
| Certificação junto à SEFAZ | Não se aplica |
| Total até MVP vendável: 35–50 sessões | **30–42 sessões** |

A decisão antecipa o produto e reduz o risco do bloco mais imprevisível do projeto.
