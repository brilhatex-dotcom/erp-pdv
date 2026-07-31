# Análise de Segmentos-Alvo — Impacto no Domínio

| Campo | Valor |
|---|---|
| **Versão** | 1.0 |
| **Data** | 30/07/2026 |
| **Etapa do fluxo** | 1 — Analisar o problema (`CLAUDE.md` §3) |
| **Objetivo** | Identificar requisitos dos segmentos-alvo que afetam o modelo de domínio **antes** da implementação |

---

## 1. Por que esta análise existe

O modelo de domínio é a parte mais cara de mudar depois. Adicionar um campo é barato;
descobrir que "produto" precisava ser **pesável** depois de 5.000 produtos cadastrados,
30.000 vendas emitidas e documentos fiscais autorizados é uma migração de dados com
risco fiscal.

Esta análise percorre os dez segmentos-alvo e classifica cada requisito por **custo de
retrofit** — quanto custa adicionar depois em vez de agora.

---

## 2. Matriz segmento × requisito

Os nove segmentos do produto (oficina de motos foi excluída — ver §5.1):

| Requisito | Merc. | Padaria | Mercearia | Constr. | Autopeças | Conven. | Depósito | Açougue | Hortifruti |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Venda rápida por código de barras | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Produto pesável (balança)** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ |
| **Unidades múltiplas / conversão** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |
| **Quantidade fracionada** | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| **Crediário / fiado** | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ | ✅ | ⬜ |
| **Múltiplas referências por produto** | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| Orçamento antes da venda | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| Entrega / frete | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| Produção / receita (ficha técnica) | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ |
| Validade / lote | ⬜ | ✅ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ✅ | ✅ |
| Controle de idade (bebida/cigarro) | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ⬜ |

**Leitura decisiva:** os nove segmentos compartilham **o mesmo fluxo de varejo**. Nenhum
exige um segundo modelo de venda. Isso concentra o esforço num único caminho bem
resolvido — e é a razão técnica pela qual excluir serviços foi a decisão certa.

---

## 3. Requisitos com **alto** custo de retrofit — decidir agora

### 3.1 Produto pesável e código de barras de balança

**Quem precisa:** açougue, hortifruti, padaria (≈30% dos segmentos-alvo).

**A dor real:** o operador não digita o peso. A balança da seção imprime uma etiqueta com
código de barras **EAN-13 iniciado por `2`**, que carrega dentro dele o código do produto
e o **peso** ou o **preço** já calculado. O caixa bipa e o item entra pronto.

Estrutura típica (varia por configuração da balança):

```
2 PPPPP VVVVV D      2 = prefixo de produto pesável
│ │     │     └── dígito verificador
│ │     └──────── valor: peso em gramas OU preço em centavos
│ └────────────── código interno do produto
└──────────────── prefixo
```

**Por que não dá para adiar:**
- `Quantidade` precisa de **casas decimais** desde o início. Se nascer inteira, todo
  cálculo de total, rateio de desconto e XML fiscal precisa ser refeito.
- O produto precisa saber se é `UNITARIO` ou `PESAVEL`, e qual unidade (`KG`, `UN`, `L`, `M`).
- O parser de código de barras precisa existir **antes** do PDV, porque é parte do fluxo
  de leitura, não um extra.

**Custo agora:** baixo — é um objeto de valor `Quantidade` e um parser testável.
**Custo depois:** alto — migração de dados com implicação fiscal.

> **Recomendação: incluir na Fase 1.** Não como funcionalidade completa de balança, mas o
> **modelo** (`Quantidade` decimal, `TipoProduto`, parser de EAN de balança) precisa nascer
> pronto. A integração com o equipamento pode vir depois sem tocar no domínio.

### 3.2 Unidades múltiplas com conversão

**Quem precisa:** praticamente todos, mas é crítico em construção, depósito e mercearia.

**A dor real:** o depósito **compra** cimento em palete, **estoca** em saco e **vende** em
saco. A mercearia compra refrigerante em fardo de 12 e vende unidade. Se o sistema só
conhece uma unidade, o dono faz a conta na cabeça — e o estoque diverge.

