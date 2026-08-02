# Instalação

> Guia do técnico que instala o ERP + PDV numa loja. Escrito para quem está lá,
> sozinho, com o lojista esperando.

---

## O que o instalador faz

Um executável só. Ele:

1. confere **espaço em disco** antes de escrever qualquer coisa, e as **portas**
   logo depois de copiar;
2. copia o Node, o PostgreSQL, o servidor e as telas;
3. **gera os segredos** — senha do banco, segredo de token e segredo do Agente —
   com gerador criptográfico, diferentes em cada instalação;
4. inicializa o banco numa **porta dedicada** (55433), isolado de qualquer
   PostgreSQL que já exista na máquina;
5. cria o banco e aplica as migrações;
6. registra dois serviços do Windows e os inicia;
7. **confere que o sistema respondeu** antes de dizer "concluído".

O passo 7 é o que separa este instalador de um que entrega "concluído" com um
sistema que não sobe — o pior resultado possível, porque o lojista só descobre
no dia seguinte, com a loja cheia.

Os segredos vêm **antes** do banco de propósito: é a configuração que escolhe a
senha que o `initdb` vai usar. Na ordem inversa, o sistema subiria com uma senha
que o banco recém-criado não reconhece.

### Rodar o instalador duas vezes é seguro

Atualização de versão, técnico refazendo um passo, clique duplo sem querer: cada
passo destrutivo é condicionado à ausência do que ele criaria. O cluster não é
reinicializado, o banco não é recriado, e **os segredos da instalação anterior
são preservados**. Sem isso, a segunda execução deixaria as vendas no disco e a
chave para lê-las perdida — um estrago que nem o backup desfaz, porque o backup
guarda o dado, não a senha.

---

## Requisitos

| Item | Mínimo |
|---|---|
| Sistema | Windows 10 ou 11, 64 bits |
| Memória | 4 GB |
| Disco livre | 2 GB |
| Permissão | Administrador |

---

## ⚠️ O aviso do Windows

**O instalador não é assinado digitalmente.** Ao executá-lo, o Windows mostra
uma tela azul dizendo *"O Windows protegeu o computador"* com **"Editor
desconhecido"**.

Isso é esperado. Clique em **Mais informações** e depois em **Executar assim
mesmo**.

> **Por que não é assinado:** um certificado de código custa entre R$ 1.500 e
> R$ 5.000 por ano, e desde 2023 exige token físico ou HSM na nuvem — o que
> também complica assinar dentro da automação. A decisão foi não pagar esse
> custo antes de haver base instalada. Quando houver, é um passo a mais no
> workflow de release; nada no produto muda.

---

## Depois de instalar

### O que fica na máquina

```
C:\Program Files\ERP PDV\          ← o programa (só leitura em uso)
├── node\            Node.js embarcado
├── postgres\        PostgreSQL embarcado
├── servidor\        A aplicação e o .env gerado
├── instalador\      Configuração, migrações e verificação
├── agente\          Agente Local, para quando o servidor também é caixa
└── telas\           PDV e retaguarda

C:\ProgramData\ERP PDV\            ← o que o serviço escreve
├── dados\           ⚠️ O BANCO DA LOJA. Nunca apagar.
├── log\             servidor.log, com rotação a cada 10 MB
└── backup\
```

**Por que o banco não fica junto do programa.** `Program Files` concede escrita
apenas a Administradores e ao SYSTEM. Isso parece bastar num instalador que roda
elevado — e não basta: ao perceber privilégio administrativo, o `initdb` cria um
**token restrito**, sem o grupo Administradores, e se re-executa com ele, para
que o cluster não pertença a um administrador. O processo que de fato cria o
banco perdeu exatamente o grupo que dava acesso à pasta.

