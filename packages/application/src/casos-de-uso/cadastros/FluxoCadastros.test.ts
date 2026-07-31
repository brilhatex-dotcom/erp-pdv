import { Categoria, Cliente, Documento, Fornecedor, Identificador } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { AlterarCategoria } from "./AlterarCategoria.js";
import { AlterarCliente } from "./AlterarCliente.js";
import { AlterarFornecedor } from "./AlterarFornecedor.js";
import { CadastrarCategoria } from "./CadastrarCategoria.js";
import { CadastrarCliente } from "./CadastrarCliente.js";
import { CadastrarFornecedor } from "./CadastrarFornecedor.js";

const CPF = "529.982.247-25";
const OUTRO_CPF = "111.444.777-35";
const CNPJ = "11.222.333/0001-81";
const AUSENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999").unwrap();

const ENDERECO = {
  logradouro: "Rua das Flores",
  numero: "10",
  bairro: "Centro",
  municipio: "Osasco",
  uf: "SP",
  cep: "06010-000",
};

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    cadastrarCategoria: new CadastrarCategoria(ambiente.unitOfWork, ambiente.geradorId),
    alterarCategoria: new AlterarCategoria(ambiente.unitOfWork),
    cadastrarCliente: new CadastrarCliente(ambiente.unitOfWork, ambiente.geradorId),
    alterarCliente: new AlterarCliente(ambiente.unitOfWork),
    cadastrarFornecedor: new CadastrarFornecedor(ambiente.unitOfWork, ambiente.geradorId),
    alterarFornecedor: new AlterarFornecedor(ambiente.unitOfWork),
  };
}

let cenario: ReturnType<typeof montar>;

beforeEach(() => {
  cenario = montar();
});

