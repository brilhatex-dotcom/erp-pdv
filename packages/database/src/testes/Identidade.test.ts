import {
  CredencialHash,
  Dinheiro,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  SessaoAcesso,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALGORITMO_ARGON2ID, HasherArgon2 } from "../HasherArgon2.js";
import {
  PapelRepositorioPrisma,
  SessaoAcessoRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "../repositorios/AcessoRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a001").unwrap();
const USUARIO_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a002").unwrap();
const SESSAO_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a003").unwrap();
const SESSAO_2 = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a004").unwrap();
const DISPOSITIVO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a005").unwrap();
const PDV_1 = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a006").unwrap();
const AGORA = new Date("2026-07-31T09:00:00.000Z");

const prisma = criarClienteDeTeste();

function hash(valor = "$argon2id$abc"): CredencialHash {
  return CredencialHash.criar(valor, ALGORITMO_ARGON2ID).unwrap();
}

function operador(): Papel {
  return Papel.criar(papelPadrao("OPERADOR_CAIXA", PAPEL_ID)).unwrap();
}

function usuario(papel = operador()): Usuario {
  return Usuario.criar({
    id: USUARIO_ID,
    matricula: Matricula.criar("42").unwrap(),
    nome: "Maria da Silva",
    papel,
    hashPin: hash(),
  }).unwrap();
}

function sessao(id = SESSAO_ID, familiaId = SESSAO_ID): SessaoAcesso {
  return SessaoAcesso.abrir({
    id,
    usuarioId: USUARIO_ID,
    familiaId,
    dispositivoId: DISPOSITIVO,
    contexto: "PDV",
    hashRefresh: hash("$argon2id$refresh"),
    criadaEm: AGORA,
    expiraEm: new Date(AGORA.getTime() + 12 * 60 * 60 * 1000),
  });
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
});

describe("Papel — ida e volta pelo banco", () => {
  it("🔑 preserva permissões e limites por valor", async () => {
    const papeis = new PapelRepositorioPrisma(prisma);
    const supervisor = Papel.criar(papelPadrao("SUPERVISOR", PAPEL_ID)).unwrap();

    await papeis.salvar(supervisor);
    const lido = await papeis.porId(PAPEL_ID);

    expect(lido?.concede("caixa:sangria")).toBe(true);
    expect(lido?.concede("config:fiscal")).toBe(false);
    expect(lido?.limites.descontoMaximoItemBps).toBe(1500);
    expect(lido?.limites.valorMaximoSangria?.formatar()).toBe("R$ 500,00");
    expect(lido?.limites.minutosParaCancelarVenda).toBe(30);
    expect(lido?.ehPadrao).toBe(true);
  });

  it("🔑 limite ausente volta ausente, não zero", async () => {
    // `undefined` é "sem teto"; `0` é "não pode nada". O gerente tem sangria
    // ilimitada, e confundir os dois travaria o caixa dele.
    const papeis = new PapelRepositorioPrisma(prisma);
    await papeis.salvar(Papel.criar(papelPadrao("GERENTE", PAPEL_ID)).unwrap());

    const lido = await papeis.porId(PAPEL_ID);

    expect(lido?.limites.valorMaximoSangria).toBeUndefined();
    expect(lido?.limites.minutosParaCancelarVenda).toBeUndefined();
  });

  it("preserva teto zerado como zero", async () => {
    const papeis = new PapelRepositorioPrisma(prisma);

    await papeis.salvar(
      Papel.criar({
        id: PAPEL_ID,
        codigo: "SEM_SANGRIA",
        nome: "Sem sangria",
        permissoes: ["caixa:sangria"],
        limites: {
          valorMaximoSangria: Dinheiro.zero(),
          estornoMaximoEmDinheiro: Dinheiro.zero(),
          minutosParaCancelarVenda: 0,
        },
      }).unwrap(),
    );

    const lido = await papeis.porId(PAPEL_ID);

    expect(lido?.limites.valorMaximoSangria?.ehZero()).toBe(true);
    expect(lido?.limites.estornoMaximoEmDinheiro?.ehZero()).toBe(true);
    expect(lido?.limites.minutosParaCancelarVenda).toBe(0);
  });

  it("busca por código e lista todos", async () => {
    const papeis = new PapelRepositorioPrisma(prisma);
    await papeis.salvar(operador());

    expect((await papeis.porCodigo("operador_caixa"))?.codigo).toBe("OPERADOR_CAIXA");
    expect(await papeis.porCodigo("INEXISTENTE")).toBeUndefined();
    expect(await papeis.todos()).toHaveLength(1);
    expect(
      await papeis.porId(
        Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a099").unwrap(),
      ),
    ).toBeUndefined();
  });

  it("regravar não duplica permissões", async () => {
    const papeis = new PapelRepositorioPrisma(prisma);

    await papeis.salvar(operador());
    await papeis.salvar(operador());

    const esperado = operador().permissoes.size;
    expect(await prisma.permissaoPapel.count()).toBe(esperado);
  });
});

