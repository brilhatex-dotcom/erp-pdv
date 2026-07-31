# ADR-0015 — Emissão fiscal via provedor externo, atrás de abstração própria

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 30/07/2026 |
| **Decisores** | Responsável pelo produto · Analista de Negócios · Fiscal BR · Arquiteto · Segurança · DevOps |
| **Complementa** | ADR-0006 (emissão assíncrona via Outbox), que permanece válido |

## Contexto

A versão 1.0 da arquitetura previa implementação própria de comunicação com a SEFAZ:
geração de XML, assinatura XMLDSig, validação contra XSD oficiais, endpoints das 27 UFs,
SVC e acompanhamento de notas técnicas.

Esse escopo tem duas características que o tornam desproporcional para este produto:

1. **É o bloco mais imprevisível do projeto.** Rejeição da SEFAZ só aparece testando
   contra o ambiente real, e cada UF tem particularidades.
2. **O custo é perpétuo, não pontual.** Layout muda, notas técnicas saem, e a Reforma
   Tributária (CBS/IBS/IS) está em transição até 2033. Manter isso é trabalho contínuo
   sobre um time pequeno.

Existe um mercado maduro de APIs fiscais brasileiras que absorve exatamente esse
trabalho.

## Decisão

**O ERP não implementa comunicação direta com a SEFAZ.** A emissão ocorre por meio de
uma **API fiscal especializada**, acessada exclusivamente através da porta
`ProvedorFiscal`.

O ERP **nunca conhece detalhes do fornecedor**. Formato de requisição, vocabulário e
códigos de erro do provedor param no adapter (Anti-Corruption Layer). Trocar de
fornecedor é escrever um novo adapter, sem tocar em domínio, casos de uso ou UI.

Nesta fase entrega-se **apenas o projeto** da abstração. Nenhum adapter de fornecedor
específico é implementado.

## Alternativas consideradas

| # | Alternativa | Custo recorrente | Esforço | Veredito |
|---|---|---|---|---|
| A | **Provedor externo, cliente contrata** | R$ 0 para o fabricante | 2–3 sessões | ✅ **Escolhida** |
| B | Provedor externo, fabricante contrata e revende | Cresce com o volume dos clientes | 2–3 sessões | ⚠️ Opção comercial futura |
| C | Implementação própria de SEFAZ | R$ 0 | 8–14 sessões + manutenção perpétua | ❌ Desproporcional agora |
| D | Híbrido: provedor agora, própria depois | R$ 0 agora | 2–3 agora | ✅ Caminho preservado |
| E | Sem módulo fiscal | R$ 0 | 0 | ⚠️ Atendida pelo ADR-0016 |

**Sobre a alternativa C:** não é descartada em definitivo. É a única com custo
recorrente zero, e pode se justificar se a base instalada crescer o suficiente para
que o custo agregado pago aos provedores supere o de internalizar. **Esta decisão
mantém essa porta aberta** — migrar seria escrever um adapter.

## Consequências

### Positivas

- Bloco fiscal cai de 5–8 para **2–3 sessões**; total do projeto cai de 35–50 para
  **30–42 sessões**.
- Mudança de layout, nota técnica e Reforma Tributária passam a ser responsabilidade
  do provedor.
- Sem certificação junto à SEFAZ, sem manter XSD, sem monitorar 27 UFs.
- Custódia do certificado pode ficar com o provedor, **reduzindo o risco legal** do
  fabricante do ERP (ADR detalhado em `docs/fiscal/ARQUITETURA-FISCAL.md` §6).
- O sistema roda completo, e é testável ponta a ponta, antes de qualquer contrato.

### Negativas — custos aceitos

- **Dependência de terceiro** na emissão fiscal. Provedor fora do ar interrompe a
  emissão (não a venda — ADR-0006 garante isso).
- **Custo recorrente para o cliente final**, proporcional ao volume de NFC-e.
- **Contingência offline passa a depender da capacidade do fornecedor** — ver §5 do
  documento fiscal. Este é o critério eliminatório da escolha.
- Menos controle sobre o detalhe da emissão; diagnóstico depende do log do provedor.

### Neutras

- ADR-0006 permanece: a emissão continua assíncrona via Outbox, e a venda nunca espera.
- A numeração fiscal permanece **controlada pelo ERP**, não pelo provedor — é o ERP que
  responde ao Fisco por lacunas na sequência.

## Como reverter

Escrever um adapter `SefazDiretoProvedor` que implemente a mesma porta. Nenhuma regra
de negócio, tela ou tabela precisa mudar. É exatamente o cenário que a abstração
existe para permitir.