describe("Categoria", () => {
  it("cadastra e fica disponível para consulta", async () => {
    const resultado = await cenario.cadastrarCategoria.executar({ nome: "Bebidas" });

    expect(resultado.isOk()).toBe(true);
    const categoria = resultado.unwrap();
    expect(categoria.nome).toBe("Bebidas");
    expect(categoria.ativa).toBe(true);
    expect(await cenario.categorias.porNome("bebidas")).toBeDefined();
  });

  it("recusa nome vazio antes de tocar no banco", async () => {
    const resultado = await cenario.cadastrarCategoria.executar({ nome: "  " });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NOME_VAZIO");
    }
    expect(cenario.categorias.itens.size).toBe(0);
  });

  it("🔑 recusa nome repetido mesmo com acento e caixa diferentes", async () => {
    // "Bebidas" e "bebidas " parecem a mesma na tela e dividem o faturamento
    // em duas linhas no relatório.
    await cenario.cadastrarCategoria.executar({ nome: "Bebidas" });
    const repetida = await cenario.cadastrarCategoria.executar({ nome: "  BEBIDAS " });

    expect(repetida.isErr()).toBe(true);
    if (repetida.isErr()) {
      expect(repetida.error.codigo).toBe("CATEGORIA_JA_EXISTE");
      expect(repetida.error.tipo).toBe("CONFLITO");
    }
    expect(cenario.categorias.itens.size).toBe(1);
  });

  it("renomeia e desativa", async () => {
    const criada = (
      await cenario.cadastrarCategoria.executar({ nome: "Bebidas" })
    ).unwrap();

    const alterada = await cenario.alterarCategoria.executar({
      id: criada.id,
      nome: "Bebidas Geladas",
      ativa: false,
    });

    expect(alterada.isOk()).toBe(true);
    expect(alterada.unwrap().nome).toBe("Bebidas Geladas");
    expect(alterada.unwrap().ativa).toBe(false);
  });

  it("reativa uma categoria desativada", async () => {
    const criada = (
      await cenario.cadastrarCategoria.executar({ nome: "Bebidas" })
    ).unwrap();
    criada.desativar();

    const alterada = await cenario.alterarCategoria.executar({
      id: criada.id,
      nome: "Bebidas",
      ativa: true,
    });

    expect(alterada.unwrap().ativa).toBe(true);
  });

  it("🔑 deixa a categoria trocar só a caixa do próprio nome", async () => {
    const criada = (
      await cenario.cadastrarCategoria.executar({ nome: "bebidas" })
    ).unwrap();

    const alterada = await cenario.alterarCategoria.executar({
      id: criada.id,
      nome: "Bebidas",
      ativa: true,
    });

    expect(alterada.isOk()).toBe(true);
  });

  it("recusa renomear para o nome de outra", async () => {
    await cenario.cadastrarCategoria.executar({ nome: "Bebidas" });
    const outra = (
      await cenario.cadastrarCategoria.executar({ nome: "Limpeza" })
    ).unwrap();

    const resultado = await cenario.alterarCategoria.executar({
      id: outra.id,
      nome: "Bebidas",
      ativa: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_JA_EXISTE");
    }
  });

  it("recusa renomear para vazio", async () => {
    const criada = (
      await cenario.cadastrarCategoria.executar({ nome: "Bebidas" })
    ).unwrap();

    const resultado = await cenario.alterarCategoria.executar({
      id: criada.id,
      nome: "",
      ativa: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NOME_VAZIO");
    }
  });

  it("devolve não encontrada para identificador desconhecido", async () => {
    const resultado = await cenario.alterarCategoria.executar({
      id: AUSENTE,
      nome: "Bebidas",
      ativa: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.tipo).toBe("NAO_ENCONTRADO");
    }
  });

  it("lista só as ativas quando pedido", async () => {
    const ativa = (
      await cenario.cadastrarCategoria.executar({ nome: "Bebidas" })
    ).unwrap();
    const inativa = (
      await cenario.cadastrarCategoria.executar({ nome: "Limpeza" })
    ).unwrap();
    inativa.desativar();
    await cenario.categorias.salvar(inativa);

    expect(await cenario.categorias.listar(false)).toHaveLength(2);
    expect(await cenario.categorias.listar(true)).toEqual([ativa]);
  });
});

describe("Cliente — cadastro", () => {
  it("🔑 cadastra sem documento — a padaria anota o fiado sem pedir CPF", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria da Silva",
      tipoPessoa: "FISICA",
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().documento).toBeUndefined();
  });

  it("cadastra com documento, contato, endereço e limite", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria da Silva",
      apelido: "Dona Maria",
      tipoPessoa: "FISICA",
      documento: CPF,
      telefone: "(11) 98888-7777",
      email: "maria@exemplo.com",
      endereco: ENDERECO,
      limiteCreditoCentavos: 20_000n,
      observacao: "Prefere entrega pela manhã",
    });

    expect(resultado.isOk()).toBe(true);
    const cliente = resultado.unwrap();
    expect(cliente.exibicao).toBe("Dona Maria");
    expect(cliente.documento?.valor).toBe("52998224725");
    expect(cliente.telefone?.digitos).toBe("11988887777");
    expect(cliente.endereco?.municipio).toBe("Osasco");
    expect(cliente.limiteCredito.centavos).toBe(20_000n);
    expect(cliente.vendeAPrazo).toBe(true);
  });

  it("🔑 recusa o mesmo documento duas vezes, dizendo de quem ele é", async () => {
    // Sem isto o fiado da pessoa fica dividido entre dois cadastros, e a
    // consulta de um não mostra a dívida do outro.
    await cenario.cadastrarCliente.executar({
      nome: "Maria da Silva",
      tipoPessoa: "FISICA",
      documento: CPF,
    });

    const repetido = await cenario.cadastrarCliente.executar({
      nome: "Maria S.",
      tipoPessoa: "FISICA",
      documento: "52998224725",
    });

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("CLIENTE_DOCUMENTO_JA_CADASTRADO");
      expect(repetido.error.mensagem).toContain("Maria da Silva");
    }
    expect(cenario.clientes.itens.size).toBe(1);
  });

  it("recusa documento malformado", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria",
      tipoPessoa: "FISICA",
      documento: "123",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DOCUMENTO_TAMANHO_INVALIDO");
    }
  });

  it("🔑 devolve os erros de formato e os de regra numa gravação só", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "",
      tipoPessoa: "FISICA",
      telefone: "999",
      email: "sem-arroba",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DADOS_INVALIDOS");

      const detalhados = resultado.error.detalhes?.["erros"];
      expect(Array.isArray(detalhados)).toBe(true);
      expect(detalhados).toHaveLength(3);
    }
  });

  it("recusa endereço incompleto sem gravar o cliente", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria",
      tipoPessoa: "FISICA",
      endereco: { ...ENDERECO, cep: "1", uf: "ZZ" },
    });

    expect(resultado.isErr()).toBe(true);
    expect(cenario.clientes.itens.size).toBe(0);
  });

  it("recusa limite de crédito acima do que o tipo comporta", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria",
      tipoPessoa: "FISICA",
      limiteCreditoCentavos: 10n ** 20n,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("recusa inscrição estadual em pessoa física", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Maria",
      tipoPessoa: "FISICA",
      inscricaoEstadual: "ISENTO",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CLIENTE_IE_EM_PESSOA_FISICA");
    }
  });

  it("aceita empresa com CNPJ e inscrição estadual", async () => {
    const resultado = await cenario.cadastrarCliente.executar({
      nome: "Mercadinho do Bairro Ltda",
      tipoPessoa: "JURIDICA",
      documento: CNPJ,
      inscricaoEstadual: "110042490114",
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().inscricaoEstadual?.valor).toBe("110042490114");
  });
});

