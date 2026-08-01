export {
  type Alinhamento,
  COLUNAS_58MM,
  COLUNAS_80MM,
  Cupom,
  paraBytesDaImpressora,
} from "./escpos.js";
export {
  type DadosCupom,
  type ItemDoCupom,
  montarCupomVenda,
  type PagamentoDoCupom,
} from "./cupomVenda.js";
export {
  comoTexto,
  type CupomPrevisto,
  type LinhaDoCupom,
  type MarcaDeEstilo,
  previsualizar,
} from "./previsualizacao.js";
