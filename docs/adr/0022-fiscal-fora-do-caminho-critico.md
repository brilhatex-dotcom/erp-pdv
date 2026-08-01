# ADR-0022 — Fiscal fora do caminho crítico, com provedor simulado completo

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 01/08/2026 |
| **Decisores** | Responsável pelo produto · Arquiteto · Analista de Negócios · Especialista Fiscal BR |
| **Relacionado** | Confirma e estende [ADR-0015](0015-emissao-fiscal-via-provedor-externo.md) e [ADR-0016](0016-modulo-fiscal-opcional-por-empresa.md) |

## Contexto

O ADR-0015 já decidiu que a emissão passa por uma API fiscal externa atrás da
porta `ProvedorFiscal`, e o ADR-0016 que o módulo é opcional por empresa, via
Null Object. As duas decisões continuam valendo, inalteradas.

O que faltava era uma decisão de **sequenciamento**, e ela vinha sendo tomada por
omissão: o roteiro tratava o fiscal como o próximo passo natural, o que fazia a
primeira versão do produto depender de contratar uma API fiscal e obter
certificado — duas coisas que não dependem de desenvolvimento e têm prazo
próprio.

Na prática isso transformava um fornecedor externo em bloqueador da entrega.

## Decisão

**O módulo fiscal não bloqueia o desenvolvimento nem a primeira entrega.**

1. Todo o restante do ERP é concluído primeiro — cadastros, compras, vendas,
   PDV, caixa, financeiro, relatórios, instalador.
2. Enquanto a API fiscal não estiver contratada, o produto usa um
   **`ProvedorFiscalSimulado`** que exercita o contrato inteiro: emissão
   autorizada, rejeição, cancelamento, inutilização, retorno de XML, DANFE,
   contingência e eventos.
3. **O instalador Windows não depende do módulo fiscal.** Uma instalação com
   provedor simulado é instalação válida para demonstração, homologação e
   implantação.
4. A integração com provedor real — Focus NFe, TecnoSpeed, eNotas, NFE.io ou
   outro — entra depois, e é **escrever um adapter**: nenhuma regra de negócio
   muda.

## Por que o simulado precisa ser completo, e não um esboço

Um simulado que só responde "autorizado" prova apenas o caminho feliz — que é o
único que nunca dá trabalho. O que quebra em produção é o resto: a rejeição que
chega com código que ninguém previu, o cancelamento fora do prazo, a
contingência que precisa ser assumida no meio do expediente.

Simulando **todos** os desfechos desde já, o dia da integração real vira
substituição de adapter com a suíte inteira já cobrindo os casos difíceis. Se o
simulado for pobre, esse dia vira descoberta — e descoberta com cliente
instalado é a pior forma de descobrir.

## Consequências

### Positivas

- A primeira versão do produto deixa de depender de fornecedor externo.
- O instalador pode existir antes de qualquer contrato fiscal.
- A troca de provedor fica exercitada por construção: o simulado é o segundo
  implementador da porta, e porta com dois implementadores é porta testada.

### Negativas — o custo aceito, declarado honestamente

- Uma instalação com provedor simulado **não emite documento fiscal válido**.
  Serve para demonstração, homologação e implantação; não serve para uma loja
  operar legalmente. Isso precisa estar claro para quem vende o produto.
- Existe risco de o contrato real revelar um comportamento que o simulado não
  previu. Ele é reduzido, não eliminado, por simular todos os desfechos.

### Neutras

- Nenhuma mudança no domínio: ele já não conhece fiscal (ADR-0016).

## Como reverter

Bastaria voltar a tratar o fiscal como bloqueador da entrega. Nada no código
precisaria mudar — o simulado continuaria existindo como dublê de teste, que é
seu segundo uso.