describe("Cliente — alteração", () => {
  async function cadastrado(): Promise<Cliente> {
    return (
      await cenario.cadastrarCliente.executar({
        nome: "Maria da Silva",
        tipoPessoa: "FISICA",
        documento: CPF,
        telefone: "(11) 98888-7777",
        observacao: "Cliente antigo",
      })
    ).unwrap();
  }

  it("aplica o estado completo enviado pelo formulário", async () => {
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria Aparecida da Silva",
      apelido: "Dona Cida",
      documento: CPF,
      limiteCreditoCentavos: 50_000n,
      ativo: true,
    });

    expect(resultado.isOk()).toBe(true);
    const alterado = resultado.unwrap();
    expect(alterado.nome).toBe("Maria Aparecida da Silva");
    expect(alterado.apelido).toBe("Dona Cida");
    expect(alterado.limiteCredito.centavos).toBe(50_000n);
  });

  it("🔑 limpa campo que o formulário enviou vazio", async () => {
    // Caso de uso que trata ausente como "não mexer" torna impossível apagar
    // uma observação — e quem tenta descobre que o sistema a mantém.
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria da Silva",
      ativo: true,
    });

    const alterado = resultado.unwrap();
    expect(alterado.observacao).toBeUndefined();
    expect(alterado.telefone).toBeUndefined();
    expect(alterado.documento).toBeUndefined();
    expect(alterado.limiteCredito.ehZero()).toBe(true);
  });

  it("desativa e reativa", async () => {
    const cliente = await cadastrado();

    const desativado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: cliente.nome,
      documento: CPF,
      ativo: false,
    });
    expect(desativado.unwrap().ativo).toBe(false);

    const reativado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: cliente.nome,
      documento: CPF,
      ativo: true,
    });
    expect(reativado.unwrap().ativo).toBe(true);
  });

  it("🔑 deixa o cliente manter o próprio documento", async () => {
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria da Silva",
      documento: CPF,
      ativo: true,
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("recusa assumir o documento de outro cliente", async () => {
    const cliente = await cadastrado();
    await cenario.cadastrarCliente.executar({
      nome: "João",
      tipoPessoa: "FISICA",
      documento: OUTRO_CPF,
    });

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria da Silva",
      documento: OUTRO_CPF,
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CLIENTE_DOCUMENTO_JA_CADASTRADO");
    }
  });

  it("acumula erros de vários campos numa resposta só", async () => {
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "",
      documento: "abc",
      limiteCreditoCentavos: -1n,
      observacao: "x".repeat(501),
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DADOS_INVALIDOS");
    }
  });

  it("recusa documento incompatível com o tipo de pessoa", async () => {
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria da Silva",
      documento: CNPJ,
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CLIENTE_DOCUMENTO_INCOMPATIVEL");
    }
  });

  it("recusa inscrição estadual em pessoa física", async () => {
    const cliente = await cadastrado();

    const resultado = await cenario.alterarCliente.executar({
      id: cliente.id,
      nome: "Maria da Silva",
      inscricaoEstadual: "ISENTO",
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CLIENTE_IE_EM_PESSOA_FISICA");
    }
  });

  it("devolve não encontrado para identificador desconhecido", async () => {
    const resultado = await cenario.alterarCliente.executar({
      id: AUSENTE,
      nome: "Maria",
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.tipo).toBe("NAO_ENCONTRADO");
    }
  });
});

