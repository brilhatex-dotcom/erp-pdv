import { describe, expect, it } from "vitest";

import { Dinheiro } from "../valores/Dinheiro.js";
import { ILIMITADO, LimitesPapel } from "./LimitesPapel.js";
import { Papel, papeisDeFabrica } from "./Papel.js";
import { PERMISSOES } from "./Permissao.js";

const porCodigo = (codigo: string): Papel => {
  const papel = papeisDeFabrica().find((candidato) => candidato.codigo === codigo);
  if (papel === undefined) throw new Error(`papel de fábrica ausente: ${codigo}`);
  return papel;
};

describe("Papel.criar", () => {
  it("aceita código, nome e permissões", () => {
    const papel = Papel.criar({
      codigo: "CONFERENTE",
      nome: "Conferente",
      permissoes: ["estoque:inventario"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(papel.codigo).toBe("CONFERENTE");
    expect(papel.nome).toBe("Conferente");
    expect(papel.concede("estoque:inventario")).toBe(true);
  });

  it("normaliza o código para maiúsculas", () => {
    expect(
      Papel.criar({
        codigo: " conferente ",
        nome: "Conferente",
        permissoes: [],
        limites: LimitesPapel.nenhum(),
      }).unwrap().codigo,
    ).toBe("CONFERENTE");
  });

  it("recusa código malformado", () => {
    for (const codigo of ["", "A", "1CODIGO", "CÓDIGO", "CODIGO-X", "A".repeat(31)]) {
      const resultado = Papel.criar({
        codigo,
        nome: "Qualquer",
        permissoes: [],
        limites: LimitesPapel.nenhum(),
      });

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("PAPEL_CODIGO_INVALIDO");
    }
  });

  it("recusa nome vazio", () => {
    const resultado = Papel.criar({
      codigo: "CONFERENTE",
      nome: "   ",
      permissoes: [],
      limites: LimitesPapel.nenhum(),
    });

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("PAPEL_SEM_NOME");
  });

  it("nega o que não concedeu", () => {
    const papel = Papel.criar({
      codigo: "CONFERENTE",
      nome: "Conferente",
      permissoes: ["estoque:inventario"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(papel.concede("venda:criar")).toBe(false);
  });

  it("descarta permissão repetida", () => {
    const papel = Papel.criar({
      codigo: "CONFERENTE",
      nome: "Conferente",
      permissoes: ["estoque:inventario", "estoque:inventario"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(papel.permissoes).toEqual(["estoque:inventario"]);
  });

  it("compara por código", () => {
    const a = Papel.criar({
      codigo: "X_UM",
      nome: "Um",
      permissoes: [],
      limites: LimitesPapel.nenhum(),
    }).unwrap();
    const mesmoCodigoOutroNome = Papel.criar({
      codigo: "X_UM",
      nome: "Outro nome",
      permissoes: ["venda:criar"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();
    const outro = Papel.criar({
      codigo: "X_DOIS",
      nome: "Dois",
      permissoes: [],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(a.equals(mesmoCodigoOutroNome)).toBe(true);
    expect(a.equals(outro)).toBe(false);
  });
});

describe("Papel.reconstituir", () => {
  it("aceita permissões conhecidas vindas do banco", () => {
    const papel = Papel.reconstituir({
      codigo: "OPERADOR_CAIXA",
      nome: "Operador",
      permissoes: ["venda:criar", "caixa:abrir"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(papel.permissoes).toHaveLength(2);
  });

  it("descarta permissão que o código não conhece", () => {
    // Base numa versão à frente da aplicação é situação real durante
    // atualização. Confiar no texto abriria acesso a partir de uma linha de
    // banco (§9.5, negar por padrão).
    const papel = Papel.reconstituir({
      codigo: "OPERADOR_CAIXA",
      nome: "Operador",
      permissoes: ["venda:criar", "venda:fazer_tudo", "root"],
      limites: LimitesPapel.nenhum(),
    }).unwrap();

    expect(papel.permissoes).toEqual(["venda:criar"]);
  });

  it("propaga erro de código inválido", () => {
    expect(
      Papel.reconstituir({
        codigo: "1",
        nome: "Qualquer",
        permissoes: [],
        limites: LimitesPapel.nenhum(),
      }).isErr(),
    ).toBe(true);
  });
});

describe("papéis de fábrica", () => {
  it("entrega os sete papéis do §9.2", () => {
    const codigos = papeisDeFabrica().map((papel) => papel.codigo);

    expect(codigos).toEqual([
      "OPERADOR_CAIXA",
      "SUPERVISOR",
      "ESTOQUISTA",
      "FINANCEIRO",
      "GERENTE",
      "CONTADOR",
      "ADMIN",
    ]);
  });

  it("todos são válidos e têm nome legível", () => {
    // O `unwrap` interno da fábrica transforma dado de fábrica inválido em
    // exceção; este teste é o que a pega antes de qualquer instalação.
    for (const papel of papeisDeFabrica()) {
      expect(papel.nome.length).toBeGreaterThan(0);
      expect(papel.permissoes.length).toBeGreaterThan(0);
    }
  });

  it("operador de caixa não cancela venda, não vê custo e não vê venda de outro", () => {
    // São os três vetores de furto interno mapeados no §7.1. Aparecem como
    // ausência de permissão, nunca como negação explícita.
    const operador = porCodigo("OPERADOR_CAIXA");

    expect(operador.concede("venda:cancelar")).toBe(false);
    expect(operador.concede("produto:ver_custo")).toBe(false);
    expect(operador.concede("venda:consultar_todas")).toBe(false);
    expect(operador.concede("caixa:sangria")).toBe(false);
  });

  it("operador de caixa vende e fecha o próprio caixa", () => {
    const operador = porCodigo("OPERADOR_CAIXA");

    expect(operador.concede("venda:criar")).toBe(true);
    expect(operador.concede("caixa:abrir")).toBe(true);
    expect(operador.concede("caixa:fechar")).toBe(true);
    expect(operador.concede("venda:consultar_propria")).toBe(true);
  });

  it("aplica os limites do §9.4 ao operador, supervisor e gerente", () => {
    expect(porCodigo("OPERADOR_CAIXA").limites.descontoItem).toBe(500);
    expect(porCodigo("OPERADOR_CAIXA").limites.descontoVenda).toBe(300);
    expect(porCodigo("SUPERVISOR").limites.descontoItem).toBe(1_500);
    expect(porCodigo("SUPERVISOR").limites.descontoVenda).toBe(1_000);
    expect(porCodigo("GERENTE").limites.descontoItem).toBe(3_000);
    expect(porCodigo("GERENTE").limites.descontoVenda).toBe(2_500);
  });

  it("limita a sangria do supervisor a R$ 500 e libera a do gerente", () => {
    expect(porCodigo("SUPERVISOR").limites.sangria).toEqual(
      Dinheiro.deReais("500.00").unwrap(),
    );
    expect(porCodigo("GERENTE").limites.sangria).toBe(ILIMITADO);
  });

  it("limita o estorno do supervisor a R$ 200", () => {
    expect(porCodigo("SUPERVISOR").limites.estornoEmDinheiro).toEqual(
      Dinheiro.deReais("200.00").unwrap(),
    );
  });

  it("dá ao supervisor trinta minutos para cancelar", () => {
    expect(porCodigo("SUPERVISOR").limites.cancelarVendaAteMinutos).toBe(30);
    expect(porCodigo("GERENTE").limites.cancelarVendaAteMinutos).toBe(ILIMITADO);
  });

  it("contador é somente leitura", () => {
    const contador = porCodigo("CONTADOR");

    const escritas = [
      "venda:criar",
      "venda:cancelar",
      "produto:criar",
      "produto:editar",
      "estoque:entrada",
      "estoque:ajuste",
      "caixa:abrir",
      "financeiro:lancar",
      "fiscal:emitir",
      "fiscal:cancelar",
      "config:fiscal",
    ] as const;

    for (const permissao of escritas) {
      expect(contador.concede(permissao)).toBe(false);
    }
  });

  it("gerente não altera configuração fiscal nem edita permissões", () => {
    // Configuração fiscal errada gera passivo com o fisco; quem edita permissões
    // pode se promover.
    const gerente = porCodigo("GERENTE");

    expect(gerente.concede("config:fiscal")).toBe(false);
    expect(gerente.concede("usuario:editar_permissoes")).toBe(false);
  });

  it("estoquista não vende e não vê financeiro", () => {
    const estoquista = porCodigo("ESTOQUISTA");

    expect(estoquista.concede("venda:criar")).toBe(false);
    expect(estoquista.concede("financeiro:ver")).toBe(false);
  });

  it("financeiro não vende e não mexe em estoque", () => {
    const financeiro = porCodigo("FINANCEIRO");

    expect(financeiro.concede("venda:criar")).toBe(false);
    expect(financeiro.concede("estoque:ajuste")).toBe(false);
  });

  it("admin concede todas as permissões do catálogo", () => {
    const admin = porCodigo("ADMIN");

    for (const permissao of PERMISSOES) {
      expect(admin.concede(permissao)).toBe(true);
    }
  });

  it("admin tem alçada ilimitada", () => {
    const admin = porCodigo("ADMIN");

    expect(admin.limites.cobreDescontoEmItem(10_000)).toBe(true);
    expect(admin.limites.sangria).toBe(ILIMITADO);
    expect(admin.limites.cancelarVendaAteMinutos).toBe(ILIMITADO);
  });

  it("só o admin configura o fiscal e edita permissões", () => {
    const comFiscal = papeisDeFabrica().filter((papel) => papel.concede("config:fiscal"));
    const comPermissoes = papeisDeFabrica().filter((papel) =>
      papel.concede("usuario:editar_permissoes"),
    );

    expect(comFiscal.map((papel) => papel.codigo)).toEqual(["ADMIN"]);
    expect(comPermissoes.map((papel) => papel.codigo)).toEqual(["ADMIN"]);
  });
});
