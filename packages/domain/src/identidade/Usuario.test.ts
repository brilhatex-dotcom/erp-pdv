import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { CredencialHash } from "./CredencialHash.js";
import type { CredencialBloqueada, TentativaRecusada } from "./eventos.js";
import { Matricula } from "./Matricula.js";
import { Papel } from "./Papel.js";
import { papelPadrao } from "./papeisPadrao.js";
import {
  type DadosUsuario,
  MINUTOS_BLOQUEIO_MAXIMO,
  MINUTOS_PRIMEIRO_BLOQUEIO,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "./Usuario.js";

const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fa001").unwrap();
const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fa002").unwrap();
const PDV_1 = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fa003").unwrap();
const PDV_2 = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fa004").unwrap();
const AGORA = new Date("2026-07-31T09:00:00.000Z");

function minutosDepois(minutos: number): Date {
  return new Date(AGORA.getTime() + minutos * 60_000);
}

function operador(): Papel {
  return Papel.criar(papelPadrao("OPERADOR_CAIXA", PAPEL_ID)).unwrap();
}

function hash(valor = "$argon2id$abc"): CredencialHash {
  return CredencialHash.criar(valor, "argon2id").unwrap();
}

function dados(sobrescritas: Partial<DadosUsuario> = {}): DadosUsuario {
  return {
    id: USUARIO,
    matricula: Matricula.criar("42").unwrap(),
    nome: "Maria da Silva",
    papel: operador(),
    hashPin: hash(),
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosUsuario> = {}): Usuario {
  const resultado = Usuario.criar(dados(sobrescritas));
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.map(String).join(" · ")}`);
  }
  return resultado.unwrap();
}

/** Erra o PIN `vezes` vezes seguidas. */
function errar(usuario: Usuario, vezes: number, quando = AGORA): void {
  for (let i = 0; i < vezes; i += 1) {
    usuario.registrarTentativaFalha(quando);
  }
}

describe("Usuário — criação", () => {
  it("nasce ativo e obrigado a trocar a credencial", () => {
    const usuario = criar();

    expect(usuario.ativo).toBe(true);
    expect(usuario.nome).toBe("Maria da Silva");
    expect(usuario.matricula.valor).toBe("42");
  });

  it("🔑 exige troca da credencial no primeiro acesso", () => {
    // Nunca existe senha padrão de fábrica: a credencial que o administrador
    // digitou é uma credencial que o administrador conhece.
    expect(criar().precisaTrocarCredencial).toBe(true);
  });

  it("recusa usuário sem credencial alguma", () => {
    const resultado = Usuario.criar(dados({ hashPin: undefined, hashSenha: undefined }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain("USUARIO_SEM_CREDENCIAL");
    }
  });

  it("recusa nome vazio", () => {
    const resultado = Usuario.criar(dados({ nome: "   " }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain("USUARIO_NOME_VAZIO");
    }
  });

  it("devolve todos os erros de uma vez", () => {
    const resultado = Usuario.criar(
      dados({ nome: "", hashPin: undefined, hashSenha: undefined }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error).toHaveLength(2);
  });

  it("aceita usuário só de retaguarda, sem PIN", () => {
    const usuario = criar({ hashPin: undefined, hashSenha: hash("$argon2id$senha") });

    expect(usuario.hashPin).toBeUndefined();
    expect(usuario.hashSenha?.valor).toBe("$argon2id$senha");
  });
});

describe("Usuário — permissões e escopo", () => {
  it("concede o que o papel concede e nega o resto", () => {
    const usuario = criar();

    expect(usuario.temPermissao("venda:criar")).toBe(true);
    expect(usuario.temPermissao("caixa:sangria")).toBe(false);
    expect(usuario.temPermissao("config:fiscal")).toBe(false);
  });

  it("opera qualquer estação quando nenhuma foi restringida", () => {
    // É o caso da imensa maioria das lojas de 1 a 3 computadores.
    const usuario = criar();

    expect(usuario.podeOperarEstacao(PDV_1)).toBe(true);
    expect(usuario.podeOperarEstacao(PDV_2)).toBe(true);
  });

  it("respeita a restrição de estação quando existe", () => {
    const usuario = criar({ estacoesPermitidas: [PDV_1] });

    expect(usuario.podeOperarEstacao(PDV_1)).toBe(true);
    expect(usuario.podeOperarEstacao(PDV_2)).toBe(false);
    expect(usuario.estacoesPermitidas).toHaveLength(1);
  });

  it("troca de papel sem perder a identidade", () => {
    const usuario = criar();
    const gerente = Papel.criar(papelPadrao("GERENTE", PAPEL_ID)).unwrap();

    usuario.alterarPapel(gerente);

    expect(usuario.papel.codigo).toBe("GERENTE");
    expect(usuario.temPermissao("caixa:sangria")).toBe(true);
    expect(usuario.id.equals(USUARIO)).toBe(true);
  });
});

describe("Usuário — bloqueio progressivo", () => {
  it("tolera erros antes do limite", () => {
    const usuario = criar();

    errar(usuario, TENTATIVAS_ATE_BLOQUEIO - 1);

    expect(usuario.estaBloqueado(AGORA)).toBe(false);
    expect(usuario.tentativasFalhas).toBe(TENTATIVAS_ATE_BLOQUEIO - 1);
    expect(usuario.podeTentarAcesso(AGORA).isOk()).toBe(true);
  });

  it("🔑 bloqueia por 15 minutos na quinta tentativa errada", () => {
    const usuario = criar();

    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    expect(usuario.estaBloqueado(AGORA)).toBe(true);
    expect(usuario.bloqueadoAte?.toISOString()).toBe(
      minutosDepois(MINUTOS_PRIMEIRO_BLOQUEIO).toISOString(),
    );
    // O contador zera: a próxima rodada de erros começa do início.
    expect(usuario.tentativasFalhas).toBe(0);
  });

  it("libera sozinho quando o tempo passa", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    expect(usuario.estaBloqueado(minutosDepois(14))).toBe(true);
    expect(usuario.estaBloqueado(minutosDepois(16))).toBe(false);
  });

  it("🔑 escala 15 → 30 → 60 e para de crescer", () => {
    // Escala porque seis dígitos caem rápido para quem tem o teclado. Para de
    // crescer porque bloqueio eterno derruba o caixa da loja — um cliente
    // mal-intencionado erraria PIN de propósito até a loja parar.
    const usuario = criar();
    const duracoes: number[] = [];

    for (let rodada = 0; rodada < 4; rodada += 1) {
      const inicio = minutosDepois(rodada * 1000);
      errar(usuario, TENTATIVAS_ATE_BLOQUEIO, inicio);
      duracoes.push(
        Math.round((usuario.bloqueadoAte!.getTime() - inicio.getTime()) / 60_000),
      );
    }

    expect(duracoes).toEqual([15, 30, 60, MINUTOS_BLOQUEIO_MAXIMO]);
  });

  it("recusa a tentativa enquanto o bloqueio vale, com mensagem para o operador", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    const resultado = usuario.podeTentarAcesso(minutosDepois(5));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("USUARIO_BLOQUEADO");
      expect(resultado.error.mensagem).toBe(
        "Acesso bloqueado por mais 10 minutos. Chame o supervisor.",
      );
    }
  });

  it("usa singular quando falta um minuto", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    const resultado = usuario.podeTentarAcesso(minutosDepois(14.5));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.mensagem).toContain("1 minuto.");
  });

  it("🔑 acerto zera a escalada — quem errou de manhã não paga o dia todo", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    usuario.registrarAcessoBemSucedido(minutosDepois(20)).unwrap();
    expect(usuario.bloqueiosConsecutivos).toBe(0);

    // O bloqueio seguinte volta a ser o primeiro: 15 minutos, não 30.
    const depois = minutosDepois(100);
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO, depois);

    expect(usuario.bloqueadoAte?.toISOString()).toBe(
      new Date(depois.getTime() + MINUTOS_PRIMEIRO_BLOQUEIO * 60_000).toISOString(),
    );
  });

  it("registra o último acesso quando a credencial confere", () => {
    const usuario = criar();

    usuario.registrarAcessoBemSucedido(AGORA).unwrap();

    expect(usuario.ultimoAcessoEm?.toISOString()).toBe(AGORA.toISOString());
    expect(usuario.tentativasFalhas).toBe(0);
  });

  it("não registra acesso de quem está bloqueado", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    const resultado = usuario.registrarAcessoBemSucedido(minutosDepois(1));

    expect(resultado.isErr()).toBe(true);
    expect(usuario.ultimoAcessoEm).toBeUndefined();
  });

  it("supervisor consegue desbloquear antes da hora", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    usuario.desbloquear();

    expect(usuario.estaBloqueado(AGORA)).toBe(false);
    expect(usuario.bloqueiosConsecutivos).toBe(0);
  });
});

describe("Usuário — auditoria de acesso", () => {
  it("🔑 registra cada tentativa recusada, mesmo sem bloqueio", () => {
    // Tentativa isolada parece dedo errado. A mesma tentativa espalhada por
    // várias contas na mesma hora é alguém testando PINs — e o padrão só
    // aparece se cada evento tiver sido gravado.
    const usuario = criar();

    errar(usuario, 2);
    const eventos = usuario.coletarEventos();

    expect(eventos).toHaveLength(2);
    expect(eventos[0]?.tipo).toBe("TentativaDeAcessoRecusada");
    expect((eventos[1] as TentativaRecusada).tentativasSeguidas).toBe(2);
    expect((eventos[0] as TentativaRecusada).matricula).toBe("42");
  });

  it("registra o bloqueio com a duração aplicada", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    const bloqueio = usuario
      .coletarEventos()
      .find((evento) => evento.tipo === "CredencialBloqueada") as CredencialBloqueada;

    expect(bloqueio.minutos).toBe(MINUTOS_PRIMEIRO_BLOQUEIO);
    expect(bloqueio.bloqueadoAte.toISOString()).toBe(
      minutosDepois(MINUTOS_PRIMEIRO_BLOQUEIO).toISOString(),
    );
    expect(bloqueio.agregadoId.equals(USUARIO)).toBe(true);
  });
});

describe("Usuário — ciclo de vida", () => {
  it("🔑 desativar nunca apaga — o histórico de vendas continua apontando", () => {
    const usuario = criar();

    usuario.desativar();

    expect(usuario.ativo).toBe(false);
    const resultado = usuario.podeTentarAcesso(AGORA);
    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("USUARIO_INATIVO");
  });

  it("reativar limpa o bloqueio pendente", () => {
    const usuario = criar();
    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);
    usuario.desativar();

    usuario.reativar();

    expect(usuario.ativo).toBe(true);
    expect(usuario.estaBloqueado(AGORA)).toBe(false);
  });

  it("definir PIN ou senha encerra a obrigação de troca", () => {
    const comPin = criar();
    comPin.definirPin(hash("$argon2id$novo"));
    expect(comPin.precisaTrocarCredencial).toBe(false);
    expect(comPin.hashPin?.valor).toBe("$argon2id$novo");

    const comSenha = criar();
    comSenha.definirSenha(hash("$argon2id$senha"));
    expect(comSenha.precisaTrocarCredencial).toBe(false);
    expect(comSenha.hashSenha?.valor).toBe("$argon2id$senha");
  });

  it("administrador pode reimpor a troca no próximo acesso", () => {
    const usuario = criar({ precisaTrocarCredencial: false });

    usuario.exigirTrocaDeCredencial();

    expect(usuario.precisaTrocarCredencial).toBe(true);
  });

  it("altera o nome e recusa nome vazio", () => {
    const usuario = criar();

    usuario.alterarNome("  Maria Souza  ").unwrap();
    expect(usuario.nome).toBe("Maria Souza");

    const resultado = usuario.alterarNome("   ");
    expect(resultado.isErr()).toBe(true);
    expect(usuario.nome).toBe("Maria Souza");
  });
});

describe("Usuário — reconstituição", () => {
  it("volta com o estado de bloqueio que estava gravado", () => {
    const bloqueadoAte = minutosDepois(10);

    const usuario = Usuario.reconstituir({
      ...dados(),
      precisaTrocarCredencial: false,
      ativo: true,
      tentativasFalhas: 2,
      bloqueadoAte,
      bloqueiosConsecutivos: 3,
      ultimoAcessoEm: AGORA,
    });

    expect(usuario.tentativasFalhas).toBe(2);
    expect(usuario.bloqueiosConsecutivos).toBe(3);
    expect(usuario.estaBloqueado(AGORA)).toBe(true);
    expect(usuario.ultimoAcessoEm?.toISOString()).toBe(AGORA.toISOString());
  });

  it("🔑 continua a escalada de onde o banco parou", () => {
    // Reiniciar o servidor não pode zerar o bloqueio: seria a forma mais fácil
    // de contornar a proteção inteira.
    const usuario = Usuario.reconstituir({
      ...dados(),
      tentativasFalhas: 0,
      bloqueadoAte: undefined,
      bloqueiosConsecutivos: 2,
      ultimoAcessoEm: undefined,
    });

    errar(usuario, TENTATIVAS_ATE_BLOQUEIO);

    // Terceiro bloqueio: 60 minutos, não 15.
    expect(usuario.bloqueadoAte?.toISOString()).toBe(minutosDepois(60).toISOString());
  });

  it("não registra evento algum", () => {
    const usuario = Usuario.reconstituir({
      ...dados(),
      tentativasFalhas: 0,
      bloqueadoAte: undefined,
      bloqueiosConsecutivos: 0,
      ultimoAcessoEm: undefined,
    });

    expect(usuario.eventos).toHaveLength(0);
  });
});