**O modelo correto:** o produto tem uma **unidade base de estoque** (a menor) e unidades
alternativas com **fator de conversão**. Compra em fardo lança 12 unidades no estoque;
venda de 1 unidade baixa 1.

**Por que não dá para adiar:** todo movimento de estoque já gravado estaria na unidade
errada. Não há como inferir retroativamente se "10" eram 10 unidades ou 10 fardos.

> **Recomendação: incluir na Fase 1.** O `MovimentoEstoque` sempre grava na **unidade
> base**; a conversão acontece na entrada do dado. Isso é uma regra de domínio simples se
> nascer junto, e uma reescrita de histórico se vier depois.

### 3.3 Crediário / fiado

**Quem precisa:** mercadinho, mercearia, padaria, açougue, construção, oficina — a
**maioria** dos segmentos.

**A dor real:** a "caderneta" é realidade dominante no varejo de bairro brasileiro. O
cliente leva hoje e paga no dia 10. Hoje isso é feito em papel, e é justamente onde o
dono mais perde dinheiro. **É um dos argumentos de venda mais fortes do produto.**

**O impacto no domínio:** exige uma **forma de pagamento** `CREDIARIO` que não gera
entrada de caixa, uma conta corrente por cliente com limite, e a baixa posterior. Ou seja:
toca `Venda`, `Pagamento`, `SessaoCaixa` (o fechamento **não** pode contar fiado como
dinheiro) e o módulo Financeiro.

**Por que a arquitetura já ajuda:** `FormaPagamento` é uma Strategy (§6.2 da arquitetura).
Adicionar `CREDIARIO` é uma implementação nova — **não** uma mudança estrutural.

> **Recomendação: prever no modelo na Fase 1, implementar o módulo na Fase 2.** O ponto
> inegociável é que o **fechamento de caixa** já saiba distinguir "recebido" de "a receber"
> desde o início. Um fechamento que soma fiado como dinheiro é um defeito grave, e corrigir
> depois significa recalcular histórico de caixa.

---

## 4. Requisitos com **médio** custo de retrofit — Fase 2

### 4.1 Múltiplas referências por produto

**Quem precisa:** autopeças, oficina, construção, depósito.

Uma peça tem: código interno, código do fabricante, código original da montadora, código
de similares e, às vezes, mais de um EAN. O balconista busca por qualquer um deles.

**Impacto:** uma tabela `produto_referencias` (tipo + valor + índice). O modelo de `Produto`
não muda — é relação nova. Retrofit é barato.

### 4.2 Orçamento antes da venda

**Quem precisa:** construção, oficina, autopeças, depósito.

O cliente pede o preço, leva para pensar, volta em dois dias. O orçamento precisa virar
venda sem redigitar.

**Impacto:** `Orcamento` é um agregado próprio que **gera** uma `Venda`. Não altera `Venda`.

### 4.3 Validade e lote

**Quem precisa:** padaria, açougue, hortifruti, conveniência, mercearia.

Perecível vencido é prejuízo direto e risco sanitário.

**Impacto:** lote é um atributo do `MovimentoEstoque`, não do `Produto`. Como o estoque já
é baseado em eventos (ADR-0007), adicionar lote é acrescentar campo ao evento — o
histórico anterior simplesmente não tem lote, o que é aceitável.

---

## 5. Fora do escopo do produto — decisão tomada

### 5.1 Ordem de Serviço (oficina de motos) — ❌ **EXCLUÍDO**

> **Decisão de negócio (30/07/2026): oficina de motos e prestação de serviços em geral
> ficam FORA deste produto.** Serão atendidas por um sistema separado no futuro.
> Este produto é **exclusivamente de varejo — venda de mercadoria**.
>
> **Consequências, todas simplificadoras:**
> - **NFS-e sai do roteiro fiscal.** O produto emite apenas NFC-e (65) e NF-e (55), ambos
>   estaduais e com pipeline compartilhado. Elimina-se a integração com centenas de
>   padrões municipais — que é, isoladamente, um dos maiores focos de custo de suporte
>   em ERPs brasileiros.
> - **Não há mão de obra, agendamento nem ciclo longo.** `Venda` permanece um agregado de
>   ciclo curto, o que mantém o PDV simples e rápido.
> - **Uma única interface de venda.** Não é preciso uma segunda tela para OS.
> - Os nove segmentos restantes compartilham o **mesmo fluxo de varejo**, o que concentra
>   o esforço num único caminho bem resolvido em vez de dois medianos.
>
> A análise abaixo fica registrada como justificativa da exclusão.