describe("Usuário — ida e volta pelo banco", () => {
  async function gravarUsuario(u = usuario()): Promise<void> {
    await new PapelRepositorioPrisma(prisma).salvar(u.papel);
    await new UsuarioRepositorioPrisma(prisma).salvar(u);
  }

  it("🔑 volta com o papel e as permissões carregados", async () => {
    await gravarUsuario();

    const lido = await new UsuarioRepositorioPrisma(prisma).porId(USUARIO_ID);

    expect(lido?.nome).toBe("Maria da Silva");
    expect(lido?.papel.codigo).toBe("OPERADOR_CAIXA");
    expect(lido?.temPermissao("venda:criar")).toBe(true);
    expect(lido?.temPermissao("caixa:sangria")).toBe(false);
  });

  it("🔑 preserva o hash e o algoritmo da credencial", async () => {
    // O algoritmo é o que permite trocar de hash sem obrigar a loja a redefinir
    // senha no mesmo dia.
    await gravarUsuario();

    const lido = await new UsuarioRepositorioPrisma(prisma).porId(USUARIO_ID);

    expect(lido?.hashPin?.valor).toBe("$argon2id$abc");
    expect(lido?.hashPin?.algoritmo).toBe(ALGORITMO_ARGON2ID);
    expect(lido?.hashSenha).toBeUndefined();
  });

  it("encontra pela matrícula normalizada", async () => {
    await gravarUsuario();
    const usuarios = new UsuarioRepositorioPrisma(prisma);

    expect((await usuarios.porMatricula(Matricula.criar("42").unwrap()))?.nome).toBe(
      "Maria da Silva",
    );
    // `007` e `7` normalizam para o mesmo valor; `42` continua sendo `42`.
    expect(await usuarios.porMatricula(Matricula.criar("0042").unwrap())).toBeDefined();
    expect(await usuarios.porMatricula(Matricula.criar("99").unwrap())).toBeUndefined();
  });

  it("🔑 o bloqueio progressivo sobrevive ao reinício do servidor", async () => {
    // Reiniciar não pode zerar a proteção: seria a forma mais fácil de
    // contorná-la.
    const u = usuario();
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      u.registrarTentativaFalha(AGORA);
    }
    await gravarUsuario(u);

    const lido = await new UsuarioRepositorioPrisma(prisma).porId(USUARIO_ID);

    expect(lido?.estaBloqueado(AGORA)).toBe(true);
    expect(lido?.bloqueiosConsecutivos).toBe(1);
    expect(lido?.podeTentarAcesso(AGORA).isErr()).toBe(true);
  });

  it("guarda e regrava as estações permitidas sem duplicar", async () => {
    const restrito = Usuario.criar({
      id: USUARIO_ID,
      matricula: Matricula.criar("42").unwrap(),
      nome: "Maria da Silva",
      papel: operador(),
      hashPin: hash(),
      estacoesPermitidas: [PDV_1],
    }).unwrap();

    await gravarUsuario(restrito);
    await new UsuarioRepositorioPrisma(prisma).salvar(restrito);

    const lido = await new UsuarioRepositorioPrisma(prisma).porId(USUARIO_ID);

    expect(lido?.podeOperarEstacao(PDV_1)).toBe(true);
    expect(lido?.podeOperarEstacao(DISPOSITIVO)).toBe(false);
    expect(await prisma.estacaoPermitida.count()).toBe(1);
  });

  it("devolve nada quando o usuário não existe", async () => {
    const usuarios = new UsuarioRepositorioPrisma(prisma);
    const ausente = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a098").unwrap();

    expect(await usuarios.porId(ausente)).toBeUndefined();
    expect(await usuarios.porMatricula(Matricula.criar("1").unwrap())).toBeUndefined();
  });

  it("🔑 o banco recusa duas pessoas com a mesma matrícula", async () => {
    await gravarUsuario();

    const outro = Usuario.criar({
      id: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a097").unwrap(),
      matricula: Matricula.criar("42").unwrap(),
      nome: "Outro",
      papel: operador(),
      hashPin: hash(),
    }).unwrap();

    await expect(new UsuarioRepositorioPrisma(prisma).salvar(outro)).rejects.toThrow();
  });
});

