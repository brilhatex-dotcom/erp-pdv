# ADR-0016 — Módulo fiscal opcional, habilitado por empresa

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 30/07/2026 |
| **Decisores** | Responsável pelo produto · Analista de Negócios · Arquiteto · Fiscal BR |

## Contexto

Parte relevante do público-alvo — MEI, comércio muito pequeno, estabelecimento que
ainda não emite documento fiscal eletrônico — precisa de controle de vendas, estoque e
caixa **sem** emissão fiscal.

Tratar o fiscal como obrigatório excluiria esses clientes, ou os obrigaria a contratar
um provedor que não usariam. Também impediria vender o ERP antes de o cliente ter
certificado digital, o que na prática atrasa toda implantação — o certificado leva dias
para ser emitido.

## Decisão

**O módulo fiscal é opcional e habilitado por empresa.** Com ele desligado, todo o
restante do sistema funciona de forma idêntica.

O desligamento é resolvido na **composição**, pelo padrão Null Object, e não por
condicional espalhada:

```
ConfiguracaoFiscal.ativo === false
    → container registra ProvedorFiscalNulo
    → manipulador fiscal não enfileira nada
    → PDV imprime "RECIBO — SEM VALOR FISCAL"
```

**O domínio não contém `if (fiscalHabilitado)`.** Uma regra de negócio que pergunta se
o fiscal está ligado seria acoplamento invertido: o núcleo passaria a conhecer a
existência de um módulo periférico.

## Alternativas consideradas

| Alternativa | Veredito |
|---|---|
| Fiscal obrigatório | ❌ Exclui parte do mercado e atrasa toda implantação |
| Condicional no domínio (`if (fiscalHabilitado)`) | ❌ Espalha a decisão por todo o código; cada regra nova precisa lembrar dela |
| **Null Object na composição** | ✅ **Escolhida** — a decisão fica num lugar só |
| Build separado sem fiscal | ❌ Dois artefatos para manter e testar |

## Consequências

### Positivas

- Amplia o mercado endereçável: atende quem não emite documento fiscal.
- **Permite vender e implantar antes de o cliente ter certificado digital**, o que
  encurta o ciclo de venda.
- A suíte de testes roda inteira sem fiscal, provando que nada essencial depende dele.
- Ligar o módulo depois não exige reinstalação nem migração de dados.

### Negativas — custos aceitos

- Duas configurações a suportar, e o suporte precisa saber em qual o cliente está.
- Relatórios e telas fiscais precisam ser ocultados de forma consistente na UI.
- Risco de o cliente operar sem emitir documento quando deveria emitir — mitigado com
  aviso claro na configuração de que a responsabilidade fiscal é dele.

### Neutras

- O modelo de dados é o mesmo nos dois casos; o que muda é o preenchimento.

## Regra derivada, permanente

Nenhuma funcionalidade fora do módulo fiscal pode **depender** de documento fiscal
para funcionar. Venda, estoque, caixa, financeiro e relatórios operacionais precisam
estar completos sem ele.