**Ordem de Serviço não seria uma extensão — seria um módulo novo, com modelo fiscal
diferente.**

| Aspecto | Varejo (demais segmentos) | Oficina |
|---|---|---|
| O que vende | Mercadoria | Mercadoria **+ mão de obra** |
| Documento fiscal | NFC-e (modelo 65) — estadual | **NFS-e** — municipal, padrão e regras diferentes |
| Fluxo | Venda imediata | OS aberta → em execução → concluída → faturada |
| Duração | Segundos | Dias |
| Estoque | Baixa na venda | Baixa conforme aplicação da peça |

**Consequências reais:**
- **NFS-e é um universo fiscal separado.** Emissão municipal, com o padrão nacional em
  implantação. Não reaproveita quase nada do pipeline de NFC-e além da assinatura digital.
- Ordem de Serviço é um agregado de ciclo longo, com estado, previsão e histórico — o
  oposto da venda de balcão.
- O PDV teclado-first não atende esse fluxo; a oficina precisa de outra tela.

**Avaliação:** incluir oficina no MVP aumentaria significativamente o escopo — módulo de
OS, NFS-e e uma segunda interface — para servir a 1 dos 10 segmentos. **Decidido: excluir
do produto.**

Se um sistema de serviços for construído no futuro, a arquitetura hexagonal permite
reaproveitar `@erp/domain` (catálogo, estoque, pessoas), `@erp/database`, `@erp/printing`
e a assinatura digital de `@erp/fiscal` — sem que este produto carregue a complexidade
enquanto isso.

---

## 6. Requisitos de baixo custo — quando houver demanda

| Requisito | Observação |
|---|---|
| Entrega / frete | Dados adicionais na venda; não altera o modelo |
| Ficha técnica / produção (padaria) | Contexto novo que consome eventos de estoque |
| Controle de idade | Regra de venda: marca no produto + confirmação na tela |

---

## 7. Síntese — o que muda na Fase 1

| # | Mudança proposta no domínio da Fase 1 | Motivo |
|---|---|---|
| 1 | `Quantidade` como objeto de valor **decimal (3 casas)** com unidade | Retrofit exige migração fiscal |
| 2 | `Produto.tipo`: `UNITARIO` \| `PESAVEL` | Define o fluxo de leitura no PDV |
| 3 | Parser de **código de barras de balança** (EAN-13 prefixo 2) | Parte do fluxo de leitura, não extra |
| 4 | **Unidade base + fatores de conversão** no produto | Movimento gravado na unidade errada não se corrige |
| 5 | `FormaPagamento.CREDIARIO` prevista, com **fechamento de caixa distinguindo recebido de a receber** | Fechamento errado corrompe histórico |

**Decisões de escopo tomadas em 30/07/2026:**

| Item | Decisão |
|---|---|
| Oficina de motos / prestação de serviços | ❌ **Fora do produto** — sistema separado no futuro. Produto é exclusivamente varejo |
| NFS-e (fiscal municipal) | ❌ Fora do roteiro — consequência direta da decisão acima |
| Crediário | ✅ **Modelo na Fase 1**, módulo completo na Fase 2 |

**Custo estimado dessas cinco mudanças:** pequeno — são objetos de valor e um parser,
todos puros e testáveis, dentro de `@erp/domain`. Nenhuma delas adiciona complexidade
visível ao usuário. **Custo de não fazer agora:** migração de dados com implicação fiscal.

**Nenhuma dessas mudanças altera as decisões arquiteturais já fechadas** (ADRs 0001 a
0013). São refinamentos do modelo de domínio, dentro do que a arquitetura já previa.
