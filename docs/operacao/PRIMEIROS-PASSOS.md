# Primeiros passos da loja

> Para o dono, o gerente ou o técnico na implantação, logo depois de instalar
> (`INSTALACAO.md`). Em meia hora a loja está vendendo — e cada passo pode ser
> refeito depois, na tela de onde ele saiu.

Tudo aqui é feito na **retaguarda**: `http://NOME-DO-SERVIDOR:3000/retaguarda/`
(no próprio servidor, `http://localhost:3000/retaguarda/`).

---

## 1. Criar o administrador

Na primeira abertura, a retaguarda pede para **criar o administrador**: seu
nome, uma matrícula, uma senha (de no mínimo 12 caracteres) e, se você também
vai operar o caixa, um PIN de 6 números.

Não existe usuário nem senha de fábrica. Guarde a senha: sem ela, ninguém
administra a instalação.

## 2. A empresa — menu **Empresa**

Razão social, nome fantasia, CNPJ, regime tributário, endereço e telefone. É o
cabeçalho do comprovante e de todo relatório. O CNPJ não muda depois de salvo:
outro CNPJ é outra empresa — e outra instalação.

## 3. Como a loja vende — menu **Configuração**

1. **O tipo da loja: Padaria, Mercadinho, Frutaria ou Misto.** A escolha liga
   de uma vez os recursos que o tipo usa — dá para mudar cada um depois:
   - **Venda por peso** — o caixa lê a etiqueta da balança ou pede o peso;
   - **Fiado** — vender para o cliente pagar depois, até o limite dele;
   - **Botões rápidos** — produtos sem código de barras em botões, na tela do
     caixa.
2. **Venda sem estoque:** vender normalmente (o estoque fica negativo), pedir a
   liberação do supervisor, ou não vender.
3. **Comprovante:** a largura do papel (58 ou 80 mm), se imprime **sempre** ou
   **só quando pedir**, e o logotipo da loja.
4. **Balança:** como é a etiqueta que a sua balança imprime — com que dígito
   começa, quantos dígitos tem o código do produto, se traz **peso** ou
   **preço**. Passe uma etiqueta de verdade no campo **Etiqueta para conferir**:
   a tela mostra o que o caixa vai entender dela **antes** de gravar.

A mesma tela mostra as **integrações** e a situação de cada uma — o que já
funciona (leitor de código de barras, etiqueta da balança, impressora de
comprovante) e o que ainda não existe (balança ligada ao computador, Pix com
confirmação automática, maquininha integrada, nota fiscal).

## 4. As pessoas — menu **Usuários**

Uma matrícula para cada pessoa, com o papel dela:

| Papel | Para quem |
|---|---|
| Operador de caixa | Quem vende. Desconto pequeno, abre e fecha o caixa |
| Supervisor | Quem libera desconto maior, cancelamento, devolução e sangria |
| Gerente | Quem cuida da loja: cadastros, estoque, financeiro, auditoria |
| Administrador | Quem cuida do sistema: usuários e cópias de segurança |

Há também **estoquista**, **financeiro** e **contador** (só leitura), para quem
cuida só daquela parte.

O caixa entra com **PIN** de 6 números; a retaguarda, com **senha** de pelo
menos 12 caracteres. PIN esquecido não se recupera: o administrador define um
novo na mesma tela.

**Uma matrícula por pessoa, sempre.** O sistema registra quem vendeu, quem deu
desconto e quem liberou — e esse registro só vale se ninguém empresta o PIN.

## 5. Os produtos — menu **Produtos**

Para cada produto: descrição, preço, custo, **unidade** (unidade ou quilo) e,
quando tiver, o **código de barras**. Produto de balança leva o **código da
balança** — o mesmo cadastrado nela. Categoria (com um emoji, como 🍞), foto e
"botão rápido" fazem o produto aparecer nos botões do caixa.

Para começar, cadastre o que mais vende. O resto entra aos poucos.

## 6. O estoque — menus **Compras** e **Estoque**

- **Compras → Nota de entrada:** o que chegou do fornecedor, com quantidade e
  custo. É assim que o estoque sobe no dia a dia.
- **Estoque:** o saldo de cada produto, o extrato de cada movimento e os
  ajustes (perda, contagem).

O estoque é uma soma de movimentos: nada se apaga, e cada número tem de onde
veio.

## 7. Os clientes do fiado — menu **Clientes**

Nome, como o balcão chama a pessoa ("Dona Maria") e o **limite do fiado**. O
CPF é opcional: só entra quando há motivo.

## 8. As cópias de segurança — menu **Cópias de segurança**

O sistema copia o banco **sozinho**, de hora em hora e a cada fechamento de
caixa, e confere cada cópia. Abra a tela uma vez para ver a primeira cópia
**conferida**. Combine com o dono a **cópia semanal para um pendrive** guardado
fora da loja — é a proteção contra roubo e incêndio (`BACKUP.md`).

## 9. Treinar a equipe

Na entrada do caixa, **Treinar, sem valer de verdade** abre uma loja de
demonstração pronta, com produtos, clientes e pessoas de treino. A equipe
pratica na tela de verdade — peso, troco, desconto, liberação, devolução,
fechamento — e nada disso chega à loja. Roteiro para a primeira hora:
`ROTEIRO-DE-USABILIDADE.md`. Manual do caixa: `MANUAL-DO-OPERADOR.md`.

## 10. A primeira venda de verdade

No caixa: matrícula e PIN, **fundo de troco**, e passe o primeiro produto. Se
algo não sair como o esperado, o caminho de volta é sempre a retaguarda — o
caixa nunca precisa ser configurado na própria estação.
