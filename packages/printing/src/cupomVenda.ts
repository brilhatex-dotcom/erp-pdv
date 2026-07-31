import { COLUNAS_80MM, Cupom } from "./escpos.js";

/**
 * Dados que o cupom precisa.
 *
 * Tipos primitivos de propósito: este pacote **não** conhece `@erp/domain`.
 * Dinheiro chega como centavos em texto, do mesmo jeito que atravessa o HTTP —
 * um layout de impressão não deve arrastar o domínio inteiro para dentro do
 * processo principal do Electron.
 */
export interface DadosCupom {
  readonly loja: {
    readonly nome: string;
    readonly endereco?: string | undefined;
    readonly documento?: string | undefined;
  };
  readonly numero: number;
  readonly emitidoEm: Date;
  readonly operador: string;
  readonly itens: readonly ItemDoCupom[];
  /** Centavos em texto. */
  readonly subtotal: string;
  readonly descontoTotal: string;
  readonly total: string;
  readonly pagamentos: readonly PagamentoDoCupom[];
  readonly troco: string;
  readonly cliente?: string | undefined;
  /**
   * Aviso obrigatório quando o cupom **não** é documento fiscal.
   *
   * Sem ele, um comprovante de venda pode ser confundido com NFC-e — e a loja
   * responde por isso na fiscalização, não o fornecedor do sistema.
   */
  readonly semValorFiscal: boolean;
}

export interface ItemDoCupom {
  readonly numero: number;
  readonly descricao: string;
  /** Milésimos em texto. */
  readonly quantidade: string;
  readonly unidade: string;
  readonly precoUnitario: string;
  readonly total: string;
}

export interface PagamentoDoCupom {
  readonly descricao: string;
  readonly valor: string;
}

/**
 * Cupom de venda.
 *
 * ### O total é o que o cliente confere
 *
 * Sai em corpo dobrado, e é o único elemento em destaque. Destacar tudo é o
 * mesmo que não destacar nada — quem confere o cupom no balcão procura um
 * número só.
 *
 * ### O troco vem depois do total, e também em destaque
 *
 * É o segundo número que a interação exige. Enterrá-lo no meio da lista de
 * pagamentos faz o cliente perguntar, e a fila para.
 *
 * ### A gaveta abre junto, e só quando houve dinheiro
 *
 * Abrir a gaveta em venda paga só no cartão a deixa aberta sem motivo — e uma
 * gaveta aberta sem operador ao lado é convite. O pulso vai no mesmo fluxo de
 * bytes porque a gaveta é ligada na impressora (§4.5).
 */
export function montarCupomVenda(
  dados: DadosCupom,
  opcoes: { readonly colunas?: number; readonly abrirGaveta?: boolean } = {},
): Uint8Array {
  const colunas = opcoes.colunas ?? COLUNAS_80MM;
  const cupom = new Cupom(colunas);

  cupom.iniciar().alinhar("CENTRO").negrito(true).linha(dados.loja.nome).negrito(false);

  if (dados.loja.documento !== undefined) {
    cupom.linha(`CNPJ ${dados.loja.documento}`);
  }
  if (dados.loja.endereco !== undefined) {
    cupom.linha(dados.loja.endereco);
  }

  cupom.quebrar().alinhar("ESQUERDA").separador();

  cupom.entreExtremos(`VENDA ${String(dados.numero)}`, formatarDataHora(dados.emitidoEm));
  cupom.linha(`Operador: ${dados.operador}`);

  if (dados.cliente !== undefined) {
    cupom.linha(`Cliente: ${dados.cliente}`);
  }

  cupom.separador();

  for (const item of dados.itens) {
    // Descrição na própria linha: cortá-la para caber ao lado do preço tira
    // justamente o que o cliente usa para conferir o que levou.
    cupom.paragrafo(`${String(item.numero).padStart(3, "0")} ${item.descricao}`);
    cupom.entreExtremos(
      `    ${formatarQuantidade(item.quantidade)} ${item.unidade} x ${dinheiro(item.precoUnitario)}`,
      dinheiro(item.total),
    );
  }

  cupom.separador();

  if (dados.descontoTotal !== "0") {
    cupom.entreExtremos("Subtotal", dinheiro(dados.subtotal), ".");
    cupom.entreExtremos("Desconto", `-${dinheiro(dados.descontoTotal)}`, ".");
  }

  cupom.negrito(true).destaque(true);
  cupom.entreExtremos("TOTAL", dinheiro(dados.total), " ");
  cupom.destaque(false).negrito(false);

  cupom.quebrar();

  for (const pagamento of dados.pagamentos) {
    cupom.entreExtremos(pagamento.descricao, dinheiro(pagamento.valor), ".");
  }

  if (dados.troco !== "0") {
    cupom.negrito(true).destaque(true);
    cupom.entreExtremos("TROCO", dinheiro(dados.troco), " ");
    cupom.destaque(false).negrito(false);
  }

  cupom.quebrar().alinhar("CENTRO");

  if (dados.semValorFiscal) {
    cupom.linha("*** SEM VALOR FISCAL ***");
    cupom.linha("Documento nao fiscal");
  }

  cupom.linha(`${String(dados.itens.length)} item(ns)`);

  // A gaveta só abre se houve dinheiro em espécie. O comando vai antes do
  // corte: a impressora executa o pulso enquanto termina de imprimir, e a
  // gaveta abre no instante em que o operador pega o cupom.
  if (opcoes.abrirGaveta === true) cupom.abrirGaveta();

  cupom.cortar();

  return cupom.bytes();
}

function formatarDataHora(quando: Date): string {
  const doisDigitos = (valor: number): string => String(valor).padStart(2, "0");

  const data = `${doisDigitos(quando.getDate())}/${doisDigitos(quando.getMonth() + 1)}/${String(quando.getFullYear())}`;
  const hora = `${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}`;

  return `${data} ${hora}`;
}

/**
 * Centavos em texto → "9,90".
 *
 * Sem o "R$": no cupom ele só ocupa coluna, e ninguém confunde a moeda.
 *
 * Não trata negativo porque **o cupom não imprime valor negativo**: o desconto
 * sai com o sinal escrito à mão na linha dele, e todo o resto — total, item,
 * pagamento, troco — é grandeza positiva por construção. Tratar aqui um caso
 * que não existe deixaria um caminho sem teste no meio do layout.
 */
function dinheiro(centavos: string): string {
  const valor = BigInt(centavos);

  const inteiro = agruparMilhar((valor / 100n).toString());
  const resto = (valor % 100n).toString().padStart(2, "0");

  return `${inteiro},${resto}`;
}

/** Milésimos → "1,25", sem zeros à direita inúteis. */
function formatarQuantidade(milesimos: string): string {
  const valor = BigInt(milesimos);
  const inteiro = (valor / 1000n).toString();
  const fracao = (valor % 1000n).toString().padStart(3, "0").replace(/0+$/, "");

  return fracao === "" ? inteiro : `${inteiro},${fracao}`;
}

function agruparMilhar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
