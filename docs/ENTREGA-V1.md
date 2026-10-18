# Entrega da V1 do balcão

> O que a primeira versão funcional entrega, **como cada parte foi testada**, o
> que depende de integração externa e o que ainda não existe. Escrita para quem
> vai vender, implantar ou continuar o produto — sem arredondar para cima.
>
> Atualizada em 17/10/2026, no ramo `claude/jolly-planck-c0ues8`.

**Legenda:** ✅ pronto e testado · ⚠️ pronto em parte · ⬜ não existe ainda ·
🔌 depende de integração externa.

---

## 1. O que está pronto

### Operação da loja

| Pedido | Situação | Onde |
|---|---|---|
| Segmento configurável: padaria, mercadinho, frutaria, misto | ✅ Cada um liga os recursos que usa; tudo ajustável depois | Retaguarda → Configuração |
| Uma loja, um ou mais caixas, vários operadores | ✅ Uma empresa por instalação (ADR-0024); cada operador com matrícula e PIN | — |
| Vender sem servidor | ⚠️ Fila na estação, entregue quando a rede volta, sem duplicar — **pronta e testada no código, mas o instalador ainda não ativa o Agente Local** (ADR-0023) | `apps/agente/` |
| Perfis administrador, gerente, supervisor, operador — permissão conferida **no servidor** | ✅ E também estoquista, financeiro e contador | Retaguarda → Usuários |
| Senha segura e auditoria | ✅ Argon2id; PIN de 6 números sem sequência óbvia; senha de 12+; bloqueio progressivo; registro de quem pediu e quem liberou | Retaguarda → Auditoria |
| Cálculo sem erro de arredondamento | ✅ Dinheiro em centavos, quantidade em milésimos, percentual em pontos-base — nunca `float` | `@erp/domain` |
| Proteção contra venda duplicada | ✅ Bipe, pagamento, conclusão e envio da fila repetidos não duplicam | ver §2 |

### A tela de venda

| Pedido | Situação |
|---|---|
| Busca por nome, código ou código de barras; leitor | ✅ Campo único; F2 procura por nome |
| Botões rápidos e categorias | ✅ Com emoji ou foto; os mais vendidos entram sozinhos |
| Unidades un, kg, g, L | ✅ E também pç, cx, fd, pct, dz, mL, m, m² |
| Produtos pesáveis | ✅ Pela **etiqueta da balança** (peso ou preço dentro) ou pelo **peso digitado**, em g ou kg |
| Alterar quantidade e tirar item, com permissão | ✅ F3 e F8, com liberação do supervisor quando a loja exige |
| Desconto com limite e autorização | ✅ F4, no item ou na venda, em % ou R$; acima do limite, o supervisor libera |
| Guardar e retomar venda | ✅ F7; o caixa não fecha com venda guardada esquecida |
| Cancelar com motivo e responsável | ✅ F9 na venda aberta; menu do caixa na concluída, com estorno por forma |
| Atalhos de teclado | ✅ F1 a F10, Enter, Esc, Ctrl+P, `3*código` — a venda inteira sem mouse |
| Comprovante não fiscal 58/80 mm, imprimir e reimprimir | ✅ Pelo Agente (ESC/POS) ou pelo navegador, sempre marcado **NÃO É DOCUMENTO FISCAL** |

### Pagamentos

| Pedido | Situação |
|---|---|
| Dinheiro, Pix, débito, crédito, misto e fiado | ✅ |
| Troco só no dinheiro | ✅ Pix ou cartão acima do que falta é recusado |
| Pix com confirmação manual | ✅ O operador confere no banco; fica registrado como "conferido pelo operador" |
| Nenhum número de cartão guardado | ✅ Nenhum campo pede; o que parece número de cartão é recusado |
| Fiado com limite | ✅ Até o limite do cliente; acima, só com o supervisor. Vira conta a receber na mesma transação da venda (ADR-0025) |

### Cadastros, estoque, caixa e financeiro