describe("Cliente — busca", () => {
  beforeEach(async () => {
    await cenario.cadastrarCliente.executar({
      nome: "Maria da Silva",
      tipoPessoa: "FISICA",
      documento: CPF,
    });
    await cenario.cadastrarCliente.executar({
      nome: "João Pereira",
      tipoPessoa: "FISICA",
      documento: OUTRO_CPF,
    });
  });

  it("encontra pelo termo digitado", async () => {
    const achados = await cenario.clientes.buscar({ termo: "maria", limite: 20 });

    expect(achados).toHaveLength(1);
    expect(achados[0]?.nome).toBe("Maria da Silva");
  });

  it("devolve os primeiros quando o termo está vazio", async () => {
    expect(await cenario.clientes.buscar({ limite: 20 })).toHaveLength(2);
  });

  it("🔑 respeita o limite — a tela mostra vinte, não dez mil", async () => {
    expect(await cenario.clientes.buscar({ limite: 1 })).toHaveLength(1);
  });

  it("filtra os inativos quando pedido", async () => {
    const maria = (
      await cenario.clientes.buscar({ termo: "maria", limite: 1 })
    )[0] as Cliente;
    maria.desativar();
    await cenario.clientes.salvar(maria);

    expect(
      await cenario.clientes.buscar({ limite: 20, apenasAtivos: true }),
    ).toHaveLength(1);
    expect(await cenario.clientes.buscar({ limite: 20 })).toHaveLength(2);
  });

  it("acha pelo documento", async () => {
    const documento = Documento.criar(CPF).unwrap();

    expect(await cenario.clientes.porDocumento(documento)).toBeDefined();
  });

  it("não acha documento que ninguém tem", async () => {
    const documento = Documento.criar(CNPJ).unwrap();

    expect(await cenario.clientes.porDocumento(documento)).toBeUndefined();
  });
});

describe("Fornecedor", () => {
  async function cadastrado(): Promise<Fornecedor> {
    return (
      await cenario.cadastrarFornecedor.executar({
        razaoSocial: "Distribuidora Vale Ltda",
        nomeFantasia: "Vale Bebidas",
        documento: CNPJ,
        prazoEntregaDias: 7,
      })
    ).unwrap();
  }

  it("cadastra com documento, fantasia e prazo", async () => {
    const fornecedor = await cadastrado();

    expect(fornecedor.exibicao).toBe("Vale Bebidas");
    expect(fornecedor.documento.valor).toBe("11222333000181");
    expect(fornecedor.prazoEntregaDias).toBe(7);
  });

  it("🔑 exige documento — sem ele o cadastro não fecha com nota nenhuma", async () => {
    const resultado = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Distribuidora Vale Ltda",
      documento: "  ",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("FORNECEDOR_DOCUMENTO_OBRIGATORIO");
    }
  });

  it("recusa documento malformado sem mascarar o motivo", async () => {
    const resultado = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Distribuidora Vale Ltda",
      documento: "12345",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DOCUMENTO_TAMANHO_INVALIDO");
    }
  });

  it("🔑 aceita CPF — o hortifruti compra do sitiante da região", async () => {
    const resultado = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Sítio Boa Vista",
      documento: CPF,
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().documento.ehPessoaFisica).toBe(true);
  });

  it("recusa documento repetido, dizendo de quem ele é", async () => {
    await cadastrado();

    const repetido = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Vale Distribuidora ME",
      documento: "11222333000181",
    });

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("FORNECEDOR_DOCUMENTO_JA_CADASTRADO");
      expect(repetido.error.mensagem).toContain("Vale Bebidas");
    }
  });

  it("recusa razão social vazia e prazo absurdo de uma vez", async () => {
    const resultado = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "",
      documento: CNPJ,
      prazoEntregaDias: 20_260_731,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DADOS_INVALIDOS");
    }
  });

  it("recusa endereço incompleto", async () => {
    const resultado = await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Distribuidora Vale Ltda",
      documento: CNPJ,
      endereco: { ...ENDERECO, uf: "ZZ" },
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("altera razão social, contato e prazo", async () => {
    const fornecedor = await cadastrado();

    const resultado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: "Distribuidora Vale do Sol Ltda",
      documento: CNPJ,
      telefone: "1138887777",
      email: "vendas@vale.com",
      inscricaoEstadual: "ISENTO",
      endereco: ENDERECO,
      prazoEntregaDias: 15,
      observacao: "Entrega só às terças",
      ativo: true,
    });

    expect(resultado.isOk()).toBe(true);
    const alterado = resultado.unwrap();
    expect(alterado.razaoSocial).toBe("Distribuidora Vale do Sol Ltda");
    expect(alterado.nomeFantasia).toBeUndefined();
    expect(alterado.telefone?.digitos).toBe("1138887777");
    expect(alterado.inscricaoEstadual?.ehIsento).toBe(true);
    expect(alterado.prazoEntregaDias).toBe(15);
    expect(alterado.observacao).toBe("Entrega só às terças");
  });

  it("desativa e reativa", async () => {
    const fornecedor = await cadastrado();

    const desativado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: fornecedor.razaoSocial,
      documento: CNPJ,
      ativo: false,
    });
    expect(desativado.unwrap().ativo).toBe(false);

    const reativado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: fornecedor.razaoSocial,
      documento: CNPJ,
      ativo: true,
    });
    expect(reativado.unwrap().ativo).toBe(true);
  });

  it("deixa o fornecedor manter o próprio documento", async () => {
    const fornecedor = await cadastrado();

    const resultado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: fornecedor.razaoSocial,
      documento: CNPJ,
      ativo: true,
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("recusa assumir o documento de outro fornecedor", async () => {
    const fornecedor = await cadastrado();
    await cenario.cadastrarFornecedor.executar({
      razaoSocial: "Sítio Boa Vista",
      documento: CPF,
    });

    const resultado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: fornecedor.razaoSocial,
      documento: CPF,
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("FORNECEDOR_DOCUMENTO_JA_CADASTRADO");
    }
  });

  it("recusa alteração sem documento", async () => {
    const fornecedor = await cadastrado();

    const resultado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: fornecedor.razaoSocial,
      documento: "",
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("FORNECEDOR_DOCUMENTO_OBRIGATORIO");
    }
  });

  it("acumula erros de razão social, prazo e observação", async () => {
    const fornecedor = await cadastrado();

    const resultado = await cenario.alterarFornecedor.executar({
      id: fornecedor.id,
      razaoSocial: "",
      documento: CNPJ,
      prazoEntregaDias: -1,
      observacao: "x".repeat(501),
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DADOS_INVALIDOS");
    }
  });

  it("devolve não encontrado para identificador desconhecido", async () => {
    const resultado = await cenario.alterarFornecedor.executar({
      id: AUSENTE,
      razaoSocial: "Distribuidora",
      documento: CNPJ,
      ativo: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.tipo).toBe("NAO_ENCONTRADO");
    }
  });

  it("busca por termo, respeitando limite e situação", async () => {
    await cadastrado();
    const sitio = (
      await cenario.cadastrarFornecedor.executar({
        razaoSocial: "Sítio Boa Vista",
        documento: CPF,
      })
    ).unwrap();

    expect(await cenario.fornecedores.buscar({ termo: "vale", limite: 20 })).toHaveLength(
      1,
    );
    expect(await cenario.fornecedores.buscar({ limite: 20 })).toHaveLength(2);
    expect(await cenario.fornecedores.buscar({ limite: 1 })).toHaveLength(1);

    sitio.desativar();
    await cenario.fornecedores.salvar(sitio);
    expect(
      await cenario.fornecedores.buscar({ limite: 20, apenasAtivos: true }),
    ).toHaveLength(1);
  });

  it("acha e não acha por documento", async () => {
    await cadastrado();

    expect(
      await cenario.fornecedores.porDocumento(Documento.criar(CNPJ).unwrap()),
    ).toBeDefined();
    expect(
      await cenario.fornecedores.porDocumento(Documento.criar(CPF).unwrap()),
    ).toBeUndefined();
  });
});

