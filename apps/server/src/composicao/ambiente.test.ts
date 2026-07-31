import { describe, expect, it } from "vitest";

import { carregarAmbiente, descreverParaLog, ErroConfiguracao } from "./ambiente.js";

const MINIMO = { DATABASE_URL: "postgresql://erp:senha@localhost:55432/erp_pdv" };

describe("carregarAmbiente", () => {
  it("exige a URL do banco", () => {
    expect(() => carregarAmbiente({})).toThrow(ErroConfiguracao);
  });

  it("diz qual variável falta, em vez de só recusar", () => {
    // Quem instala não tem o código à mão: a mensagem é a única pista.
    try {
      carregarAmbiente({});
      expect.unreachable("deveria ter recusado");
    } catch (causa) {
      expect(causa).toBeInstanceOf(ErroConfiguracao);
      expect((causa as ErroConfiguracao).message).toContain("DATABASE_URL");
      expect((causa as ErroConfiguracao).message).toContain("não foi informada");
    }
  });

  it("relata todos os problemas de uma vez", () => {
    // Um por vez faria a instalação virar tentativa e erro.
    try {
      carregarAmbiente({ SERVIDOR_PORTA: "0", NIVEL_LOG: "verboso" });
      expect.unreachable("deveria ter recusado");
    } catch (causa) {
      const problemas = (causa as ErroConfiguracao).problemas;

      expect(problemas).toHaveLength(3);
      expect(problemas.join("\n")).toContain("DATABASE_URL");
      expect(problemas.join("\n")).toContain("SERVIDOR_PORTA");
      expect(problemas.join("\n")).toContain("NIVEL_LOG");
    }
  });

  it("escuta somente esta máquina por padrão", () => {
    // O padrão precisa ser o seguro: expor o servidor na rede da loja é decisão
    // consciente de quem instala, não consequência de esquecer uma variável
    // (ARQUITETURA.md §7.2).
    expect(carregarAmbiente(MINIMO).endereco).toBe("127.0.0.1");
  });

  it("aplica os demais padrões", () => {
    const ambiente = carregarAmbiente(MINIMO);

    expect(ambiente).toEqual({
      modo: "development",
      endereco: "127.0.0.1",
      porta: 3000,
      urlBanco: MINIMO.DATABASE_URL,
      nivelLog: "info",
      registrarConsultasSql: false,
      limiteRequisicoesPorMinuto: 600,
      tempoLimiteEncerramentoMs: 10_000,
    });
  });

  it("converte os números para número", () => {
    const ambiente = carregarAmbiente({
      ...MINIMO,
      SERVIDOR_PORTA: "8080",
      LIMITE_REQUISICOES_POR_MINUTO: "120",
      TEMPO_LIMITE_ENCERRAMENTO_MS: "5000",
    });

    expect(ambiente.porta).toBe(8080);
    expect(ambiente.limiteRequisicoesPorMinuto).toBe(120);
    expect(ambiente.tempoLimiteEncerramentoMs).toBe(5_000);
  });

  it("recusa porta fora da faixa", () => {
    for (const porta of ["0", "65536", "99999", "-1", "3000.5", "oito mil"]) {
      expect(() => carregarAmbiente({ ...MINIMO, SERVIDOR_PORTA: porta })).toThrow(
        ErroConfiguracao,
      );
    }
  });

  it("aceita as pontas da faixa de portas", () => {
    expect(carregarAmbiente({ ...MINIMO, SERVIDOR_PORTA: "1" }).porta).toBe(1);
    expect(carregarAmbiente({ ...MINIMO, SERVIDOR_PORTA: "65535" }).porta).toBe(65_535);
  });

  it("recusa URL que não é do PostgreSQL", () => {
    // Um SQLite esquecido na configuração levaria o sistema a subir com o banco
    // errado, e o ADR-0013 existe justamente para que isso não aconteça.
    for (const url of ["file:./dev.db", "mysql://localhost/erp", "postgres://", ""]) {
      expect(() => carregarAmbiente({ DATABASE_URL: url })).toThrow(ErroConfiguracao);
    }
  });

  it("aceita as duas grafias do esquema do PostgreSQL", () => {
    expect(carregarAmbiente({ DATABASE_URL: "postgres://erp@host/db" }).urlBanco).toBe(
      "postgres://erp@host/db",
    );
    expect(carregarAmbiente({ DATABASE_URL: "postgresql://erp@host/db" }).urlBanco).toBe(
      "postgresql://erp@host/db",
    );
  });

  it("interpreta o booleano de diagnóstico", () => {
    expect(
      carregarAmbiente({ ...MINIMO, REGISTRAR_CONSULTAS_SQL: "true" })
        .registrarConsultasSql,
    ).toBe(true);
    expect(
      carregarAmbiente({ ...MINIMO, REGISTRAR_CONSULTAS_SQL: "false" })
        .registrarConsultasSql,
    ).toBe(false);
  });

  it("recusa booleano escrito de outra forma em vez de assumir falso", () => {
    // `REGISTRAR_CONSULTAS_SQL=sim` tratado como falso é o tipo de silêncio que
    // faz alguém passar uma tarde tentando entender por que o log não sai.
    expect(() => carregarAmbiente({ ...MINIMO, REGISTRAR_CONSULTAS_SQL: "sim" })).toThrow(
      ErroConfiguracao,
    );
  });

  it("recusa nível de log desconhecido", () => {
    expect(() => carregarAmbiente({ ...MINIMO, NIVEL_LOG: "tudo" })).toThrow(
      ErroConfiguracao,
    );
  });

  it("aceita todos os modos de execução", () => {
    for (const modo of ["development", "test", "production"] as const) {
      expect(carregarAmbiente({ ...MINIMO, NODE_ENV: modo }).modo).toBe(modo);
    }
  });

  it("recusa limite de requisições nulo ou negativo", () => {
    for (const limite of ["0", "-5", "abc"]) {
      expect(() =>
        carregarAmbiente({ ...MINIMO, LIMITE_REQUISICOES_POR_MINUTO: limite }),
      ).toThrow(ErroConfiguracao);
    }
  });

  it("recusa tempo de encerramento não positivo", () => {
    expect(() =>
      carregarAmbiente({ ...MINIMO, TEMPO_LIMITE_ENCERRAMENTO_MS: "0" }),
    ).toThrow(ErroConfiguracao);
  });

  it("remove espaço em volta do endereço", () => {
    expect(
      carregarAmbiente({ ...MINIMO, SERVIDOR_ENDERECO: "  0.0.0.0 " }).endereco,
    ).toBe("0.0.0.0");
  });

  it("recusa endereço vazio", () => {
    expect(() => carregarAmbiente({ ...MINIMO, SERVIDOR_ENDERECO: "   " })).toThrow(
      ErroConfiguracao,
    );
  });
});

