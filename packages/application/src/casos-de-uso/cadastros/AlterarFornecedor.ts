import {
  type DadosEndereco,
  type DomainError,
  err,
  ErroConflito,
  ErroNaoEncontrado,
  ErroValidacao,
  type Fornecedor,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  interpretarContato,
  interpretarDocumento,
  interpretarInscricaoEstadual,
} from "./interpretar.js";

export interface EntradaAlterarFornecedor {
  readonly id: Identificador;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string | undefined;
  readonly documento: string;
  readonly inscricaoEstadual?: string | undefined;
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
  readonly endereco?: DadosEndereco | undefined;
  readonly prazoEntregaDias?: number | undefined;
  readonly observacao?: string | undefined;
  readonly ativo: boolean;
}

/** Altera um fornecedor. Como em `AlterarCliente`, a entrada é o estado completo. */
export class AlterarFornecedor {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(
    entrada: EntradaAlterarFornecedor,
  ): Promise<Result<Fornecedor, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const fornecedor = await repositorios.fornecedores.porId(entrada.id);

      if (fornecedor === undefined) {
        return err(
          new ErroNaoEncontrado(
            "FORNECEDOR_NAO_ENCONTRADO",
            "Fornecedor não encontrado.",
          ),
        );
      }

      const problemas: ErroValidacao[] = [];

      const documento = interpretarDocumento(entrada.documento, problemas);
      const inscricaoEstadual = interpretarInscricaoEstadual(
        entrada.inscricaoEstadual,
        problemas,
      );
      const contato = interpretarContato(entrada, problemas);

      if (documento === undefined && problemas.length === 0) {
        problemas.push(
          new ErroValidacao(
            "FORNECEDOR_DOCUMENTO_OBRIGATORIO",
            "Informe o CNPJ ou o CPF do fornecedor.",
          ),
        );
      }

      // A unicidade é conferida **antes** de mexer no agregado — ver o
      // comentário equivalente em `AlterarCliente`.
      if (documento !== undefined) {
        const homonimo = await repositorios.fornecedores.porDocumento(documento);

        if (homonimo !== undefined && !homonimo.id.equals(fornecedor.id)) {
          return err(
            new ErroConflito(
              "FORNECEDOR_DOCUMENTO_JA_CADASTRADO",
              `Este documento já está no cadastro de ${homonimo.exibicao}.`,
              { fornecedorId: homonimo.id.valor },
            ),
          );
        }
      }

      const renomeado = fornecedor.renomear(entrada.razaoSocial, entrada.nomeFantasia);
      if (renomeado.isErr()) problemas.push(renomeado.error);

      const prazo = fornecedor.definirPrazoEntrega(entrada.prazoEntregaDias);
      if (prazo.isErr()) problemas.push(prazo.error);

      const observacao = fornecedor.definirObservacao(entrada.observacao);
      if (observacao.isErr()) problemas.push(observacao.error);

      if (problemas.length > 0 || documento === undefined) {
        return err(agregarErros(problemas));
      }

      fornecedor.definirDocumento(documento);
      fornecedor.definirInscricaoEstadual(inscricaoEstadual);
      fornecedor.definirContato(contato.telefone, contato.email);
      fornecedor.definirEndereco(contato.endereco);

      if (entrada.ativo) {
        fornecedor.ativar();
      } else {
        fornecedor.desativar();
      }

      await repositorios.fornecedores.salvar(fornecedor);

      return ok(fornecedor);
    });
  }
}