describe("Sessão de acesso — ida e volta pelo banco", () => {
  async function preparar(): Promise<void> {
    await new PapelRepositorioPrisma(prisma).salvar(operador());
    await new UsuarioRepositorioPrisma(prisma).salvar(usuario());
  }

  it("volta com o estado completo", async () => {
    await preparar();
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);

    await sessoes.salvar(sessao());
    const lida = await sessoes.porId(SESSAO_ID);

    expect(lida?.usuarioId.equals(USUARIO_ID)).toBe(true);
    expect(lida?.contexto).toBe("PDV");
    expect(lida?.hashRefresh.valor).toBe("$argon2id$refresh");
    expect(lida?.estaValida(AGORA)).toBe(true);
    expect(lida?.sucessoraId).toBeUndefined();
  });

  it("preserva a cadeia de renovação", async () => {
    await preparar();
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);

    const primeira = sessao();
    primeira.marcarComoRenovada(SESSAO_2, AGORA);
    await sessoes.salvar(primeira);
    await sessoes.salvar(sessao(SESSAO_2, SESSAO_ID));

    const lida = await sessoes.porId(SESSAO_ID);

    expect(lida?.jaFoiUsada).toBe(true);
    expect(lida?.sucessoraId?.equals(SESSAO_2)).toBe(true);
  });

  it("🔑 revoga a família inteira numa operação só", async () => {
    // Revogar uma a uma deixaria uma janela em que o ladrão ainda renovaria.
    await preparar();
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);

    await sessoes.salvar(sessao());
    await sessoes.salvar(sessao(SESSAO_2, SESSAO_ID));

    await sessoes.revogarFamilia(SESSAO_ID, AGORA);

    expect((await sessoes.porId(SESSAO_ID))?.estaRevogada).toBe(true);
    expect((await sessoes.porId(SESSAO_2))?.estaRevogada).toBe(true);
  });

  it("revoga todas as sessões de um usuário", async () => {
    await preparar();
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);

    await sessoes.salvar(sessao());
    // Família diferente: outro dispositivo, mesma pessoa.
    await sessoes.salvar(sessao(SESSAO_2, SESSAO_2));

    await sessoes.revogarDoUsuario(USUARIO_ID, AGORA);

    expect((await sessoes.porId(SESSAO_ID))?.estaRevogada).toBe(true);
    expect((await sessoes.porId(SESSAO_2))?.estaRevogada).toBe(true);
  });

  it("não sobrescreve a revogação já registrada", async () => {
    await preparar();
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);
    await sessoes.salvar(sessao());

    await sessoes.revogarFamilia(SESSAO_ID, AGORA);
    const depois = new Date(AGORA.getTime() + 60_000);
    await sessoes.revogarFamilia(SESSAO_ID, depois);

    expect((await sessoes.porId(SESSAO_ID))?.revogadaEm?.toISOString()).toBe(
      AGORA.toISOString(),
    );
  });

  it("devolve nada quando a sessão não existe", async () => {
    const sessoes = new SessaoAcessoRepositorioPrisma(prisma);
    const ausente = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e51a096").unwrap();

    expect(await sessoes.porId(ausente)).toBeUndefined();
  });

  it("🔑 apagar o usuário leva as sessões dele junto", async () => {
    await preparar();
    await new SessaoAcessoRepositorioPrisma(prisma).salvar(sessao());

    await prisma.usuario.delete({ where: { id: USUARIO_ID.valor } });

    expect(await prisma.sessaoAcesso.count()).toBe(0);
  });
});

describe("Hasher Argon2id", () => {
  const hasher = new HasherArgon2();

  it("🔑 confere o que ele mesmo gerou, e recusa o resto", async () => {
    const guardado = await hasher.hash("419273");

    expect(guardado.algoritmo).toBe(ALGORITMO_ARGON2ID);
    // O digest nunca é o texto em claro.
    expect(guardado.valor).not.toContain("419273");
    await expect(hasher.confere("419273", guardado)).resolves.toBe(true);
    await expect(hasher.confere("000111", guardado)).resolves.toBe(false);
  });

  it("🔑 dois hashes do mesmo segredo são diferentes", async () => {
    // O sal é aleatório: dois operadores com o mesmo PIN não têm hash igual, e
    // quem olhar a tabela não descobre quem repetiu credencial.
    const a = await hasher.hash("419273");
    const b = await hasher.hash("419273");

    expect(a.valor).not.toBe(b.valor);
    await expect(hasher.confere("419273", b)).resolves.toBe(true);
  });

  it("🔑 hash malformado devolve falso, não exceção", async () => {
    // Propagar um erro diferente aqui diria ao atacante que ele encontrou algo
    // digno de atenção.
    const corrompido = CredencialHash.criar("não-é-um-hash", ALGORITMO_ARGON2ID).unwrap();

    await expect(hasher.confere("419273", corrompido)).resolves.toBe(false);
  });

  it("gasta tempo sem conferir nada", async () => {
    await expect(hasher.gastarTempoEquivalente()).resolves.toBeUndefined();
  });
});
