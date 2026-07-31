import {
  type DadosEndereco,
  type DomainError,
  err,
  ErroConflito,
  ErroValidacao,
  Fornecedor,
  ok,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  interpretarContato,
  interpretarDocumento,
  interpretarInscricaoEstadual,
} from "./interpretar.js";

export interface EntradaCadastrarFornecedor {
  readonly razaoSocial: string;
  readonly nomeFantasia?: string | undefined;
  /** Obrigatório: fornecedor sem documento não fecha com nota de entrada. */
  readonly documento: string;
  readonly inscricaoEstadual?: string | undefined;
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
  readonly endereco?: DadosEndereco | undefined;
  readonly prazoEntregaDias?: number | undefined;
  readonly observacao?: string | undefined;
}

/**
 * Cadastra um fornecedor.
 *
 * Documento duplicado é recusado com o nome de quem já o tem. É a diferença
 * entre o comprador entender que o fornecedor já existe — e achá-lo — e
 * cadastrar "Distribuidora Vale 2", dividindo o histórico de compra do produto
 * entre dois registros que ninguém junta depois.
 */
export class CadastrarFornecedor {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaCadastrarFornecedor,
  ): Promise<Result<Fornecedor, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const problemas: ErroValidacao[] = [];

      const documento = interpretarDocumento(entrada.documento, problemas);
      const inscricaoEstadual = interpretarInscricaoEstadual(
        entrada.inscricaoEstadual,
        problemas,
      );
      const contato = interpretarContato(entrada, problemas);

      if (documento === undefined) {
        // Sem documento não há como montar o agregado — e a mensagem precisa
        // dizer isso, não repetir o erro de formato quando o campo veio vazio.
        if (problemas.length === 0) {
          problemas.push(
            new ErroValidacao(
              "FORNECEDOR_DOCUMENTO_OBRIGATORIO",
              "Informe o CNPJ ou o CPF do fornecedor.",
            ),
          );
        }

        return err(agregarErros(problemas));
      }

      const fornecedor = Fornecedor.criar({
        id: this.geradorId.proximo(),
        razaoSocial: entrada.razaoSocial,
        nomeFantasia: entrada.nomeFantasia,
        documento,
        inscricaoEstadual,
        telefone: contato.telefone,
        email: contato.email,
        endereco: contato.endereco,
        prazoEntregaDias: entrada.prazoEntregaDias,
        observacao: entrada.observacao,
      });

      if (fornecedor.isErr()) problemas.push(...fornecedor.error);

      if (problemas.length > 0) return err(agregarErros(problemas));

      const existente = await repositorios.fornecedores.porDocumento(documento);

      if (existente !== undefined) {
        return err(
          new ErroConflito(
            "FORNECEDOR_DOCUMENTO_JA_CADASTRADO",
            `Este documento já está no cadastro de ${existente.exibicao}.`,
            { fornecedorId: existente.id.valor },
          ),
        );
      }

      const novo = fornecedor.unwrap();
      await repositorios.fornecedores.salvar(novo);

      return ok(novo);
    });
  }
}
