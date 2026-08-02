; Instalador do ERP + PDV para Windows.
;
; O que ele faz, em ordem:
;   1. confere espaço em disco antes de escrever qualquer coisa;
;   2. copia o Node, o PostgreSQL, o servidor e as telas;
;   3. **gera os segredos e o arquivo de configuração** — antes do banco,
;      porque é a configuração que escolhe a senha que o `initdb` vai usar;
;   4. inicializa o cluster do Postgres numa porta dedicada;
;   5. cria o banco e aplica as migrações;
;   6. registra dois serviços do Windows e os inicia;
;   7. **verifica** que o sistema respondeu antes de dizer "concluído".
;
; O passo 7 é o que separa este instalador de um que entrega "concluído" com um
; sistema que não sobe — o pior resultado possível, porque o lojista só
; descobre no dia seguinte, com a loja cheia.
;
; ### Rodar duas vezes não pode destruir nada
;
; Reinstalar por cima de uma loja em operação é caso real: atualização de
; versão, técnico refazendo um passo, instalador executado em duplicidade. Cada
; passo destrutivo aqui é condicionado à ausência do que ele criaria — o
; cluster não é reinicializado, o banco não é recriado, e os segredos do `.env`
; anterior são preservados pelo `preparar`. Sem isso, a segunda execução
; deixaria as vendas no disco e a chave para lê-las perdida.
;
; ⚠️ NÃO ASSINADO. Sem certificado de código, o Windows mostra "Editor
; desconhecido" no SmartScreen e o usuário precisa clicar em "Mais informações
; → Executar assim mesmo". É decisão registrada (custo recorrente de R$ 1.500 a
; 5.000/ano), e o único passo que falta para assinar é `signtool` no workflow —
; nada aqui muda.

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef VERSAO
  !define VERSAO "0.0.0"
!endif

Name "ERP PDV"
OutFile "..\..\..\dist-instalador\erp-pdv-${VERSAO}-instalador.exe"
InstallDir "$PROGRAMFILES64\ERP PDV"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; Espaço mínimo, em kilobytes. O Postgres embarcado ocupa ~200 MB e o banco
; cresce com as vendas; instalar num disco cheio produz uma loja que para de
; vender no meio do expediente.
!define ESPACO_MINIMO_KB 2097152

