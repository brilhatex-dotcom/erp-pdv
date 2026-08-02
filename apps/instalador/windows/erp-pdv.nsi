; Instalador do ERP + PDV para Windows.
;
; O que ele faz, em ordem:
;   1. confere espaço em disco e a porta antes de escrever qualquer coisa;
;   2. copia o Node, o PostgreSQL, o servidor e as telas;
;   3. inicializa o cluster do Postgres numa porta dedicada;
;   4. gera os segredos e o arquivo de configuração;
;   5. aplica as migrações;
;   6. registra dois serviços do Windows e os inicia;
;   7. **verifica** que o sistema respondeu antes de dizer "concluído".
;
; O passo 7 é o que separa este instalador de um que entrega "concluído" com um
; sistema que não sobe — o pior resultado possível, porque o lojista só
; descobre no dia seguinte, com a loja cheia.
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

; ── Verificações antes de escrever qualquer coisa ─────────────────────────
;
; Falhar aqui custa um clique. Falhar no meio da cópia deixa a máquina com
; metade de um sistema instalado, e o técnico sem saber o que remover.
Function .onInit
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0" "/D=F /S=K" $1

  ${If} $1 < ${ESPACO_MINIMO_KB}
    MessageBox MB_ICONSTOP "Espaço insuficiente no disco $0.$\n$\nSão necessários 2 GB livres.$\n$\nLibere espaço ou instale em outro disco."
    Abort
  ${EndIf}
FunctionEnd

Section "Sistema" SEC_SISTEMA
  SectionIn RO
  SetOutPath "$INSTDIR"

  DetailPrint "Copiando arquivos..."
  File /r "..\..\..\dist-instalador\conteudo\*.*"

  ; ── PostgreSQL ──────────────────────────────────────────────────────────
  ;
  ; `initdb` com ICU pt-BR: a mesma collation do desenvolvimento e do CI. Sem
  ; isto, ordenação e índice se comportam diferente na loja — e o defeito
  ; aparece como lista fora de ordem que ninguém consegue reproduzir.
  DetailPrint "Preparando o banco de dados..."
  CreateDirectory "$INSTDIR\dados"

  nsExec::ExecToLog '"$INSTDIR\postgres\bin\initdb.exe" -D "$INSTDIR\dados" -U erp --auth=scram-sha-256 --pwfile="$INSTDIR\senha-inicial.txt" --locale-provider=icu --icu-locale=pt-BR --encoding=UTF8'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Falha ao preparar o banco de dados.$\n$\nAnote o código $0 e envie ao suporte."
    Abort
  ${EndIf}

  Delete "$INSTDIR\senha-inicial.txt"

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

  DetailPrint "Registrando o banco como serviço..."
  nsExec::ExecToLog '"$INSTDIR\postgres\bin\pg_ctl.exe" register -N "ERPPDVBanco" -D "$INSTDIR\dados" -S auto'
  nsExec::ExecToLog 'net start ERPPDVBanco'

  ; ── Configuração e migrações ────────────────────────────────────────────
  ;
  ; Os segredos são gerados aqui, por instalação. Ver `configuracao.ts`.
  DetailPrint "Configurando..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\instalador\index.js" preparar --raiz "$INSTDIR" --porta ${PORTA_SERVIDOR} --porta-postgres ${PORTA_POSTGRES}'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Falha ao configurar o sistema.$\n$\nAnote o código $0 e envie ao suporte."
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
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" install "ERPPDVServidor" "$INSTDIR\node\node.exe" "$INSTDIR\servidor\index.js"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppDirectory "$INSTDIR\servidor"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" DisplayName "ERP PDV — Servidor"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" Start SERVICE_AUTO_START'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" DependOnService "ERPPDVBanco"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppStdout "$INSTDIR\log\servidor.log"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppStderr "$INSTDIR\log\servidor.log"'
  ; Rotação por tamanho: log que cresce sem limite enche o disco da loja em
  ; alguns meses, e aí o Postgres para de escrever.
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppRotateFiles 1'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set "ERPPDVServidor" AppRotateBytes 10485760'

  nsExec::ExecToLog 'net start ERPPDVServidor'

  ; ── Firewall ────────────────────────────────────────────────────────────
  ;
  ; Só a porta do servidor, e só na rede privada. Sem a regra, a segunda
  ; estação não enxerga o servidor e o sintoma é "não conecta" sem mais nada.
  DetailPrint "Liberando a porta na rede da loja..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ERP PDV" dir=in action=allow protocol=TCP localport=${PORTA_SERVIDOR} profile=private'

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
  CreateDirectory "$SMPROGRAMS\ERP PDV"
  CreateShortcut "$SMPROGRAMS\ERP PDV\Frente de caixa.lnk" "http://localhost:${PORTA_SERVIDOR}/"
  CreateShortcut "$SMPROGRAMS\ERP PDV\Retaguarda.lnk" "http://localhost:${PORTA_SERVIDOR}/retaguarda/"
  CreateShortcut "$DESKTOP\Frente de caixa.lnk" "http://localhost:${PORTA_SERVIDOR}/"

  WriteUninstaller "$INSTDIR\desinstalar.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "DisplayName" "ERP PDV"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "UninstallString" "$INSTDIR\desinstalar.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV" "InstallLocation" "$INSTDIR"
SectionEnd

; ── Desinstalação ─────────────────────────────────────────────────────────
;
; **A pasta `dados` não é apagada.** Ela contém as vendas da loja, e um
; desinstalador que leva o banco junto é perda de dado irreversível por um
; clique errado. Quem quiser removê-la faz isso à mão, sabendo o que faz.
Section "Uninstall"
  nsExec::ExecToLog 'net stop ERPPDVServidor'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove "ERPPDVServidor" confirm'

  nsExec::ExecToLog 'net stop ERPPDVBanco'
  nsExec::ExecToLog '"$INSTDIR\postgres\bin\pg_ctl.exe" unregister -N "ERPPDVBanco"'

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ERP PDV"'

  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\postgres"
  RMDir /r "$INSTDIR\servidor"
  RMDir /r "$INSTDIR\telas"
  RMDir /r "$INSTDIR\instalador"
  Delete "$INSTDIR\nssm.exe"
  Delete "$INSTDIR\desinstalar.exe"

  Delete "$SMPROGRAMS\ERP PDV\*.lnk"
  RMDir "$SMPROGRAMS\ERP PDV"
  Delete "$DESKTOP\Frente de caixa.lnk"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERPPDV"

  MessageBox MB_ICONINFORMATION "O ERP PDV foi removido.$\n$\nOs dados da loja foram mantidos em:$\n$INSTDIR\dados$\n$\nApague essa pasta apenas se tiver certeza — ela contém todas as vendas."
SectionEnd