`C:\ProgramData` existe para isto, e é a convenção do Windows: em `Program
Files` fica o que só é lido; o que muda mora fora. Vale também para `log\` e
`backup\`.

A pasta `instalador\` **fica na máquina** de propósito: é ela que aplica as
migrações na próxima atualização de versão. Ela carrega o CLI do Prisma e o
motor de schema porque a instalação embarca só o `node.exe` — não há `npm`, não
há `npx`, e a loja pode não ter internet no dia em que a atualização rodar.

### Os dois serviços

| Serviço | Nome no Windows |
|---|---|
| Banco de dados | `ERPPDVBanco` |
| Servidor | `ERP PDV — Servidor` (`ERPPDVServidor`) |

O servidor **depende** do banco: o Windows sobe os dois na ordem certa depois
de um reinício, sem ninguém tocar em nada.

### Como acessar

| Onde | Endereço |
|---|---|
| Frente de caixa | `http://localhost:3000/` |
| Retaguarda | `http://localhost:3000/retaguarda/` |
| De outra estação | `http://NOME-DO-SERVIDOR:3000/` |

O instalador cria os atalhos na área de trabalho e no menu Iniciar.

### Primeiro acesso

Na primeira abertura, a retaguarda pede para **criar o administrador**. Não há
usuário padrão nem senha de fábrica — senha de fábrica que ninguém troca é a
porta aberta em toda a base instalada.

Depois disso: cadastre a **empresa** (é o cabeçalho de todo relatório) e os
usuários do balcão.

---

## Instalar uma estação de caixa

A estação **não** recebe o sistema inteiro. Ela precisa só do **Agente Local**,
que é quem fala com a impressora e guarda a fila offline (ADR-0023).

Na estação:

1. rode o instalador escolhendo **"Somente estação de caixa"**;
2. informe o **nome do servidor** da loja;
3. abra `http://NOME-DO-SERVIDOR:3000/` no Chrome ou Edge;
4. instale como aplicativo: menu **⋮ → Instalar**.

A partir daí a tela abre como programa, em tela cheia, e **funciona com o
servidor fora do ar** — o service worker guarda a tela e o Agente guarda as
vendas até a rede voltar.

---

## Quando algo dá errado

### O instalador terminou com aviso de que o sistema não respondeu

O sistema está instalado; o que falhou foi a subida. Abra **Serviços** do
Windows (`services.msc`) e veja `ERP PDV — Servidor`:

| Estado | O que fazer |
|---|---|
| Parado | Clique com o botão direito → **Iniciar**. Se voltar a parar, veja o log |
| Em execução | O sistema deve estar no ar. Tente `http://localhost:3000/` |

O log fica em `C:\ProgramData\ERP PDV\log\servidor.log`. As últimas linhas
dizem o que houve.

### A estação não enxerga o servidor

Nesta ordem:

1. **Ping**: `ping NOME-DO-SERVIDOR` a partir da estação;
2. **Firewall**: o instalador libera a porta 3000 no perfil **privado**. Se a
   rede da loja estiver marcada como *pública* no Windows, a regra não vale.
   Mude a rede para privada em **Configurações → Rede**;
3. **Nome**: se o ping por nome falha e por IP funciona, use o IP no endereço.

### A porta 3000 já está em uso

Outro programa a ocupou. Descubra qual:

```
netstat -ano | findstr :3000
```

O último número é o PID; procure-o no Gerenciador de Tarefas. Feche o programa
ou reinstale escolhendo outra porta.

### Preciso reinstalar

Desinstale pelo Painel de Controle. **Nada em `C:\ProgramData\ERP PDV` é
apagado** — o desinstalador mantém banco, log e backups de propósito, porque ali
estão todas as vendas da loja. Reinstalar por cima reaproveita o banco e
preserva os segredos.

Para começar do zero — e **perder tudo** —, apague `C:\ProgramData\ERP PDV` à
mão antes de reinstalar.

---

## O que ainda não existe

Registrado com honestidade, para o técnico não procurar o que não há:

- **Backup automático.** A pasta existe e nada a preenche ainda (módulo 15).
  Até lá, copie `C:\ProgramData\ERP PDV\dados` com o serviço parado.
- **Atualização automática.** Atualizar hoje é rodar o instalador da versão
  nova por cima (módulo 17).
- **Instalação da estação em modo separado.** O instalador ainda instala tudo;
  o modo "somente estação" está previsto e não implementado.
- **Emissão fiscal.** O produto usa provedor simulado (ADR-0022). **Serve para
  demonstração, homologação e implantação — não para uma loja operar
  legalmente.**
