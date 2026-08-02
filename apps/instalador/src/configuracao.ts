import { randomBytes } from "node:crypto";

/**
 * O arquivo de configuração que a instalação gera.
 *
 * ### Nada aqui é digitado pelo lojista
 *
 * Senha de banco, segredo de token e segredo do Agente são **gerados na
 * instalação**, com `randomBytes`. Pedir para o lojista escolher produziria
 * `123456` em metade da base instalada — e um segredo fraco no servidor da loja
 * é a chave de todas as sessões.
 *
 * ### Por que porta não-padrão no PostgreSQL
 *
 * A máquina do cliente pode já ter um Postgres — de outro sistema, de um
 * técnico que testou algo. Subir na 5432 conflitaria, e o instalador falharia
 * numa mensagem que ninguém entende. A porta dedicada isola por construção
 * (ARQUITETURA.md §5.2.1).
 */

/** Porta do servidor da loja. As estações apontam para cá. */
export const PORTA_SERVIDOR_PADRAO = 3000;

/** Porta dedicada do PostgreSQL embarcado, longe da 5432. */
export const PORTA_POSTGRES_PADRAO = 55433;

export interface Segredos {
  readonly senhaBanco: string;
  readonly segredoToken: string;
  readonly segredoAgente: string;
}

/**
 * Gera os segredos da instalação.
 *
 * 256 bits em `base64url` para cada um. `randomBytes` é o gerador
 * criptográfico do sistema — `Math.random` aqui seria previsível a partir de
 * uma amostra, e a amostra é o próprio token que o servidor devolve.
 *
 * A senha do banco não leva `:` `@` `/` porque entra numa URL de conexão, e
 * escapar isso corretamente em três lugares diferentes é onde o defeito mora.
 * `base64url` já não tem nenhum dos três.
 */
export function gerarSegredos(
  aleatorios: (bytes: number) => Buffer = randomBytes,
): Segredos {
  return {
    senhaBanco: aleatorios(32).toString("base64url"),
    segredoToken: aleatorios(32).toString("base64url"),
    segredoAgente: aleatorios(32).toString("base64url"),
  };
}

export interface DadosDaInstalacao {
  /** Onde o sistema foi instalado. */
  readonly raiz: string;
  readonly portaServidor: number;
  readonly portaPostgres: number;
  readonly segredos: Segredos;
  /** Nome da máquina, para o operador saber a qual servidor está ligado. */
  readonly estacao: string;
}

/**
 * Monta a URL de conexão.
 *
 * `localhost` e não `127.0.0.1`: o Postgres embarcado escuta em ambos, e em
 * máquina com IPv6 desligado por política o nome resolve e o número nem sempre.
 */
export function urlDoBanco(dados: {
  readonly portaPostgres: number;
  readonly senhaBanco: string;
}): string {
  return `postgresql://erp:${dados.senhaBanco}@localhost:${String(dados.portaPostgres)}/erp_pdv?schema=public`;
}

/**
 * Gera o conteúdo do `.env` da instalação.
 *
 * Texto simples, e não JSON: é o que o Node lê sem biblioteca, e é o que o
 * suporte consegue ler e corrigir por telefone com o lojista abrindo no
 * Bloco de Notas.
 *
 * As origens permitidas incluem o próprio servidor pelo nome e pelo IP local —
 * a estação do balcão acessa por um, o computador da retaguarda pelo outro, e
 * uma origem faltando aparece como tela em branco sem explicação.
 */
export function conteudoDoEnv(dados: DadosDaInstalacao): string {
  const porta = String(dados.portaServidor);

  return [
    "# Gerado pelo instalador. Não edite à mão sem falar com o suporte:",
    "# os segredos abaixo autenticam o sistema inteiro.",
    "NODE_ENV=production",
    `PORTA=${porta}`,
    // `0.0.0.0` e não `127.0.0.1`: as estações do balcão precisam alcançar o
    // servidor pela rede da loja. O firewall do Windows é quem restringe.
    "ENDERECO=0.0.0.0",
    `DATABASE_URL=${urlDoBanco({ portaPostgres: dados.portaPostgres, senhaBanco: dados.segredos.senhaBanco })}`,
    `SEGREDO_TOKEN=${dados.segredos.segredoToken}`,
    `ORIGENS_PERMITIDAS=http://localhost:${porta},http://${dados.estacao}:${porta}`,
    `PASTA_PDV=${caminhoDeTela(dados.raiz, "pdv")}`,
    `PASTA_RETAGUARDA=${caminhoDeTela(dados.raiz, "retaguarda")}`,
    "",
  ].join("\n");
}

/**
 * As telas ficam dentro da pasta instalada.
 *
 * Barra normal mesmo no Windows: o Node aceita as duas, e a barra invertida no
 * `.env` viraria escape na primeira vez que alguém lesse o arquivo com uma
 * biblioteca que interpreta `\n`.
 */
function caminhoDeTela(raiz: string, qual: string): string {
  return `${raiz.replaceAll("\\", "/")}/telas/${qual}`;
}

/** Configuração do Agente Local, gravada na estação. */
export function conteudoDoEnvDoAgente(dados: {
  readonly servidor: string;
  readonly portaServidor: number;
  readonly segredoAgente: string;
}): string {
  return [
    "# Gerado pelo instalador, na estação de caixa.",
    `ERP_SERVIDOR=http://${dados.servidor}:${String(dados.portaServidor)}`,
    `ERP_SEGREDO_AGENTE=${dados.segredoAgente}`,
    "",
  ].join("\n");
}
