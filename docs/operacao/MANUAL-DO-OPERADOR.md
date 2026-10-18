# Manual do operador de caixa

> Para quem trabalha no balcão. Não precisa ler inteiro: a **cola** logo abaixo
> resolve o dia a dia, e cada seção depois dela explica uma situação.
>
> Quer praticar sem medo? Use o **treinamento** (seção 12): é a mesma tela, e
> nada do que se faz lá vale de verdade.

---

## A cola — o que cada tecla faz

| Tecla | O que faz |
|---|---|
| **Enter** | Lança o código digitado. Com o campo vazio, vai para o **pagamento** |
| **3\*código** | Lança 3 unidades de uma vez (`3*7891000315507`) |
| **F1** | Ajuda, com esta lista |
| **F2** | Procurar produto pelo nome |
| **F3** | Mudar a quantidade do item selecionado |
| **F4** | Desconto — no item ou na venda inteira |
| **F6** | Cliente da venda (para vender no fiado) |
| **F7** | Guardar a venda, ou retomar uma guardada |
| **F8** | Tirar o item selecionado |
| **F9** | Cancelar a venda |
| **F10** | Receber (o mesmo que Enter no campo vazio) |
| **↑ ↓** | Escolher o item da lista |
| **Ctrl+P** | Imprimir o comprovante da última venda |
| **Esc** | Voltar / fechar a janela |

No pagamento: **1** Dinheiro · **2** Pix · **3** Débito · **4** Crédito · **5** Fiado.

No menu do caixa (botão **Caixa: sangria, fechamento…**, no alto da tela):
**1** Suprimento · **2** Sangria · **3** Reimprimir · **4** Devolução ·
**5** Cancelar venda concluída · **6** Fechar o caixa · **7** Trocar operador.

Todo comando também está num botão da tela. Se a tela travar, aperte **F5**: a
venda em andamento volta sozinha.

---

## 1. Entrar

Digite a **matrícula**, a **senha numérica (PIN, 6 números)** e aperte Enter.

- Errou o PIN? A tela apaga só o PIN — digite de novo.
- Muitos erros seguidos **bloqueiam o usuário por um tempo**. Não insista:
  chame o supervisor.
- Cada pessoa entra com a **própria matrícula**. O sistema anota quem fez cada
  venda, desconto e cancelamento — emprestar o PIN põe o seu nome no que o
  outro fez.

## 2. Abrir o caixa

No começo do dia, a tela pede o **fundo de troco**: conte o dinheiro que já está
na gaveta e digite. Os números entram pela direita, como na maquininha: **1 0 0
0 0** vira **R$ 100,00**. Gaveta vazia: digite **0**.

Aperte Enter. Na primeira vez, aparece uma explicação curta de como vender —
leia e aperte **Entendi**.

## 3. Vender

### Produto com código de barras

Passe o leitor (ou digite o código e aperte Enter). O item aparece na lista e o
**total** sobe na hora. Passou o mesmo produto de novo? Ele soma na mesma
linha.

Muitas unidades iguais: digite a quantidade, o asterisco e o código —
`6*7891000315507` lança 6 de uma vez.

### Produto de peso (pão, frios, frutas, carne)

- **Com etiqueta da balança:** passe a etiqueta no leitor. O peso já vem dentro
  dela — não digite nada.
- **Sem etiqueta:** passe ou digite o código do produto. Abre a janela do
  **peso**: digite o que a balança mostra — em **gramas** (350) ou, se preferir,
  troque para **quilos** (0,350) — e aperte Enter. A tela mostra o valor antes
  de lançar.

> Exemplo: pão de R$ 20,00 o quilo, 350 g na balança → **R$ 7,00**.

### Produto sem código na mão

- **F2** procura pelo nome: digite parte do nome (`refri`, `pão`) e escolha com
  ↑ ↓ e Enter.
- Os **botões rápidos** e as **categorias** (🍞 Padaria, 🥬 Hortifrúti…) ficam ao
  lado da lista, quando a loja usa.

### Corrigir

- **Quantidade errada:** escolha o item com ↑ ↓ e aperte **F3**.
- **Item errado:** escolha o item e aperte **F8**.

