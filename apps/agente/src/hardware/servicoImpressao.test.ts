import type { DadosCupom } from "@erp/printing";
import { describe, expect, it, vi } from "vitest";

import type { Impressora, ResultadoImpressao } from "./impressora.js";
import { ServicoImpressao } from "./servicoImpressao.js";

const CUPOM: DadosCupom = {
  loja: { nome: "MERCADINHO DO BAIRRO" },
  numero: 1,
  emitidoEm: new Date("2026-07-31T14:35:00"),
  operador: "Maria",
  itens: [
    {
      numero: 1,
      descricao: "REFRI COLA 2L",
      quantidade: "1000",
      unidade: "UN",
      precoUnitario: "990",
      total: "990",
    },
  ],
  subtotal: "990",
  descontoTotal: "0",
  total: "990",
  pagamentos: [{ descricao: "Dinheiro", valor: "1000" }],
  troco: "10",
  semValorFiscal: true,
};

function impressoraQue(resultado: ResultadoImpressao) {
  const recebido: Uint8Array[] = [];

  const impressora: Impressora = {
    imprimir(bytes) {
      recebido.push(bytes);
      return Promise.resolve(resultado);
    },
  };

  return { impressora, recebido };
}

function contem(bytes: Uint8Array, sequencia: readonly number[]): boolean {
  const lista = [...bytes];
  return lista.some((_, i) =>
    sequencia.every((valor, deslocamento) => lista[i + deslocamento] === valor),
  );
}

const PULSO_GAVETA = [0x1b, 0x70, 0x00, 0x19, 0xfa];

describe("Impressão do cupom", () => {
  it("entrega os bytes do cupom à impressora", async () => {
    const { impressora, recebido } = impressoraQue({ tipo: "IMPRESSO" });

    const aviso = await new ServicoImpressao(impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(aviso.tipo).toBe("IMPRESSO");
    expect(recebido).toHaveLength(1);
    expect(recebido[0]?.length).toBeGreaterThan(0);
  });

  it("🔑 a gaveta só abre quando houve dinheiro em espécie", async () => {
    // Gaveta aberta em venda paga no cartão fica aberta sem motivo, e gaveta
    // aberta sem operador ao lado é convite.
    const semDinheiro = impressoraQue({ tipo: "IMPRESSO" });
    await new ServicoImpressao(semDinheiro.impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });
    expect(contem(semDinheiro.recebido[0]!, PULSO_GAVETA)).toBe(false);

    const comDinheiro = impressoraQue({ tipo: "IMPRESSO" });
    await new ServicoImpressao(comDinheiro.impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: true,
    });
    expect(contem(comDinheiro.recebido[0]!, PULSO_GAVETA)).toBe(true);
  });

  it("respeita a largura do papel configurada", async () => {
    const estreita = impressoraQue({ tipo: "IMPRESSO" });
    const larga = impressoraQue({ tipo: "IMPRESSO" });

    await new ServicoImpressao(estreita.impressora).imprimirCupom({
      cupom: CUPOM,
      colunas: 32,
      houveDinheiro: false,
    });
    await new ServicoImpressao(larga.impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(estreita.recebido[0]!.length).toBeLessThan(larga.recebido[0]!.length);
  });
});

describe("Quando a impressora falha", () => {
  it("🔑 a falha vira aviso, e o aviso diz que a venda está registrada", async () => {
    // "A operação falhou" seria falso e faria o operador refazer a venda — que
    // é como se cobra o cliente duas vezes.
    const { impressora } = impressoraQue({
      tipo: "FALHOU",
      motivo: "ECONNREFUSED 192.168.0.50:9100",
    });

    const aviso = await new ServicoImpressao(impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: true,
    });

    expect(aviso.tipo).toBe("NAO_IMPRESSO");
    if (aviso.tipo === "NAO_IMPRESSO") {
      expect(aviso.mensagem).toContain("venda foi registrada");
      // O detalhe técnico não chega ao operador.
      expect(aviso.mensagem).not.toContain("ECONNREFUSED");
    }
  });

  it("🔑 o detalhe técnico vai para o log — é o que evita ir à loja", async () => {
    const registrar = vi.fn();
    const { impressora } = impressoraQue({
      tipo: "FALHOU",
      motivo: "ECONNREFUSED 192.168.0.50:9100",
    });

    await new ServicoImpressao(impressora, registrar).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(registrar).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED 192.168.0.50:9100"),
    );
  });

  it("🔑 transporte que lança em vez de devolver erro não derruba o caixa", async () => {
    // Devolver `Result` é o contrato. Um adapter que o viole é defeito de
    // programação — mas o balcão não pode parar por causa dele.
    const impressora: Impressora = {
      imprimir() {
        throw new Error("driver explodiu");
      },
    };

    const aviso = await new ServicoImpressao(impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(aviso.tipo).toBe("NAO_IMPRESSO");
  });

  it("promessa rejeitada também vira aviso", async () => {
    const impressora: Impressora = {
      imprimir() {
        return Promise.reject(new Error("porta ocupada"));
      },
    };

    const aviso = await new ServicoImpressao(impressora).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(aviso.tipo).toBe("NAO_IMPRESSO");
  });

  it("causa que não é Error ainda produz mensagem utilizável", async () => {
    const registrar = vi.fn();
    const impressora: Impressora = {
      imprimir() {
        // Rejeitar com algo que não é `Error` é justamente o que se simula: um
        // driver mal-comportado. A regra do lint existe para o código de
        // produção; aqui o desvio é o objeto do teste.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject("sem papel");
      },
    };

    await new ServicoImpressao(impressora, registrar).imprimirCupom({
      cupom: CUPOM,
      houveDinheiro: false,
    });

    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("sem papel"));
  });
});

describe("Gaveta avulsa", () => {
  it("abre sem consumir papel", async () => {
    const { impressora, recebido } = impressoraQue({ tipo: "IMPRESSO" });

    const aviso = await new ServicoImpressao(impressora).abrirGaveta();

    expect(aviso.tipo).toBe("IMPRESSO");
    expect([...recebido[0]!]).toEqual(PULSO_GAVETA);
  });

  it("falha ao abrir também é aviso, com a frase certa", async () => {
    const { impressora } = impressoraQue({ tipo: "FALHOU", motivo: "offline" });

    const aviso = await new ServicoImpressao(impressora).abrirGaveta();

    expect(aviso.tipo).toBe("NAO_IMPRESSO");
    if (aviso.tipo === "NAO_IMPRESSO") {
      expect(aviso.mensagem).toContain("Gaveta não abriu");
    }
  });
});
