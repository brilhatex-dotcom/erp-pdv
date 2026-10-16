/**
 * O estado real de cada integração, dito por quem as monta.
 *
 * Fica na composição porque é ela que sabe o que está ligado: uma tela que
 * decidisse sozinha "Pix: disponível" estaria afirmando o que o servidor não
 * faz. O pedido do cliente é explícito — cada integração aparece como
 * disponível, em configuração ou não implementada, e nada se apresenta como
 * funcionando sem funcionar.
 */

export type SituacaoIntegracao = "DISPONIVEL" | "EM_CONFIGURACAO" | "NAO_IMPLEMENTADA";

export interface Integracao {
  readonly codigo: string;
  readonly nome: string;
  readonly situacao: SituacaoIntegracao;
  /** Uma frase para o dono: o que funciona hoje e o que falta. */
  readonly explicacao: string;
}

export const INTEGRACOES: readonly Integracao[] = [
  {
    codigo: "LEITOR_CODIGO_BARRAS",
    nome: "Leitor de código de barras",
    situacao: "DISPONIVEL",
    explicacao:
      "Leitores USB que funcionam como teclado já funcionam: é só ligar e bipar na tela de venda.",
  },
  {
    codigo: "ETIQUETA_BALANCA",
    nome: "Etiqueta da balança",
    situacao: "DISPONIVEL",
    explicacao:
      "Etiquetas com peso ou preço embutido (EAN-13 começando em 2) são lidas pelo leitor. O formato se ajusta na configuração.",
  },
  {
    codigo: "BALANCA_CONECTADA",
    nome: "Balança ligada ao computador",
    situacao: "NAO_IMPLEMENTADA",
    explicacao:
      "A leitura direta do peso pela porta serial ou USB ainda não existe. Hoje o operador digita o peso mostrado na balança.",
  },
  {
    codigo: "IMPRESSORA_TERMICA",
    nome: "Impressora de comprovante",
    situacao: "DISPONIVEL",
    explicacao:
      "Impressoras térmicas ESC/POS de 58 ou 80 mm, pelo Agente Local instalado no caixa. Sem ele, o comprovante sai pela impressão do navegador.",
  },
  {
    codigo: "PIX_AUTOMATICO",
    nome: "Pix com confirmação automática",
    situacao: "NAO_IMPLEMENTADA",
    explicacao:
      "O Pix é registrado e o operador confirma que o valor caiu, olhando o aplicativo do banco. A confirmação automática depende de contratar um banco ou intermediador.",
  },
  {
    codigo: "MAQUININHA",
    nome: "Maquininha de cartão integrada (TEF)",
    situacao: "NAO_IMPLEMENTADA",
    explicacao:
      "O cartão é passado na maquininha, e o operador registra a forma e o valor. O sistema não guarda número de cartão.",
  },
  {
    codigo: "NFCE",
    nome: "Nota fiscal do consumidor (NFC-e)",
    situacao: "NAO_IMPLEMENTADA",
    explicacao:
      "O comprovante impresso hoje não é documento fiscal. A emissão de NFC-e depende de certificado digital, credenciamento na SEFAZ do estado e contratação da API fiscal.",
  },
];
