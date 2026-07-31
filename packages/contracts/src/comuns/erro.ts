import { z } from "zod";

/**
 * Envelope de erro — **um só formato para toda a API**.
 *
 * Cliente que precisa reconhecer três formatos de erro diferentes trata bem o
 * primeiro e mal os outros dois; na prática isso aparece como a tela do PDV
 * mostrando "erro inesperado" para uma falha que o servidor descreveu com
 * clareza.
 *
 * O que **não** está aqui é tão importante quanto o que está: nenhum campo
 * carrega `detalhes` técnicos, mensagem de exceção ou pilha. Contexto de
 * diagnóstico vai para o log do servidor, correlacionado por `correlacao`. Isso
 * cumpre a proibição do CLAUDE.md §9 no ponto onde ela seria violada por
 * descuido — e evita que o formato de um erro interno vaze detalhe de
 * implementação para quem não devia vê-lo (ARQUITETURA.md §7.1).
 */

/**
 * Categorias de erro.
 *
 * São as cinco de `TipoErro` do domínio mais `INDISPONIVEL`, que só existe no
 * fio: para o domínio, banco fora é um conflito qualquer; para o PDV, é a
 * diferença entre "corrija e tente outra vez" e "tente igual em dois segundos".
 * Essa distinção decide se o operador refaz a venda ou espera — e errá-la custa
 * uma venda perdida no balcão.
 */
export const TIPOS_ERRO = [
  "VALIDACAO",
  "REGRA_NEGOCIO",
  "NAO_ENCONTRADO",
  "CONFLITO",
  "NAO_AUTORIZADO",
  "INDISPONIVEL",
] as const;

export const zTipoErroApi = z.enum(TIPOS_ERRO);

export type TipoErroApi = z.infer<typeof zTipoErroApi>;

export const zRespostaErro = z.object({
  erro: z.object({
    /** Código estável. É por ele que o cliente decide o que fazer. */
    codigo: z.string().min(1),
    /** Categoria, para o cliente tratar famílias de erro sem enumerar códigos. */
    tipo: zTipoErroApi,
    /** Texto exibível direto ao operador, já em português e sem jargão. */
    mensagem: z.string().min(1),
    /** Liga esta resposta à linha do log do servidor. É o que o suporte pede. */
    correlacao: z.string().min(1),
  }),
});

export type RespostaErro = z.infer<typeof zRespostaErro>;

/**
 * Cabeçalho de correlação.
 *
 * O cliente pode enviá-lo para amarrar sua própria linha de log à do servidor;
 * quando não envia, o servidor gera. A resposta sempre o devolve.
 */
export const CABECALHO_CORRELACAO = "x-correlacao";

/** Falha não prevista. Nunca acompanha detalhe: o operador não pode agir sobre ele. */
export const CODIGO_ERRO_INTERNO = "ERRO_INTERNO";

/** Caminho ou método que a API não atende. */
export const CODIGO_ROTA_NAO_ENCONTRADA = "ROTA_NAO_ENCONTRADA";

/** Corpo, parâmetro ou cabeçalho que não satisfaz o schema da rota. */
export const CODIGO_REQUISICAO_INVALIDA = "REQUISICAO_INVALIDA";

/** Requisições acima do limite da janela. */
export const CODIGO_EXCESSO_REQUISICOES = "EXCESSO_REQUISICOES";

/** Dependência fora do ar: banco, provedor fiscal, impressora. */
export const CODIGO_SERVICO_INDISPONIVEL = "SERVICO_INDISPONIVEL";
