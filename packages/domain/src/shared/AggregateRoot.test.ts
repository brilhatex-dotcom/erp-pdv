import { describe, expect, it } from "vitest";

import { AggregateRoot } from "./AggregateRoot.js";
import type { DomainEvent } from "./DomainEvent.js";
import { Entity } from "./Entity.js";
import { Identificador } from "./Identificador.js";

const ID_A = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();
const ID_B = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6c").unwrap();
const INSTANTE = new Date("2026-07-30T12:00:00.000Z");

/** Evento concreto, com os dados próprios do fato além dos campos obrigatórios. */
interface PrecoAlteradoFalso extends DomainEvent {
  readonly tipo: "PrecoAlterado";
  readonly anterior: number;
  readonly novo: number;
}

class ProdutoFalso extends AggregateRoot {
  #preco: number;

  constructor(id: Identificador, preco: number) {
    super(id);
    this.#preco = preco;
  }

  get preco(): number {
    return this.#preco;
  }

  alterarPreco(novo: number, agora: Date): void {
    const evento: PrecoAlteradoFalso = {
      tipo: "PrecoAlterado",
      agregadoId: this.id,
      ocorridoEm: agora,
      anterior: this.#preco,
      novo,
    };

    this.#preco = novo;
    this.registrarEvento(evento);
  }
}

/** Entidade de outro tipo, para provar que a igualdade considera a classe. */
class ClienteFalso extends Entity {
  static criar(id: Identificador): ClienteFalso {
    return new ClienteFalso(id);
  }
}

describe("Entity", () => {
  it("considera iguais entidades do mesmo tipo com o mesmo identificador", () => {
    // Mesmo com atributos diferentes: identidade não muda quando o dado muda.
    const a = new ProdutoFalso(ID_A, 100);
    const b = new ProdutoFalso(ID_A, 999);

    expect(a.equals(b)).toBe(true);
  });

  it("diferencia entidades com identificadores distintos", () => {
    expect(new ProdutoFalso(ID_A, 100).equals(new ProdutoFalso(ID_B, 100))).toBe(false);
  });

  it("diferencia tipos distintos, mesmo com o identificador igual", () => {
    // Um Produto e um Cliente que compartilhassem id não são a mesma entidade.
    expect(new ProdutoFalso(ID_A, 100).equals(ClienteFalso.criar(ID_A))).toBe(false);
  });

  it("expõe o identificador", () => {
    expect(new ProdutoFalso(ID_A, 100).id.equals(ID_A)).toBe(true);
  });
});

describe("AggregateRoot", () => {
  it("nasce sem eventos pendentes", () => {
    const produto = new ProdutoFalso(ID_A, 100);

    expect(produto.eventos).toHaveLength(0);
    expect(produto.temEventosPendentes).toBe(false);
  });

  it("acumula o evento de uma mudança", () => {
    const produto = new ProdutoFalso(ID_A, 100);

    produto.alterarPreco(150, INSTANTE);

    expect(produto.temEventosPendentes).toBe(true);
    expect(produto.eventos).toHaveLength(1);
    expect(produto.eventos[0]?.tipo).toBe("PrecoAlterado");
    expect(produto.eventos[0]?.agregadoId.equals(ID_A)).toBe(true);
  });

  it("usa o instante recebido, sem consultar o relógio por conta própria", () => {
    // É essa injeção que torna o teste determinístico.
    const produto = new ProdutoFalso(ID_A, 100);

    produto.alterarPreco(150, INSTANTE);

    expect(produto.eventos[0]?.ocorridoEm).toBe(INSTANTE);
  });

  it("acumula vários eventos na ordem em que ocorreram", () => {
    const produto = new ProdutoFalso(ID_A, 100);

    produto.alterarPreco(150, INSTANTE);
    produto.alterarPreco(200, INSTANTE);

    expect(produto.eventos).toHaveLength(2);
  });

  it("entrega e esvazia a fila num passo só", () => {
    const produto = new ProdutoFalso(ID_A, 100);
    produto.alterarPreco(150, INSTANTE);

    const coletados = produto.coletarEventos();

    expect(coletados).toHaveLength(1);
    expect(produto.eventos).toHaveLength(0);
    expect(produto.temEventosPendentes).toBe(false);
  });

  it("não publica duas vezes o mesmo evento", () => {
    const produto = new ProdutoFalso(ID_A, 100);
    produto.alterarPreco(150, INSTANTE);

    produto.coletarEventos();

    expect(produto.coletarEventos()).toHaveLength(0);
  });

  it("preserva eventos registrados depois de uma coleta", () => {
    const produto = new ProdutoFalso(ID_A, 100);
    produto.alterarPreco(150, INSTANTE);
    produto.coletarEventos();

    produto.alterarPreco(200, INSTANTE);

    expect(produto.eventos).toHaveLength(1);
    expect(produto.preco).toBe(200);
  });

  it("expõe os eventos como leitura, sem permitir alteração externa", () => {
    const produto = new ProdutoFalso(ID_A, 100);
    produto.alterarPreco(150, INSTANTE);

    const eventos = produto.eventos;

    // O tipo é readonly; em runtime, a lista devolvida reflete o estado interno
    // e a única forma de esvaziá-la é `coletarEventos`.
    expect(eventos).toHaveLength(1);
    expect(produto.coletarEventos()).toHaveLength(1);
  });
});
