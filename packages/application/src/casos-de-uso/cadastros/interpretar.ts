import {
  type DadosEndereco,
  Dinheiro,
  Documento,
  Email,
  Endereco,
  type ErroValidacao,
  InscricaoEstadual,
  type Result,
  Telefone,
} from "@erp/domain";
import { textoOpcional } from "@erp/utils";

/**
 * Tradução de dado bruto para objeto de valor, acumulando os erros.
 *
 * Mora na **aplicação**, e não em cada adapter, por um motivo prático: a
 * conversão é a mesma para o formulário da retaguarda, para a importação de
 * planilha e para qualquer integração futura. Repeti-la em cada porta de
 * entrada garantiria que uma delas aceitasse um telefone que a outra recusa.
 *
 * Todo campo aqui é **opcional**: o que é obrigatório é decidido pelo agregado,
 * que é quem conhece a regra. O papel destas funções é só transformar texto em
 * tipo — ou registrar por que não deu.
 */

/** Campos de contato, como chegam de um formulário. */
export interface EntradaContato {
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
  readonly endereco?: DadosEndereco | undefined;
}

export interface Contato {
  readonly telefone: Telefone | undefined;
  readonly email: Email | undefined;
  readonly endereco: Endereco | undefined;
}

export function interpretarContato(
  entrada: EntradaContato,
  erros: ErroValidacao[],
): Contato {
  return {
    // As fábricas são embrulhadas em seta de propósito: passar `Telefone.criar`
    // solto desassocia o método da classe, e o lint recusa — com razão, porque
    // é assim que um `this` errado entra sem ninguém perceber.
    telefone: interpretarOpcional(
      entrada.telefone,
      (valor) => Telefone.criar(valor),
      erros,
    ),
    email: interpretarOpcional(entrada.email, (valor) => Email.criar(valor), erros),
    endereco: interpretarEndereco(entrada.endereco, erros),
  };
}

export function interpretarDocumento(
  bruto: string | undefined,
  erros: ErroValidacao[],
): Documento | undefined {
  return interpretarOpcional(bruto, (valor) => Documento.criar(valor), erros);
}

export function interpretarInscricaoEstadual(
  bruto: string | undefined,
  erros: ErroValidacao[],
): InscricaoEstadual | undefined {
  return interpretarOpcional(bruto, (valor) => InscricaoEstadual.criar(valor), erros);
}

/**
 * Converte centavos em `Dinheiro`.
 *
 * Recebe `bigint`, e não `number`: dinheiro atravessa a fronteira como inteiro
 * em texto (ADR-0019), e quem converte para número no caminho reintroduz o
 * `double` que o ADR-0009 proíbe.
 */
export function interpretarDinheiro(
  centavos: bigint | undefined,
  erros: ErroValidacao[],
): Dinheiro | undefined {
  if (centavos === undefined) return undefined;

  const resultado = Dinheiro.deCentavos(centavos);

  if (resultado.isErr()) {
    erros.push(resultado.error);
    return undefined;
  }

  return resultado.unwrap();
}

/** Endereço é tudo ou nada: devolve vários erros de uma vez, e por isso é à parte. */
function interpretarEndereco(
  dados: DadosEndereco | undefined,
  erros: ErroValidacao[],
): Endereco | undefined {
  if (dados === undefined) return undefined;

  const resultado = Endereco.criar(dados);

  if (resultado.isErr()) {
    erros.push(...resultado.error);
    return undefined;
  }

  return resultado.unwrap();
}

function interpretarOpcional<T>(
  bruto: string | undefined,
  criar: (valor: string) => Result<T, ErroValidacao>,
  erros: ErroValidacao[],
): T | undefined {
  const texto = textoOpcional(bruto);
  if (texto === undefined) return undefined;

  const resultado = criar(texto);

  if (resultado.isErr()) {
    erros.push(resultado.error);
    return undefined;
  }

  return resultado.unwrap();
}
