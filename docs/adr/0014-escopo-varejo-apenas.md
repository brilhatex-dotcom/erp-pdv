# ADR-0014 — Escopo restrito a varejo; prestação de serviços fora do produto

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 30/07/2026 |
| **Decisores** | Responsável pelo produto · Analista de Negócios · Especialista Fiscal BR · Arquiteto |

## Contexto

A lista inicial de segmentos-alvo incluía **oficinas de motos** junto a nove segmentos
de varejo (mercadinhos, padarias, mercearias, casas de construção, autopeças,
conveniência, depósitos, açougues, hortifrutis).

A análise em `docs/ANALISE-SEGMENTOS.md` mostrou que oficina não é uma variação do
varejo — é outro modelo de negócio:

| Aspecto | Varejo | Oficina |
|---|---|---|
| O que vende | Mercadoria | Mercadoria **+ mão de obra** |
| Documento fiscal | NFC-e (65) — estadual | **NFS-e** — municipal |
| Fluxo | Venda imediata | OS: aberta → em execução → concluída → faturada |
| Duração | Segundos | Dias |
| Interface | PDV teclado-first | Tela de OS, orientada a acompanhamento |

O ponto decisivo é o fiscal: **NFS-e é municipal**. Cada município tem seu padrão,
seu webservice e suas regras. O padrão nacional está em implantação, mas a base
instalada real continua fragmentada. Isso é, isoladamente, um dos maiores focos de
custo de suporte em ERPs brasileiros — e não reaproveita quase nada do pipeline de
NFC-e além da assinatura digital.

Servir a oficina exigiria: módulo de Ordem de Serviço, integração NFS-e e uma segunda
interface — para atender **1 de 10** segmentos.

## Decisão

**Este produto é exclusivamente de varejo — venda de mercadoria.** Prestação de
serviços, Ordem de Serviço e oficina ficam fora do escopo e serão atendidas por um
sistema separado no futuro.

Consequência fiscal direta: **NFS-e sai do roteiro.** O produto emite apenas
**NFC-e (modelo 65)** e **NF-e (modelo 55)**, ambos estaduais e com pipeline
compartilhado.

## Alternativas consideradas

### A. Incluir oficina na Fase 1 — rejeitada
Aumentaria significativamente o escopo do MVP e adiaria a primeira venda, para atender
a um décimo do mercado-alvo.

### B. Incluir oficina na Fase 2 — rejeitada
Manteria a complexidade de NFS-e no roteiro do produto, contaminando o planejamento e
o posicionamento comercial sem necessidade.

### C. Produto separado no futuro — **escolhida**
Concentra este produto num único fluxo bem resolvido e permite que um eventual sistema
de serviços reaproveite `@erp/domain` (catálogo, estoque, pessoas), `@erp/database`,
`@erp/printing` e a assinatura digital de `@erp/fiscal`.

## Consequências

### Positivas

- **Roteiro fiscal muito mais simples:** dois modelos estaduais em vez de dois estaduais
  mais centenas de padrões municipais.
- **`Venda` permanece um agregado de ciclo curto**, o que mantém o PDV simples e rápido —
  requisito central do produto.
- **Uma única interface de venda**, sem segunda tela para OS.
- Os nove segmentos restantes compartilham **o mesmo fluxo**, concentrando o esforço num
  caminho excelente em vez de dois medianos.
- Time to market menor.

### Negativas — custos aceitos

- Oficinas, lava-jatos, salões e assistências técnicas ficam fora do mercado endereçável
  deste produto.
- Um cliente misto (loja que também presta serviço) não é atendido integralmente.

### Neutras

- A arquitetura hexagonal permanece capaz de acomodar OS e NFS-e caso a decisão mude —
  como contexto novo e novo adapter `EmissorFiscal`, sem tocar no núcleo.

## Como reverter

Se a pesquisa comercial mostrar demanda relevante de estabelecimentos mistos, a
reversão é aditiva: novo contexto `servicos/` no domínio, adapter `NFSeEmissor` e uma
tela de OS. Nenhuma decisão tomada até aqui impede essa evolução — o que a torna uma
decisão de escopo, não uma decisão irreversível de arquitetura.