!define PORTA_SERVIDOR "3000"
!define PORTA_POSTGRES "55433"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Sistema" SEC_SISTEMA
  SectionIn RO

  ; ── Verificação antes de escrever qualquer coisa ────────────────────────
  ;
  ; Aqui, e não em `.onInit`: naquele momento `$INSTDIR` ainda é o padrão, e o
  ; técnico que escolhe outro disco justamente porque o C: está cheio seria
  ; barrado antes de conseguir escolher.
  ;
  ; Falhar aqui custa um clique. Falhar no meio da cópia deixa a máquina com
  ; metade de um sistema instalado, e o técnico sem saber o que remover.
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0" "/D=F /S=K" $1

  ${If} $1 < ${ESPACO_MINIMO_KB}
    MessageBox MB_ICONSTOP "Espaço insuficiente no disco $0.$\n$\nSão necessários 2 GB livres.$\n$\nLibere espaço ou instale em outro disco."
    Abort
  ${EndIf}

  SetOutPath "$INSTDIR"

  DetailPrint "Copiando arquivos..."
  File /r "..\..\..\dist-instalador\conteudo\*.*"

  ; ── Configuração ────────────────────────────────────────────────────────
  ;
  ; **Antes do banco.** Os segredos são gerados aqui, por instalação, e a senha
  ; do banco fica em `senha-inicial.txt` para o `initdb` ler logo abaixo.
  ; Inverter esta ordem — gerar a senha depois de criar o cluster — produziria
  ; um `.env` que não abre o banco recém-criado. Ver `configuracao.ts`.
  DetailPrint "Configurando..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" preparar --raiz "$INSTDIR" --porta ${PORTA_SERVIDOR} --porta-postgres ${PORTA_POSTGRES}'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Falha ao configurar o sistema.$\n$\nAnote o código $0 e envie ao suporte."
    Abort
  ${EndIf}

  ; ── Portas ──────────────────────────────────────────────────────────────
  ;
  ; Antes de registrar serviço nenhum. Porta ocupada descoberta no fim apareceria
  ; como "o sistema não respondeu", e o técnico — que já instalou tudo — não teria
  ; como ligar o sintoma à causa. Ver `verificacao.ts`.
  ;
  ; Numa reinstalação as portas estão ocupadas pelos **nossos próprios**
  ; serviços; por isso a conferência só vale quando o banco ainda não existe.
  ${IfNot} ${FileExists} "$INSTDIR\dados\PG_VERSION"
    DetailPrint "Conferindo as portas..."
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" conferir --porta ${PORTA_SERVIDOR} --porta-postgres ${PORTA_POSTGRES}'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "Uma das portas necessárias já está em uso.$\n$\nFeche o programa que a ocupa e instale novamente.$\n$\nPortas: ${PORTA_SERVIDOR} (sistema) e ${PORTA_POSTGRES} (banco)."
      Abort
    ${EndIf}
  ${EndIf}

  ; ── PostgreSQL ──────────────────────────────────────────────────────────
  ;
  ; `PG_VERSION` só existe num cluster já inicializado. Rodar `initdb` sobre ele
  ; falharia — e, se não falhasse, apagaria as vendas da loja.
  ${IfNot} ${FileExists} "$INSTDIR\dados\PG_VERSION"
    DetailPrint "Preparando o banco de dados..."
    CreateDirectory "$INSTDIR\dados"

    ; `initdb` com ICU pt-BR: a mesma collation do desenvolvimento e do CI. Sem
    ; isto, ordenação e índice se comportam diferente na loja — e o defeito
    ; aparece como lista fora de ordem que ninguém consegue reproduzir.
    ;
    ; A senha vai por arquivo, nunca por argumento: argumento de processo é
    ; legível por qualquer usuário da máquina.
    nsExec::ExecToLog '"$INSTDIR\postgres\bin\initdb.exe" -D "$INSTDIR\dados" -U erp --auth=scram-sha-256 --pwfile="$INSTDIR\senha-inicial.txt" --locale-provider=icu --icu-locale=pt-BR --encoding=UTF8'
    Pop $0
    ${If} $0 != 0
      Delete "$INSTDIR\senha-inicial.txt"
      MessageBox MB_ICONSTOP "Falha ao preparar o banco de dados.$\n$\nAnote o código $0 e envie ao suporte."
      Abort
    ${EndIf}

    ; Escuta só em localhost, na porta dedicada. O servidor da loja é o único
    ; que fala com o banco; as estações falam com o servidor, nunca com o banco.
    FileOpen $9 "$INSTDIR\dados\postgresql.auto.conf" a
    FileSeek $9 0 END
    FileWrite $9 "$\r$\nport = ${PORTA_POSTGRES}$\r$\n"
    FileWrite $9 "listen_addresses = 'localhost'$\r$\n"
    ; Integridade contra queda de energia — a preocupação é real neste público.
    FileWrite $9 "synchronous_commit = on$\r$\n"
    FileWrite $9 "full_page_writes = on$\r$\n"
    FileWrite $9 "wal_level = replica$\r$\n"
    ; Perfil conservador, dimensionado para máquina de 4 GB.
    FileWrite $9 "shared_buffers = 256MB$\r$\n"
    FileWrite $9 "work_mem = 8MB$\r$\n"
    FileWrite $9 "max_connections = 20$\r$\n"
    FileClose $9
  ${EndIf}

  ; Fora do `${If}`: se o `initdb` foi pulado, o arquivo ainda assim foi escrito
  ; pelo `preparar` — e um arquivo com a senha do banco não pode ficar no disco.
  Delete "$INSTDIR\senha-inicial.txt"

  DetailPrint "Registrando o banco como serviço..."
  ; Numa reinstalação o serviço já existe e o `register` falha; o que importa é
  ; que ele esteja no ar para os passos seguintes.
  nsExec::ExecToLog '"$INSTDIR\postgres\bin\pg_ctl.exe" register -N "ERPPDVBanco" -D "$INSTDIR\dados" -S auto'
  Pop $0
  nsExec::ExecToLog 'net start ERPPDVBanco'
  Pop $0

  ; ── Banco e migrações ───────────────────────────────────────────────────
  ;
  ; `initdb` cria o cluster e o papel, não o banco. Ver `banco.ts`.
  DetailPrint "Criando o banco..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" criar-banco --raiz "$INSTDIR" --porta-postgres ${PORTA_POSTGRES}'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Falha ao criar o banco.$\n$\nAnote o código $0 e envie ao suporte."
    Abort
  ${EndIf}

  DetailPrint "Criando as tabelas..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" migrar --raiz "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Falha ao criar as tabelas.$\n$\nAnote o código $0 e envie ao suporte."
    Abort
  ${EndIf}

  ; ── Serviços ────────────────────────────────────────────────────────────
  ;
  ; `nssm` porque o Windows não sabe supervisionar um processo comum: sem ele,
  ; o servidor cairia numa exceção e ninguém o levantaria até alguém reiniciar
  ; a máquina. O papel do DevOps veta deploy sem supervisão.
  DetailPrint "Registrando os serviços..."
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" stop "ERPPDVServidor"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" install "ERPPDVServidor" "$INSTDIR\node\node.exe" "$INSTDIR\servidor\index.js"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppDirectory "$INSTDIR\servidor"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" DisplayName "ERP PDV — Servidor"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" Start SERVICE_AUTO_START'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" DependOnService "ERPPDVBanco"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppStdout "$INSTDIR\log\servidor.log"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppStderr "$INSTDIR\log\servidor.log"'
  Pop $0
  ; Rotação por tamanho: log que cresce sem limite enche o disco da loja em
  ; alguns meses, e aí o Postgres para de escrever.
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppRotateFiles 1'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppRotateBytes 10485760'
  Pop $0

  nsExec::ExecToLog 'net start ERPPDVServidor'
  Pop $0

  ; ── Firewall ────────────────────────────────────────────────────────────
  ;
  ; Só a porta do servidor, e só na rede privada. Sem a regra, a segunda
  ; estação não enxerga o servidor e o sintoma é "não conecta" sem mais nada.
  ;
  ; Remove antes de adicionar: `netsh` empilha regras homônimas em vez de
  ; substituir, e uma reinstalação por ano deixa o firewall cheio de cópias.
  DetailPrint "Liberando a porta na rede da loja..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ERP PDV"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ERP PDV" dir=in action=allow protocol=TCP localport=${PORTA_SERVIDOR} profile=private'
  Pop $0

  ; ── Verificação ─────────────────────────────────────────────────────────
  ;
  ; Sem este passo, o instalador diria "concluído" para um sistema que não
  ; sobe. Ver `verificacao.ts`.
  DetailPrint "Conferindo se o sistema respondeu..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" verificar --porta ${PORTA_SERVIDOR}'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "O sistema foi instalado, mas não respondeu na verificação.$\n$\nAbra os Serviços do Windows e confira se $\"ERP PDV — Servidor$\" está em execução.$\n$\nO relatório está em:$\n$INSTDIR\log\servidor.log"
  ${EndIf}

  ; ── Atalhos ─────────────────────────────────────────────────────────────
  ;
  ; Arquivo `.url`, não `.lnk`: atalho do Windows aponta para um **programa**, e
  ; `CreateShortcut` com um endereço http produz um atalho que não abre nada. O
  ; `.url` é o formato de atalho de internet, e abre no navegador padrão da
  ; máquina — que é onde a PWA roda (ADR-0023).
  CreateDirectory "$SMPROGRAMS\ERP PDV"
  Call CriarAtalhos

  WriteUninstaller "$INSTDIR\desinstalar.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "DisplayName" "ERP PDV"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "UninstallString" "$INSTDIR\desinstalar.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "InstallLocation" "$INSTDIR"
