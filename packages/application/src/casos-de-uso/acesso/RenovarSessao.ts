import {
  type DomainError,
  err,
  ErroNaoAutorizado,
  type Identificador,
  ok,
  type Result,
  SessaoAcesso,
  type Usuario,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import { vencimento } from "./Autenticar.js";

export interface EntradaRenovarSessao {
  readonly sessaoId: Identificador;
  readonly refreshEmClaro: string;
}

export interface SaidaRenovarSessao {
  readonly usuario: Usuario;
  readonly sessao: SessaoAcesso;
  readonly refreshEmClaro: string;
}

/**
 * Desfecho interno da renovação.
 *
 * Mesmo motivo do `Autenticar`: devolver `err` de dentro da transação provoca
 * rollback, e a **revogação da família** — que é a resposta ao roubo de token —
 * precisa ser gravada. Sem esta separação, detectar o reúso e desfazer a
 * revogação no mesmo instante deixaria o ladrão exatamente onde estava.
 */
type Desfecho =
  | { readonly tipo: "RENOVADO"; readonly saida: SaidaRenovarSessao }
  | { readonly tipo: "RECUSADO"; readonly erro: DomainError };

/**
 * Troca um refresh válido por um par novo.
 *
 * ### A rotação é o ponto inteiro
 *
 * Cada refresh vale **uma vez**. Se um já gasto reaparece, só há duas
 * explicações — foi roubado ou clonado — e nas duas a resposta é a mesma:
 * **revogar a família inteira**, derrubando ladrão e dono junto.
 *
 * É agressivo de propósito. O dono refaz o login e perde dez segundos; a
 * alternativa é o ladrão renovando indefinidamente, porque um token roubado que
 * continua funcionando não deixa rastro nenhum de que foi roubado.
 */
export class RenovarSessao {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
    private readonly hasher: Hasher,
    private readonly geradorSegredo: () => string,
  ) {}

  async executar(
    entrada: EntradaRenovarSessao,
  ): Promise<Result<SaidaRenovarSessao, DomainError>> {
    const desfecho = await this.unitOfWork.transacao<Desfecho, never>(
      async (repositorios) => ok(await this.#renovar(repositorios, entrada)),
    );

    /* v8 ignore next 3 -- só ocorre se a própria transação falhar */
    if (desfecho.isErr()) {
      return err(desfecho.error);
    }

    const resultado = desfecho.unwrap();

    return resultado.tipo === "RENOVADO" ? ok(resultado.saida) : err(resultado.erro);
  }

  async #renovar(
    repositorios: Parameters<Parameters<UnitOfWork["transacao"]>[0]>[0],
    entrada: EntradaRenovarSessao,
  ): Promise<Desfecho> {
    const agora = this.relogio.agora();
    const sessao = await repositorios.sessoes.porId(entrada.sessaoId);

    if (sessao === undefined) {
      await this.hasher.gastarTempoEquivalente();
      return { tipo: "RECUSADO", erro: sessaoInvalida() };
    }

    // O refresh é conferido **antes** de reagir ao reúso: sem isso, quem
    // conhecesse só o identificador da sessão — que trafega no cookie —
    // conseguiria derrubar a sessão alheia de propósito.
    const confere = await this.hasher.confere(entrada.refreshEmClaro, sessao.hashRefresh);
    if (!confere) return { tipo: "RECUSADO", erro: sessaoInvalida() };

    const podeRenovar = sessao.podeRenovar(agora);

    if (podeRenovar.isErr()) {
      if (podeRenovar.error.codigo === "SESSAO_REUSO_DETECTADO") {
        sessao.registrarReuso(agora);
        await repositorios.sessoes.revogarFamilia(sessao.familiaId, agora);
        await repositorios.outbox.enfileirar(sessao.coletarEventos());
      }
      return { tipo: "RECUSADO", erro: podeRenovar.error };
    }

    const usuario = await repositorios.usuarios.porId(sessao.usuarioId);

    if (usuario === undefined) {
      /* v8 ignore next -- inalcançável: a FK garante o usuário da sessão */
      return { tipo: "RECUSADO", erro: sessaoInvalida() };
    }

    // Desativar um usuário precisa derrubar as sessões dele imediatamente,
    // não só impedir logins novos.
    const acessoValido = usuario.podeTentarAcesso(agora);
    if (acessoValido.isErr()) {
      await repositorios.sessoes.revogarDoUsuario(usuario.id, agora);
      return { tipo: "RECUSADO", erro: acessoValido.error };
    }

    const novaId = this.geradorId.proximo();
    const refreshEmClaro = this.geradorSegredo();

    const nova = SessaoAcesso.abrir({
      id: novaId,
      usuarioId: usuario.id,
      // Mesma família: é o que mantém a cadeia revogável de uma vez.
      familiaId: sessao.familiaId,
      dispositivoId: sessao.dispositivoId,
      contexto: sessao.contexto,
      hashRefresh: await this.hasher.hash(refreshEmClaro),
      criadaEm: agora,
      expiraEm: vencimento(agora, sessao.contexto),
    });

    sessao.marcarComoRenovada(novaId, agora);

    await repositorios.sessoes.salvar(sessao);
    await repositorios.sessoes.salvar(nova);

    return { tipo: "RENOVADO", saida: { usuario, sessao: nova, refreshEmClaro } };
  }
}

function sessaoInvalida(): ErroNaoAutorizado {
  return new ErroNaoAutorizado("SESSAO_INVALIDA", "Sua sessão expirou. Entre de novo.");
}