describe("descreverParaLog", () => {
  it("oculta a senha do banco", () => {
    // O log vai para arquivo e para o pacote de diagnóstico que o cliente manda
    // ao suporte. Senha ali é vazamento, mesmo sem ninguém ter decidido vazar.
    const descricao = descreverParaLog(carregarAmbiente(MINIMO));

    expect(descricao["banco"]).toBe("postgresql://erp:***@localhost:55432/erp_pdv");
    expect(JSON.stringify(descricao)).not.toContain("senha");
  });

  it("preserva host, porta e nome do banco, que é o que serve ao diagnóstico", () => {
    const descricao = descreverParaLog(carregarAmbiente(MINIMO));

    expect(descricao["banco"]).toContain("localhost:55432");
    expect(descricao["banco"]).toContain("erp_pdv");
  });

  it("não quebra quando a URL não traz credencial", () => {
    const semCredencial = "postgresql://localhost:5432/erp_pdv";

    expect(
      descreverParaLog(carregarAmbiente({ DATABASE_URL: semCredencial }))["banco"],
    ).toBe(semCredencial);
  });

  it("mascara mesmo quando a URL traz só usuário", () => {
    // Autenticação por `.pgpass` ou por confiança na rede local: sem senha na
    // URL, mas o formato precisa sair consistente no log.
    expect(
      descreverParaLog(
        carregarAmbiente({ DATABASE_URL: "postgresql://erp@host/erp_pdv" }),
      )["banco"],
    ).toBe("postgresql://erp:***@host/erp_pdv");
  });

  it("oculta a senha também quando ela está vazia", () => {
    const senhaVazia = "postgresql://erp:@localhost:5432/erp_pdv";

    expect(
      descreverParaLog(carregarAmbiente({ DATABASE_URL: senhaVazia }))["banco"],
    ).toBe("postgresql://erp:***@localhost:5432/erp_pdv");
  });

  it("nunca inclui a URL completa entre as chaves descritas", () => {
    const descricao = descreverParaLog(carregarAmbiente(MINIMO));

    expect(Object.keys(descricao)).not.toContain("urlBanco");
  });
});
