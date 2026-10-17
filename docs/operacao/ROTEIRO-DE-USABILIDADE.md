# Roteiro de usabilidade do caixa

> Para quem implanta ou desenvolve: um teste de 30 minutos com uma pessoa que
> **nunca usou o sistema**, no **modo treinamento**. Ele responde a única
> pergunta que importa para o balcão — *dá para vender sem treinamento?* — e
> aponta onde a tela atrapalha.
>
> A meta do produto é **zero treinamento formal** (`CLAUDE.md` §2). Este roteiro
> mede o quanto falta para ela.

---

## Preparação (5 minutos)

1. Na estação do caixa, abra a entrada e clique em **Treinar, sem valer de
   verdade**. No menu do caixa, use **8 Recomeçar o treino** se outra pessoa já
   treinou ali.
2. Deixe à vista, impressa ou na tela ao lado, só a tabela de pessoas de
   treino da entrada do treino. **Nada do manual.**
3. Tenha um cronômetro e esta folha.
4. Diga à pessoa: *"Você vai atender alguns clientes de mentira. Não existe
   resposta errada: se a tela confundir, o problema é da tela. Pense em voz
   alta."*

**Não ajude.** Se a pessoa travar por mais de 1 minuto numa tarefa, anote
**"travou"**, mostre o caminho e passe para a próxima. O ponto em que ela
travou é o resultado do teste.

## As tarefas

Leia uma de cada vez, em voz alta, como se fosse o cliente. Os códigos de barras
e as etiquetas estão na tela de entrada do treino; os preços, na loja de treino.

| # | O que dizer | Deu certo quando | Meta |
|---|---|---|---|
| 1 | "Comece o dia: a gaveta tem R$ 100,00." | Entrou com 901/121212 e abriu o caixa com R$ 100,00 | 1 min |
| | **Cliente 1** | | |
| 2 | "Uma água e um refrigerante." | Os dois na lista, total R$ 12,40 | 30 s |
| 3 | "Pago com uma nota de R$ 20,00." | Troco de **R$ 7,60** mostrado, venda concluída | 30 s |
| | **Cliente 2** | | |
| 4 | "Me vê 350 g de pão." (a etiqueta da balança) | R$ 6,62 lançado sem digitar o peso | 30 s |
| 5 | "E meio quilo de tomate." (sem etiqueta) | Peso digitado na janela do peso: R$ 4,25 | 1 min |
| 6 | "Um pão de queijo… ah, não: são três." | Quantidade corrigida para 3 (F3 ou `3*`) | 30 s |
| 7 | "Pago R$ 10,00 em dinheiro e o resto no Pix." | Dois pagamentos, sem troco | 1 min |
| | **Cliente 3** | | |
| 8 | "Um leite, um refrigerante e um bolo de fubá." | Os três na lista | 30 s |
| 9 | "Esse refrigerante está quente, tira da conta." | Item tirado (F8) | 30 s |
| 10 | "Faz 10% de desconto no bolo?" | Desconto pedido e liberado pelo supervisor (902/232323) | 1 min |
| 11 | "Esqueci a carteira, já volto." — e depois: "Voltei." | Venda guardada (F7) e retomada | 1 min |
| 12 | "Anota no meu fiado — sou a Dona Maria." | Cliente escolhido (F6), pago no fiado | 1 min |
| | **Cliente 3, de novo** | | |
| 13 | "Esse leite que levei veio vencido." | Chamou o supervisor, que entrou no caixa (Trocar operador) e devolveu 1 item da venda dela | 2 min |
| | **Fim do dia** | | |
| 14 | "Feche o caixa." | Gaveta contada e fechamento concluído | 2 min |

> Os pesos seguem os preços da loja de treino: pão francês a R$ 18,90/kg
> (350 g → R$ 6,615, arredondado para **R$ 6,62**) e tomate a R$ 8,49/kg (500 g
> → **R$ 4,25**). Confira na tela antes de usar o roteiro numa versão nova: o
> objetivo é medir a pessoa, não a conta.

## O que anotar, por tarefa

| Tarefa | Tempo | Deu certo? (sim / com ajuda / travou) | Onde hesitou | O que disse |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| … | | | | |

Repare principalmente:

- **Usou o mouse?** O balcão é feito para o teclado. Cada vez que a mão sai do
  teclado é um custo que se repete milhares de vezes por dia.
- **Leu alguma mensagem de erro?** Ela disse o que fazer, em português de
  balcão? Mensagem técnica na tela é defeito (`CLAUDE.md` §9).
- **Procurou algo que não estava onde esperava?** Anote onde procurou primeiro:
  é ali que a coisa deveria estar.
- **Confiou no troco?** Conferiu de cabeça? Isso diz se o valor está grande e
  claro o bastante.

## Depois do teste (10 minutos)

Três perguntas, nesta ordem, sem defender a tela:

1. "O que foi mais difícil?"
2. "Teve alguma hora em que você não sabia se tinha dado certo?"
3. "O que você mudaria primeiro?"

## Como ler o resultado

| Resultado | Significa | O que fazer |
|---|---|---|
| Tarefas 1 a 7 sem ajuda, dentro da meta | O caixa do dia a dia não precisa de treinamento | Nada — repita com outra pessoa |
| Travou em 1 a 7 | Defeito de tela no caminho principal | Corrigir antes de implantar |
| Travou em 8 a 14 | Ponto que precisa de explicação | Rever a tela; até lá, explicar na implantação |
| Usou o mouse em alguma tarefa | O atalho existe mas não se descobre | Tornar o caminho de teclado visível |

Três pessoas bastam para achar a maior parte dos problemas. Registre cada
achado como defeito, com a tarefa, o que a pessoa fez e o que esperava — e
repita o roteiro depois da correção.
