# ADR-0023 — PDV como PWA, com Agente Local dono do hardware e da contingência

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 01/08/2026 |
| **Decisores** | Responsável pelo produto · Arquiteto · DevOps · UX/UI · Dev Sênior |
| **Supersede** | **ADR-0005 — Electron no PDV, web na retaguarda** |

## Contexto

O ADR-0005 escolheu Electron para o PDV por um motivo correto: **navegador não
alcança impressora térmica nem porta serial de forma confiável**. A retaguarda
já era web.

Essa escolha resolveu o hardware e criou um custo que só aparece depois da
venda: **atualizar o sistema exige chegar a cada estação instalada**. Ou se
constrói auto-update, ou alguém leva instalador à loja. Com base instalada
crescendo, esse é o custo que mais cresce — e `CLAUDE.md` §2 diz que suporte é o
critério econômico dominante.

O produto também pediu drivers por marca (Bematech, Elgin, Epson, Daruma,
ESC/POS genérico) atrás de um **Printer Service**. Foi ao desenhar esse serviço
que a contradição se desfez: se existe um programa instalado que é dono da
impressora, a tela não precisa ser um programa instalado.

## Decisão

O PDV passa a ser **PWA**, servido pelo próprio servidor da loja. O hardware e a
contingência passam a ser responsabilidade de um **Agente Local** instalado na
estação.

```
Tela do caixa (PWA, servida pelo servidor da loja)
        │
        ▼
Agente Local (Node, instalado como serviço)
        ├── impressão
        ├── fila de vendas offline
        └── catálogo replicado
        │
        ▼
Driver Bematech · Elgin · Epson · Daruma · ESC/POS genérico
```

### O Agente Local herda a contingência, e isso não é detalhe

A fila de vendas pendentes é o arquivo mais importante do produto: enquanto o
servidor está fora, ela é o único lugar do mundo onde a venda existe (ADR-0021).
Ela é gravada com `fsync` — quando a função retorna, o disco confirmou.

**Navegador não oferece essa garantia.** IndexedDB é durável na prática, mas não
expõe controle de descarga para o disco. Mover a fila para o navegador
enfraqueceria a peça que menos pode enfraquecer.

Colocando-a no Agente Local — que é Node, na mesma máquina — a garantia é
exatamente a mesma de hoje. O código de `FilaDeVendas`, `ReplicaCatalogo` e
`Sincronizador` **muda de casa, não é reescrito**.

## O que foi pesado, e o que não discriminou

| Preocupação | Veredito |
|---|---|
| Loja dias sem internet | **Empate.** O PDV nunca dependeu de internet: fala com o servidor da loja pela rede local, e a PWA é servida por esse mesmo servidor |
| Máquina lenta | **Leve vantagem da PWA.** Electron carrega uma segunda cópia do Chromium — 150 a 200 MB que a máquina de 4 GB sente |
| Impressora térmica de 58 mm | **Não discrimina.** Quem fala com ela é o Agente Local nos dois desenhos |
| Velocidade com muitos itens | **Não discrimina.** O caminho da bipada é tela → servidor da loja → banco. A casca não entra nele, e a impressão nunca bloqueia a venda |
| **Custo de atualizar a base instalada** | **Decidiu.** Publicar contra visitar cada estação |

## A casca Electron sobrevive — fina, e opcional

**O que é superseado é o Electron como aplicação; não como forma de abrir.**

Com React, a mesma tela roda nos dois formatos sem código duplicado. Uma casca
de quiosque que só abre a PWA em tela cheia, apontando para o servidor da loja,
é da ordem de cem linhas e não contém regra nenhuma:

```
PWA (a aplicação de verdade)
 └── casca Electron opcional — abre a PWA em tela cheia, modo quiosque
```

Ela é **suportada** para o lojista que prefere ícone na área de trabalho e uma
janela sem barra de navegador. Quem usa tablet abre pelo navegador. Uma base de
código, dois jeitos de abrir.

**O limite:** a casca não pode ganhar lógica. No instante em que ela souber
alguma coisa que a PWA não sabe — um caminho de impressão próprio, um cache
paralelo, uma tela que só existe nela — voltam a ser duas aplicações, e cada
defeito passa a precisar de reprodução nas duas. A casca conhece uma URL e nada
mais; o hardware é do Agente Local nos dois casos.

Isto corrige uma imprecisão da primeira versão deste ADR, que descartava a casca
sem separar as duas coisas.

## Consequências

### Positivas

- Corrigir um defeito em toda a base instalada vira publicar. O caixa recarrega
  e está atualizado — sem visita, sem instalador novo, sem versão divergente
  entre estações.
- O instalador encolhe: instala servidor e Agente Local, não a tela.
- O PDV passa a rodar em tablet, o que abre balcão auxiliar e conferência de
  estoque em corredor sem nenhum trabalho adicional.
- Uma casca a menos para manter: hoje o Electron precisa ser atualizado por
  causa de CVE do Chromium mesmo quando o produto não mudou.

### Negativas — o custo aceito, declarado honestamente

- **A casca Electron da etapa 9a é reduzida a quiosque.** O processo principal
  atual — que hospeda fila, catálogo e impressão — deixa de existir nessa forma;
  a parte cara dele migra para o Agente Local. O que resta é abrir uma janela.
- **Risco de descarte de cache pelo navegador.** Sob pressão extrema de disco, o
  navegador pode limpar o que guardou, e a tela precisaria ser baixada de novo
  do servidor da loja. Mitigado por `navigator.storage.persist()` e por a
  máquina de caixa ser dedicada. É real, e é pequeno.
- Mais uma peça na instalação que pode falhar: se o Agente Local não subir, a
  estação vende mas não imprime. Precisa de verificação de saúde visível.

### Neutras

- A retaguarda já era web. Ganha PWA pelo mesmo caminho, sem decisão nova.

## Como reverter

O Agente Local é um processo Node com fronteira HTTP local. Voltar ao Electron
seria embrulhá-lo de novo numa casca e trocar HTTP por IPC — a lógica de
impressão, fila e catálogo não é tocada. É por isso que esta decisão é
reversível a custo baixo, e foi tomada sem esperar mais evidência.