Dependendo da loja, tirar item ou reduzir quantidade pede o **supervisor**: a
tela abre a **Liberação do supervisor**, ele digita a matrícula e o PIN dele, e a
operação continua. Ninguém precisa sair do caixa.

## 4. Desconto (F4)

Escolha **na venda** ou **no item**, em **%** ou em **R$**, e confirme. Cada
pessoa tem um limite de desconto. Acima dele, a tela pede a **liberação do
supervisor** — e fica registrado quem pediu e quem liberou.

## 5. Receber

Com a venda pronta, aperte **Enter no campo vazio** (ou F10). Aparecem o
**falta receber** e as formas de pagamento.

| Forma | O que fazer |
|---|---|
| **1 Dinheiro** | Digite o valor que o cliente deu e Enter. O **troco** aparece grande |
| **2 Pix** | Confira no aplicativo do banco que o Pix caiu, e só então confirme |
| **3 Débito / 4 Crédito** | Passe na maquininha. O código de autorização é opcional; no crédito, escolha as parcelas |
| **5 Fiado** | Escolha o cliente (F6). Vale para quem tem fiado liberado, até o limite dele — acima, só com o supervisor |

> Exemplo de troco: compra de **R$ 12,50**, cliente dá **R$ 20,00** → troco de
> **R$ 7,50**.

### Pagar com mais de uma forma

Registre uma forma de cada vez. O **falta receber** diminui a cada pagamento, e a
próxima forma já vem com o valor que falta.

> Exemplo: compra de **R$ 50,00** → **1** Dinheiro **R$ 20,00** → falta
> R$ 30,00 → **2** Pix **R$ 30,00** → **sem troco**.

**Troco só sai em dinheiro.** Pix ou cartão acima do que falta é recusado — o
sistema não deixa "devolver troco" de um Pix.

**Nunca digite o número do cartão.** Nenhum campo pede isso, e o sistema recusa
o que se pareça com número de cartão.

Pagou errado? Tire o pagamento na lista dos pagamentos registrados e faça de
novo.

### Quando a venda conclui

A tela mostra **Venda concluída**, com o troco em destaque. O comprovante sai
sozinho ou com **Ctrl+P**, conforme a loja configurou. **Ele não é nota fiscal**
— e diz isso no papel.

## 6. Guardar uma venda (F7)

O cliente esqueceu a carteira ou foi buscar mais um item? **F7** guarda a venda
(dê um nome para lembrar, se quiser) e libera o caixa para o próximo. Para
continuar depois, **F7** de novo e escolha a venda guardada.

O caixa **não fecha** com venda guardada esquecida: a tela mostra quais faltam.

## 7. Cancelar

- **Venda em andamento (F9):** escolha o motivo e confirme. A venda é
  descartada — conforme a loja, com a liberação do supervisor.
- **Venda já concluída:** menu do caixa, **5 Cancelar venda concluída**. Escolha
  a venda, o motivo, e chame o supervisor. A tela diz **quanto devolver ao
  cliente e em qual forma** — e o estoque volta sozinho.

## 8. Devolução — o cliente traz o produto de volta

A devolução é feita pelo **supervisor ou pelo gerente**, com a matrícula dele:
ela tira dinheiro da gaveta, e quem tira é quem responde por ele. Chame-o para
entrar no caixa (menu do caixa, **7 Trocar operador**).

Ele usa o menu do caixa, **4 Devolução**: encontra a venda (pelo número do
comprovante), marca **quais itens e quanto** volta — pode ser só parte —, se o
produto volta para a **prateleira** ou é **perda**, como devolver o dinheiro
(dinheiro, Pix, cartão ou abatendo do fiado) e o motivo.

## 9. Suprimento e sangria

- **1 Suprimento:** pôr dinheiro na gaveta (troco que acabou).
- **2 Sangria:** tirar dinheiro da gaveta (excesso de notas). Só o supervisor
  ou o gerente faz, com a matrícula dele — como na devolução, ele entra no
  caixa (**7 Trocar operador**).

Informe o valor e o motivo. A gaveta abre para pôr ou tirar o dinheiro.