SectionEnd

Function CriarAtalhos
  FileOpen $9 "$SMPROGRAMS\ERP PDV\Frente de caixa.url" w
  FileWrite $9 "[InternetShortcut]$\r$\nURL=http://localhost:${PORTA_SERVIDOR}/$\r$\n"
  FileClose $9

  FileOpen $9 "$SMPROGRAMS\ERP PDV\Retaguarda.url" w
  FileWrite $9 "[InternetShortcut]$\r$\nURL=http://localhost:${PORTA_SERVIDOR}/retaguarda/$\r$\n"
  FileClose $9

  FileOpen $9 "$DESKTOP\Frente de caixa.url" w
  FileWrite $9 "[InternetShortcut]$\r$\nURL=http://localhost:${PORTA_SERVIDOR}/$\r$\n"
  FileClose $9
FunctionEnd

; ── Desinstalação ─────────────────────────────────────────────────────────
;
; **As pastas `dados` e `backup` não são apagadas.** Elas contêm as vendas da
; loja, e um desinstalador que leva o banco junto é perda de dado irreversível
; por um clique errado. Quem quiser removê-las faz isso à mão, sabendo o que faz.
Section "Uninstall"
  nsExec::ExecToLog 'net stop ERPPDVServidor'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove "ERPPDVServidor" confirm'
  Pop $0

  nsExec::ExecToLog 'net stop ERPPDVBanco'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\postgres\bin\pg_ctl.exe" unregister -N "ERPPDVBanco"'
  Pop $0

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ERP PDV"'
  Pop $0

  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\postgres"
  RMDir /r "$INSTDIR\servidor"
  RMDir /r "$INSTDIR\telas"
  RMDir /r "$INSTDIR\instalador"
  RMDir /r "$INSTDIR\agente"
  RMDir /r "$INSTDIR\log"
  Delete "$INSTDIR\nssm.exe"
  Delete "$INSTDIR\desinstalar.exe"

  Delete "$SMPROGRAMS\ERP PDV\*.url"
  RMDir "$SMPROGRAMS\ERP PDV"
  Delete "$DESKTOP\Frente de caixa.url"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV"

  MessageBox MB_ICONINFORMATION "O ERP PDV foi removido.$\n$\nOs dados da loja foram mantidos em:$\n$INSTDIR\dados$\n$\nApague essa pasta apenas se tiver certeza — ela contém todas as vendas."
SectionEnd
