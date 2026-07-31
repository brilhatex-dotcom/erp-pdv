// ── Escalares do fio ────────────────────────────────────────────────────
export {
  inteiroDeTexto,
  textoDeInteiro,
  zCentavos,
  zCentavosNaoNegativos,
  zDataHora,
  zIdentificador,
  zMilesimos,
  zMilesimosNaoNegativos,
} from "./comuns/escalares.js";

// ── Erros ───────────────────────────────────────────────────────────────
export {
  CABECALHO_CORRELACAO,
  CODIGO_ERRO_INTERNO,
  CODIGO_EXCESSO_REQUISICOES,
  CODIGO_REQUISICAO_INVALIDA,
  CODIGO_ROTA_NAO_ENCONTRADA,
  CODIGO_SERVICO_INDISPONIVEL,
  type RespostaErro,
  TIPOS_ERRO,
  type TipoErroApi,
  zRespostaErro,
  zTipoErroApi,
} from "./comuns/erro.js";

// ── Saúde ───────────────────────────────────────────────────────────────
export {
  type RespostaProntidao,
  type RespostaSaude,
  type Verificacao,
  zRespostaProntidao,
  zRespostaSaude,
  zVerificacao,
} from "./saude/saude.js";
