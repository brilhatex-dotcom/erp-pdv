/**
 * As formas de pagamento do balcão, na ordem em que a tecla numérica as
 * escolhe: 1 dinheiro, 2 Pix, 3 débito, 4 crédito, 5 fiado.
 *
 * Os textos de orientação são o que o operador precisa fazer **fora** do
 * sistema — passar na maquininha, conferir o aplicativo do banco —, porque é
 * ali que mora o erro caro: confirmar um Pix que não caiu.
 */

export type CodigoForma =
  "DINHEIRO" | "PIX" | "CARTAO_DEBITO" | "CARTAO_CREDITO" | "CREDIARIO";

export interface FormaDoBalcao {
  readonly codigo: CodigoForma;
  readonly tecla: string;
  readonly rotulo: string;
  /** Rótulo do botão que confirma. */
  readonly confirmar: string;
  readonly orientacao: string;
}

export const FORMAS: readonly FormaDoBalcao[] = [
  {
    codigo: "DINHEIRO",
    tecla: "1",
    rotulo: "Dinheiro",
    confirmar: "Receber dinheiro",
    orientacao: "Digite quanto o cliente entregou. O troco aparece na hora.",
  },
  {
    codigo: "PIX",
    tecla: "2",
    rotulo: "Pix",
    confirmar: "Pix recebido",
    orientacao:
      "Confira no aplicativo do banco que o Pix caiu antes de confirmar. Sem integração bancária, a confirmação é sua.",
  },
  {
    codigo: "CARTAO_DEBITO",
    tecla: "3",
    rotulo: "Débito",
    confirmar: "Cartão aprovado",
    orientacao: "Passe o cartão na maquininha e confirme só depois de aprovado.",
  },
  {
    codigo: "CARTAO_CREDITO",
    tecla: "4",
    rotulo: "Crédito",
    confirmar: "Cartão aprovado",
    orientacao: "Passe o cartão na maquininha e confirme só depois de aprovado.",
  },
  {
    codigo: "CREDIARIO",
    tecla: "5",
    rotulo: "Fiado",
    confirmar: "Lançar no fiado",
    orientacao: "O valor fica na conta do cliente, para ele pagar depois.",
  },
];

/** "Dinheiro", "Pix", "Débito"… — e o próprio código para forma desconhecida. */
export function rotuloDaForma(forma: string): string {
  return FORMAS.find((atual) => atual.codigo === forma)?.rotulo ?? forma;
}

/** Como o pagamento aparece na lista e no comprovante. */
export function descreverPagamento(forma: string, confirmacao: string): string {
  const rotulo = rotuloDaForma(forma);

  if (forma === "PIX" && confirmacao === "MANUAL") return "Pix (conferido pelo operador)";
  if (confirmacao === "SIMULADA") return `${rotulo} (treinamento)`;

  return rotulo;
}