describe("Dublês de cadastro", () => {
  it("aceita item pré-existente sem passar pelo caso de uso", async () => {
    const id = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8001").unwrap();
    const categoria = Categoria.criar({ id, nome: "Bebidas" }).unwrap();

    cenario.categorias.adicionar(categoria);
    expect(await cenario.categorias.porId(id)).toBe(categoria);
    expect(await cenario.categorias.porNome("inexistente")).toBeUndefined();
  });

  it("devolve indefinido para identificador que não existe", async () => {
    expect(await cenario.clientes.porId(AUSENTE)).toBeUndefined();
    expect(await cenario.fornecedores.porId(AUSENTE)).toBeUndefined();
  });

  it("aceita cliente e fornecedor pré-existentes", async () => {
    const idCliente = Identificador.criar(
      "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8002",
    ).unwrap();
    const idFornecedor = Identificador.criar(
      "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8003",
    ).unwrap();

    cenario.clientes.adicionar(
      Cliente.criar({ id: idCliente, nome: "Ana", tipoPessoa: "FISICA" }).unwrap(),
    );
    cenario.fornecedores.adicionar(
      Fornecedor.criar({
        id: idFornecedor,
        razaoSocial: "Atacado Central",
        documento: Documento.criar(CNPJ).unwrap(),
      }).unwrap(),
    );

    expect(await cenario.clientes.porId(idCliente)).toBeDefined();
    expect(await cenario.fornecedores.porId(idFornecedor)).toBeDefined();
  });
});
