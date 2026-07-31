import {
  type ContextoSessao,
  type DomainError,
  err,
  ErroNaoAutorizado,
  type Identificador,
  Matricula,
  ok,
  type Result,
  SessaoAcesso,
  type Usuario,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/** Quanto tempo o refresh vale, por contexto (ARQUITETURA.md §8.2). */
export const HORAS_SESSAO_PDV = 12;
export const HORAS_SESSAO_RETAGUARDA = 12;

export interface EntradaAutenticar {
  readonly matricula: string;
  /** PIN no PDV, senha na retaguarda. */
  readonly segredo: string;
  readonly contexto: ContextoSessao;
  readonly dispositivoId: Identificador;
}

export interface SaidaAutenticar {
  readonly usuario: Usuario;
  readonly sessao: SessaoAcesso;
  /**
   * Refresh em claro — **única vez** que ele existe fora do cliente.
   *
   * O banco guarda apenas o hash. Quem chama entrega este valor no cookie e
   * não o registra em lugar nenhum.
   */
  readonly refreshEmClaro: string;
}

/**
 * Desfecho interno da tentativa.
 *
 * Existe por uma razão específica e importante: devolver `err` de dentro da
 * transação provoca **rollback**, e a tentativa falha precisa ser **gravada**.
 * Sem esta separação, cada erro de PIN desfazia o próprio registro — e o
 * bloqueio progressivo nunca chegava à quinta tentativa, porque o contador
 * voltava a zero a cada vez. A proteção existiria só no papel.
 *
 * A transação portanto sempre **confirma**; o erro é produzido depois, fora
 * dela, a partir deste desfecho.
 */
type Desfecho =
  | { readonly tipo: "AUTENTICADO"; readonly saida: SaidaAutenticar }
  | { readonly tipo: "CREDENCIAL_INVALIDA" }
  | { readonly tipo: "RECUSADO"; readonly erro: DomainError };

/**
 * Autentica um usuário e abre a sessão.
 *
 * ### As armadilhas que este caso de uso existe para evitar
 *
 * **1. Vazar quais matrículas existem.** A resposta é sempre a mesma mensagem
 * genérica, e quando a matrícula não existe o caso de uso ainda assim gasta o
 * tempo de um Argon2id. Sem isso, o tempo de resposta vira um oráculo: rápido
 * significa "não existe", devagar significa "existe" — e a lista resultante é
 * exatamente o que se ataca depois.
 *
 * **2. Gastar Argon2id em quem está bloqueado.** O bloqueio é verificado
 * **antes** da conferência. Conferir primeiro deixaria qualquer um consumir CPU
 * do servidor da loja indefinidamente, com o caixa ao lado esperando resposta.
 *
 * **3. Perder o registro da tentativa no rollback.** Ver `Desfecho` acima.
 */
export class Autenticar {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
    private readonly hasher: Hasher,
    private readonly geradorSegredo: () => string,
  ) {}

  async executar(
    entrada: EntradaAutenticar,
  ): Promise<Result<SaidaAutenticar, DomainError>> {
    const desfecho = await this.unitOfWork.transacao<Desfecho, never>(
      async (repositorios) => ok(await this.#tentar(repositorios, entrada)),
    );

    /* v8 ignore next 3 -- só ocorre se a própria transação falhar */
    if (desfecho.isErr()) {
      return err(desfecho.error);
    }

    const resultado = desfecho.unwrap();

    switch (resultado.tipo) {
      case "AUTENTICADO":
        return ok(resultado.saida);
      case "RECUSADO":
        return err(resultado.erro);
      case "CREDENCIAL_INVALIDA":
        return err(credencialInvalida());
    }
  }

  async #tentar(
    repositorios: Parameters<Parameters<UnitOfWork["transacao"]>[0]>[0],
    entrada: EntradaAutenticar,
  ): Promise<Desfecho> {
    const agora = this.relogio.agora();

    const matricula = Matricula.criar(entrada.matricula);
    if (matricula.isErr()) {
      await this.hasher.gastarTempoEquivalente();
      return { tipo: "CREDENCIAL_INVALIDA" };
    }

    const usuario = await repositorios.usuarios.porMatricula(matricula.unwrap());

    if (usuario === undefined) {
      await this.hasher.gastarTempoEquivalente();
      return { tipo: "CREDENCIAL_INVALIDA" };
    }

    const permitido = usuario.podeTentarAcesso(agora);
    if (permitido.isErr()) {
      // Mensagem específica de propósito: quem está bloqueado já provou
      // conhecer a matrícula, e "credencial inválida" produziria um chamado de
      // suporte em vez de fazer o operador esperar.
      return { tipo: "RECUSADO", erro: permitido.error };
    }

    const hashGuardado = entrada.contexto === "PDV" ? usuario.hashPin : usuario.hashSenha;

    if (hashGuardado === undefined) {
      await this.hasher.gastarTempoEquivalente();
      return { tipo: "CREDENCIAL_INVALIDA" };
    }

    const confere = await this.hasher.confere(entrada.segredo, hashGuardado);

    if (!confere) {
      usuario.registrarTentativaFalha(agora);
      await repositorios.usuarios.salvar(usuario);
      await repositorios.outbox.enfileirar(usuario.coletarEventos());
      return { tipo: "CREDENCIAL_INVALIDA" };
    }

    const registrado = usuario.registrarAcessoBemSucedido(agora);
    /* v8 ignore next -- inalcançável: o acesso foi verificado acima */
    if (registrado.isErr()) return { tipo: "RECUSADO", erro: registrado.error };

    const sessaoId = this.geradorId.proximo();
    const refreshEmClaro = this.geradorSegredo();

    const sessao = SessaoAcesso.abrir({
      id: sessaoId,
      usuarioId: usuario.id,
      // Primeira sessão da cadeia: a família é ela própria.
      familiaId: sessaoId,
      dispositivoId: entrada.dispositivoId,
      contexto: entrada.contexto,
      hashRefresh: await this.hasher.hash(refreshEmClaro),
      criadaEm: agora,
      expiraEm: vencimento(agora, entrada.contexto),
    });

    await repositorios.usuarios.salvar(usuario);
    await repositorios.sessoes.salvar(sessao);
    await repositorios.outbox.enfileirar(usuario.coletarEventos());

    return { tipo: "AUTENTICADO", saida: { usuario, sessao, refreshEmClaro } };
  }
}

/**
 * Sempre a mesma resposta, sem dizer o que falhou.
 *
 * Matrícula inexistente, PIN errado e usuário sem credencial para aquele
 * contexto produzem exatamente esta mensagem. Distingui-las seria conveniente
 * para o operador e ainda mais conveniente para quem está testando matrículas.
 */
function credencialInvalida(): ErroNaoAutorizado {
  return new ErroNaoAutorizado("CREDENCIAL_INVALIDA", "Matrícula ou senha incorreta.");
}

export function vencimento(agora: Date, contexto: ContextoSessao): Date {
  const horas = contexto === "PDV" ? HORAS_SESSAO_PDV : HORAS_SESSAO_RETAGUARDA;
  return new Date(agora.getTime() + horas * 60 * 60 * 1000);
}