| Pedido | Situação |
|---|---|
| Produtos | ✅ Código de barras, código da balança, categoria, foto, embalagens, custo |
| Estoque | ✅ Saldo, extrato e ajustes; a venda baixa e o cancelamento devolve. ⚠️ Alerta de estoque mínimo: o cadastro guarda o mínimo, mas não há aviso nem lista "abaixo do mínimo" |
| Compras | ✅ Nota de entrada com custo; cancelamento com estorno. ⬜ Pedido de compra |
| Etiquetas da balança | ✅ Leitura configurável, com teste antes de gravar. A etiqueta é impressa pela própria balança |
| Abrir, sangria, suprimento, fechar e conferir o caixa | ✅ Fechamento **às cegas**; diferença registrada |
| Devoluções, inclusive parciais | ✅ Pelo supervisor, para o estoque ou como perda, com reembolso por forma |
| Clientes, fornecedores, fiado | ✅ |
| Despesas | ✅ Contas a pagar no Financeiro, com baixa parcial, estorno e parcelas |
| Relatórios | ⚠️ Conferência dos caixas por período, saldos e extrato de estoque, contas a receber e a pagar, auditoria. ⬜ Vendas por período, por produto e margem |

### Segurança dos dados

| Pedido | Situação |
|---|---|
| Cópia automática configurável e cópia manual | ✅ De hora em hora e a cada fechamento; **toda cópia provada por restauração**; retenção automática (ADR-0027) |
| Restauração restrita | ✅ Só o administrador, com a palavra de confirmação; o sistema copia o banco de antes primeiro |
| Atualização segura do banco | ✅ Migrações expand-contract com **reversão testada** automaticamente; o instalador aplica |

### Treinamento e demonstração

| Pedido | Situação |
|---|---|
| Modo treinamento com dados de demonstração separados | ✅ Outro banco, outra sessão, nenhuma fila (ADR-0026) |
| Simulação só no treinamento | ✅ Pix e cartão simulados são recusados fora dele |
| Comprovante do treino marcado | ✅ **TREINAMENTO - SEM VALOR** |

### Integrações — situação mostrada na tela de Configuração

| Integração | Situação |
|---|---|
| Leitor de código de barras | ✅ Qualquer leitor que "digita" (USB/teclado) |
| Etiqueta da balança | ✅ |
| Impressora de comprovante | ✅ ESC/POS genérico pelo Agente Local; gaveta pela impressora |
| Balança ligada ao computador | ⬜ 🔌 |
| Pix com confirmação automática | ⬜ 🔌 Exige contrato com um PSP (banco ou intermediador) |
| Maquininha integrada (TEF) | ⬜ 🔌 Exige contrato com adquirente/subadquirente |
| Nota fiscal do consumidor (NFC-e) | ⬜ 🔌 Exige provedor fiscal, certificado e o CSC da **UF da loja** — a definir |

---

## 2. Como foi testado

Tudo abaixo foi **executado**, não só escrito. Números da última execução
completa (`pnpm verify`, 18/10/2026):

| Camada | Testes | O que prova |
|---|---|---|
| Domínio | 1.331 | As regras, isoladas: dinheiro, peso, troco, desconto, estoque, caixa, permissões |
| Casos de uso | 548 | Os fluxos, com dublês: venda, devolução, cópia, treino |
| Banco (PostgreSQL de verdade) | 251 | Gatilhos de imutabilidade, índices únicos, reversão de migração, `pg_dump`/`pg_restore` |
| Servidor (HTTP + PostgreSQL) | 454 + 23 | As rotas que a tela chama; os **23 cenários de aceitação** abaixo |
| PDV (tela) | 318 | Cada tecla, janela e mensagem, contra um servidor falso com estado |
| Retaguarda, Agente, instalador e demais | 724 | — |
| **No navegador (Chromium)** | 10 | O dia de caixa inteiro, pelo teclado, contra o servidor e o banco de verdade |

O CI repete tudo a cada envio, com PostgreSQL 17 — a versão que vai na loja.

### Os cenários pedidos

| Cenário | Pela API (`Aceitacao.test.ts`) | No navegador (`apps/e2e`) |
|---|---|---|
| Venda por unidade | ✅ 2 × R$ 9,90 = R$ 19,80, na mesma linha | ✅ |
| Venda por peso | ✅ etiqueta e peso digitado | ✅ etiqueta e 1.500 g digitados |
| Conversão g/kg | ✅ 350 g = 0,350 kg, mesmo preço | ✅ |
| Pagamento misto | ✅ | ✅ |
| Troco | ✅ e só em dinheiro | ✅ |
| Desconto autorizado | ✅ pede o supervisor, passa com o PIN dele, fica na auditoria | — (coberto na tela pelos testes do PDV) |
| Cancelamento | ✅ com motivo e supervisor; o estoque volta | — (idem) |
| Devolução parcial | ✅ 1 de 3, R$ 9,90 de volta, o item volta ao estoque; não devolve além do vendido | — (idem) |
| Estoque depois da venda | ✅ 10 − 2 un; 10 − 0,350 kg; venda aberta não baixa | ✅ 1,850 kg a menos no banco |
| Fechamento de caixa | ✅ esperado = contado; falta registrada | ✅ R$ 169,50 bate |
| Venda duplicada | ✅ bipe, pagamento, conclusão e fila repetidos | — |
| Persistência depois de reiniciar | ✅ servidor e conexões desligados e religados: caixa, venda aberta e venda concluída continuam | — |
| Cópia e restauração | ✅ com `pg_dump` de verdade: a venda feita depois da cópia sai | — |