## 10. Fechar o caixa

Menu do caixa, **6 Fechar o caixa**.

1. Conte **todo o dinheiro da gaveta**, notas e moedas.
2. Digite o total e aperte Enter.

A tela **não mostra antes** quanto deveria haver: o controle só funciona se a
contagem for às cegas. Depois de enviar, aparecem o esperado, o contado e o
resultado — **A gaveta bateu**, **Sobra** ou **Falta**. Com diferença, o caixa
fecha do mesmo jeito; o gerente confere depois.

> Exemplo: fundo de R$ 100,00 + R$ 7,00 + R$ 20,00 (troco de R$ 7,50) +
> R$ 20,00 em dinheiro de uma venda mista + R$ 30,00 → a gaveta deve ter
> **R$ 169,50**.

## 11. Sem conexão com o servidor

> Esta seção vale quando o **Agente Local** está ativo no computador do caixa. Na
> instalação de hoje ele ainda não vem ligado (`INSTALACAO.md`): sem ele, a tela
> avisa que não há conexão e a venda **espera o servidor voltar**. Pergunte ao
> responsável pela loja qual é o caso do seu caixa.

Se aparecer **Sem conexão com o servidor** no alto da tela, **continue
vendendo**: as vendas ficam guardadas no computador do caixa e sobem sozinhas
quando a rede voltar.

Enquanto isso:

- dá para **passar produto, receber e concluir**;
- produto de peso entra **pela etiqueta da balança** (o peso digitado não
  entra);
- desconto, cliente/fiado, guardar venda e devolução **esperam a conexão
  voltar** — a tela avisa;
- o comprovante sai marcado **VENDA SEM CONEXAO**, sem número.

O caixa **não fecha** enquanto houver venda esperando para subir: o dinheiro
dela está na gaveta, mas ainda não no sistema, e o fechamento acusaria uma falta
que não existe. Espere a rede voltar. Se o aviso **Sem servidor há horas**
aparecer, chame o responsável pela loja.

## 12. Treinamento

Na tela de entrada, **Treinar, sem valer de verdade** abre a mesma tela do caixa
numa **loja de demonstração**, com produtos, clientes e três pessoas prontas:

| Matrícula | PIN | Para treinar |
|---|---|---|
| 901 | 121212 | O operador: abrir, vender, fechar |
| 902 | 232323 | O supervisor: liberar desconto, cancelar, devolver, sangria |
| 903 | 343434 | O gerente: tudo, com limites maiores |

- Uma **faixa amarela** fica no alto de toda tela: **MODO TREINAMENTO**.
- O Pix e o cartão são **simulados**, a gaveta **não abre**, e o comprovante sai
  marcado **TREINAMENTO - SEM VALOR**.
- Sem leitor? Os códigos para digitar estão na tela de entrada do treino e na
  ajuda (**F1**).
- **Recomeçar o treino** (menu do caixa, **8**) apaga tudo o que se fez no treino.
- **Sair do treino** (menu do caixa, **9**, ou o botão na entrada) volta ao caixa
  de verdade. Fechar a janela também volta.

Nada do treino chega às vendas, ao estoque, ao caixa ou ao fiado da loja.

---

## Quando algo dá errado

| A tela diz | O que fazer |
|---|---|
| **Produto não encontrado** | Confira o código; procure pelo nome (F2) |
| **Liberação do supervisor** | Chame o supervisor para digitar a matrícula e o PIN dele |
| **Usuário bloqueado** | Espere o tempo indicado ou chame o supervisor |
| **Ainda falta receber** | Registre o restante antes de concluir |
| **Pagamento acima do que falta** | Troco só em dinheiro: registre o Pix ou o cartão pelo valor exato |
| **Abra o caixa antes de vender** | Faça a abertura (seção 2) |
| **Sem conexão com o servidor** | Continue vendendo (seção 11) |
| Tela parada | **F5** — a venda em andamento volta |

Qualquer mensagem que não esteja aqui: anote o que estava fazendo e chame o
responsável pela loja. Não refaça uma venda que talvez tenha sido concluída —
procure-a antes no menu **3 Reimprimir**.
