/**
 * Onde cada coisa mora numa instalação Windows.
 *
 * ### Por que o banco não fica junto do programa
 *
 * `C:\Program Files` concede escrita **apenas** a Administradores e ao SYSTEM.
 * Isso parece bastar num instalador que roda elevado — e não basta: ao perceber
 * que está com privilégio administrativo, o `initdb` **cria um token restrito**,
 * removendo o grupo Administradores, e se re-executa com ele. É proteção
 * deliberada do PostgreSQL, porque um cluster cujo dono é administrador é um
 * cluster que pode reescrever o sistema operacional.
 *
 * O efeito é que o processo que realmente cria o cluster perdeu exatamente o
 * grupo que dava acesso à pasta. Ele falha ao ajustar as permissões do próprio
 * diretório de dados — e falha depois de o instalador já ter copiado tudo.
 *
 * `C:\ProgramData` existe para isto: dado de aplicação que um serviço escreve.
 * Além do `initdb`, resolve `log\` e `backup\`, que têm o mesmo problema pelo
 * mesmo motivo — só não apareceu antes porque o serviço sobe como SYSTEM, que
 * tem acesso, enquanto um backup disparado por outra conta não teria.
 *
 * A separação também é a convenção do Windows, e não um contorno: em
 * `Program Files` fica o que só é lido; o que muda mora fora.
 */

import { win32, type PlatformPath } from "node:path";

/** Raiz do que o serviço escreve. O instalador passa o caminho real. */
export const PASTA_DE_DADOS_PADRAO = "C:\\ProgramData\\ERP PDV";

export interface CaminhosDaInstalacao {
  /** O cluster do PostgreSQL. */
  readonly cluster: string;
  /** Log do serviço, com rotação feita pelo NSSM. */
  readonly log: string;
  /** Destino dos backups. */
  readonly backup: string;
  /** Senha que o `initdb` lê e o instalador apaga em seguida. */
  readonly senhaInicial: string;
}

/**
 * Monta os caminhos a partir da raiz de dados.
 *
 * O sabor de caminho é parâmetro, com `win32` por padrão: é o destino real do
 * produto, e fixá-lo faz o teste afirmar strings do Windows mesmo rodando no
 * Linux do CI. Quem chama em produção passa o `path` da plataforma — que no
 * Windows **é** o `win32`, e no Linux permite ensaiar a instalação inteira
 * antes de gastar uma máquina de verdade.
 */
export function caminhosDeDados(
  raizDeDados: string,
  caminho: PlatformPath = win32,
): CaminhosDaInstalacao {
  const base = raizDeDados.replace(/[\\/]+$/, "");

  return {
    cluster: caminho.join(base, "dados"),
    log: caminho.join(base, "log"),
    backup: caminho.join(base, "backup"),
    senhaInicial: caminho.join(base, "senha-inicial.txt"),
  };
}