| Exemplo de conferência | Resultado |
|---|---|
| R$ 20,00/kg × 350 g | **R$ 7,00** — pela API e no navegador |
| R$ 12,50 pagos com R$ 20,00 | **Troco de R$ 7,50** — pela API e no navegador |
| R$ 50,00 = R$ 20,00 em dinheiro + R$ 30,00 no Pix | **Saldo zero, sem troco** — pela API e no navegador |

### O que **não** foi testado

- **A instalação da V1 num Windows.** As versões de agosto foram instaladas e
  reinstaladas numa máquina Windows (sete correções vieram dessas instalações), mas o instalador **com a V1** — balcão completo, cópias de
  segurança, treino — ainda não foi gerado nem instalado (`ESTADO.md` §2.1.1). É
  o próximo passo antes de uma loja.
- **Um segundo computador numa rede de verdade.** Testado no Chromium por um IP de
  rede (HTTP, origem insegura); nunca com duas máquinas físicas.
- **Hardware físico:** impressora térmica, gaveta, leitor e balança de verdade.
  Nos testes, o leitor é o teclado (como o leitor USB se apresenta) e a etiqueta
  é gerada no formato de fábrica. Para conferir o cupom sem impressora, há a
  pré-visualização (`@erp/printing`) e a impressora virtual do Agente Local
  (`pnpm --filter @erp/agente impressora:virtual`).
- **Uso por um operador de verdade.** O `ROTEIRO-DE-USABILIDADE.md` existe para
  isso, e ainda não foi aplicado.

---

## 3. Limitações conhecidas

| Limitação | Consequência | Contorno até resolver |
|---|---|---|
| Relatórios de vendas (por período, produto, margem) e painel | O dono não vê a venda do mês numa tela | Conferência dos caixas por período |
| Alerta de estoque mínimo | Ninguém é avisado do que está acabando | Estoque → saldos zerados e negativos |
| Cópia externa automática e PITR | Proteção contra roubo e incêndio depende do pendrive semanal | Rotina combinada na implantação (`BACKUP.md`) |
| Agente Local ativo na instalação | O instalador copia, mas não registra nem inicia o Agente: comprovante pelo navegador, gaveta sem abertura automática, nenhuma venda sem servidor | Impressora com a gaveta ligada ao driver do Windows; servidor sempre no ar |
| 2º computador sem tela guardada (HTTP, ADR-0028) | Funciona online; com o servidor desligado e a página recarregada, não abre | — |
| Troca obrigatória da credencial no primeiro acesso | O cadastro marca, mas as telas ainda não exigem | O administrador define o PIN junto com a pessoa |
| Pedido de compra, inventário em lote, conciliação bancária | — | Nota de entrada, ajuste item a item, baixa manual |
| Atualização automática | Atualizar é rodar o instalador novo por cima | — |
| Emissão fiscal | O produto **não emite NFC-e**: serve para demonstração, homologação e implantação, não para a loja operar legalmente | Decidir a UF e o provedor fiscal (ADR-0015, ADR-0022) |
| Treino sem servidor | O treino para quando o servidor cai | — (por desenho: a fila entregaria a venda de treino à loja) |

---

## 4. Onde está cada coisa

| Para | Leia |
|---|---|
| Instalar na loja | `docs/operacao/INSTALACAO.md` |
| Configurar a loja depois de instalar | `docs/operacao/PRIMEIROS-PASSOS.md` |
| Operar o caixa | `docs/operacao/MANUAL-DO-OPERADOR.md` |
| Cópias de segurança e restauração | `docs/operacao/BACKUP.md` |
| Testar a tela com um operador novo | `docs/operacao/ROTEIRO-DE-USABILIDADE.md` |
| Continuar o desenvolvimento | `ESTADO.md` |
| Entender a arquitetura e as decisões | `docs/ARQUITETURA.md`, `docs/adr/` |
