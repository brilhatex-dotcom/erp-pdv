import { describe, expect, it } from "vitest";

import { Pin } from "./Pin.js";

describe("Pin.criar", () => {
  it("aceita seis dígitos não óbvios", () => {
    expect(Pin.criar("482913").unwrap().revelar()).toBe("482913");
  });

  it("remove espaço em volta", () => {
    expect(Pin.criar(" 482913 ").unwrap().revelar()).toBe("482913");
  });

  it("recusa tamanho diferente de seis", () => {
    for (const invalido of ["", "1", "12345", "1234567"]) {
      const resultado = Pin.criar(invalido);

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("PIN_FORMATO_INVALIDO");
    }
  });

  it("recusa caractere que não é dígito", () => {
    for (const invalido of ["48291a", "48-913", "48 913"]) {
      expect(Pin.criar(invalido).isErr()).toBe(true);
    }
  });

  it("não põe o PIN recusado nos detalhes do erro", () => {
    // O erro vai para o log. Detalhe com o valor digitado seria a credencial
    // vazando pelo caminho do diagnóstico.
    const resultado = Pin.criar("12345");

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && JSON.stringify(resultado.error.detalhes)).not.toContain(
      "12345",
    );
  });

  it("recusa dígitos repetidos", () => {
    for (const trivial of ["000000", "111111", "999999"]) {
      const resultado = Pin.criar(trivial);

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("PIN_PREVISIVEL");
    }
  });

  it("recusa sequência crescente e decrescente", () => {
    // São as primeiras tentativas de quem está ao lado — e a ameaça mapeada como
    // alta é o colega, não o invasor remoto.
    for (const trivial of ["123456", "234567", "654321", "987654"]) {
      const resultado = Pin.criar(trivial);

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("PIN_PREVISIVEL");
    }
  });

  it("aceita PIN que só parece sequência", () => {
    expect(Pin.criar("123457").isOk()).toBe(true);
    expect(Pin.criar("124356").isOk()).toBe(true);
  });

  it("não revela o segredo ao ser convertido em texto", () => {
    const pin = Pin.criar("482913").unwrap();

    expect(String(pin)).not.toContain("482913");

    // Interpolação é o caminho real do acidente — `log.info(\`pin ${pin}\`)` num
    // diagnóstico às pressas. O lint proíbe interpolar objeto justamente para
    // evitá-lo, e aqui o que se verifica é que, se acontecer, o segredo não sai.
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    expect(`${pin}`).toBe("[PIN oculto]");
  });

  it("não revela o segredo em JSON", () => {
    // O caminho mais comum de vazamento não é ataque: é um objeto inteiro
    // caindo no log estruturado.
    const pin = Pin.criar("482913").unwrap();

    expect(JSON.stringify({ pin })).not.toContain("482913");
    expect(JSON.stringify({ pin })).toBe('{"pin":"[PIN oculto]"}');
  });
});
