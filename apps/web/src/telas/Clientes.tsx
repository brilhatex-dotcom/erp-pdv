import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  Vazio,
} from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

interface ClienteDaLista {
  readonly id: string;
  readonly nome: string;
  readonly exibicao: string;
  readonly documento?: string;
  readonly telefone?: string;
  /** Centavos em texto — a API nunca manda dinheiro como número. */
  readonly limiteCredito: string;
  readonly vendeAPrazo: boolean;
  readonly ativo: boolean;
}

type Fase =
  | { readonly fase: "LISTA" }
  | { readonly fase: "CADASTRANDO" }
  | { readonly fase: "EDITANDO"; readonly cliente: ClienteDaLista };

type EstadoBusca =
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly ClienteDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Cadastro de clientes.
 *
 * ### A busca vem antes do cadastro, e isso é de propósito
 *
 * A tela abre listando, não com o formulário em branco. É o que empurra o
 * usuário a procurar antes de cadastrar — o defeito clássico deste módulo é o
 * mesmo CPF entrando duas vezes porque ninguém achou o registro existente, e o
 * histórico de compra ficar dividido entre dois cadastros que ninguém junta
 * depois.
 *
 * ### O limite de crédito só aparece para quem pode defini-lo
 *
 * Esconder o campo é **experiência**, não segurança: o servidor recusa o limite
 * de quem não tem `cliente:definir_limite`, mesmo que a requisição seja montada
 * à mão. Aqui ele some para não oferecer ao operador um campo que ele veria
 * recusado depois de preencher.
 */
export function Clientes(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [termo, setTermo] = useState("");
  const [estado, setEstado] = useState<EstadoBusca>({ fase: "BUSCANDO" });
  const [tela, setTela] = useState<Fase>({ fase: "LISTA" });
  const campoBusca = useRef<HTMLInputElement>(null);

  async function buscar(procurado = termo): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: ClienteDaLista[] }>(
        `/api/clientes?termo=${encodeURIComponent(procurado.trim())}&apenasAtivos=false`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  // Uma vez, ao montar. As buscas seguintes saem do formulário — refazer a
  // consulta a cada tecla digitada faria uma requisição por letra, e o servidor
  // da loja é a mesma máquina que atende o PDV.
  const jaBuscou = useRef(false);

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    void buscar("");
  });

  function voltarParaLista(): void {
    setTela({ fase: "LISTA" });
    void buscar();
    campoBusca.current?.focus();
  }

  if (tela.fase !== "LISTA") {
    return (
      <Formulario
        cliente={tela.fase === "EDITANDO" ? tela.cliente : undefined}
        podeDefinirLimite={pode("cliente:definir_limite")}
        podeEditar={pode("cliente:editar")}
        aoConcluir={voltarParaLista}
        aoCancelar={() => {
          setTela({ fase: "LISTA" });
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">Clientes</h1>
          <p className="text-sm text-tinta-suave">
            Procure antes de cadastrar: o mesmo cliente em dois registros divide o
            histórico de compra.
          </p>
        </div>

        {pode("cliente:cadastrar") && (
          <Botao
            onClick={() => {
              setTela({ fase: "CADASTRANDO" });
            }}
          >
            Novo cliente
          </Botao>
        )}
      </header>

      <form
        onSubmit={(evento: SyntheticEvent) => {
          evento.preventDefault();
          void buscar();
        }}
        className="flex items-end gap-3"
        noValidate
      >
        <div className="flex-1">
          <CampoTexto
            ref={campoBusca}
            rotulo="Procurar por nome"
            autoFocus
            value={termo}
            onChange={(evento) => {
              setTermo(evento.target.value);
            }}
          />
        </div>
        <Botao
          type="submit"
          ocupado={estado.fase === "BUSCANDO"}
          rotuloOcupado="Procurando…"
        >
          Procurar
        </Botao>
      </form>

      {estado.fase === "BUSCANDO" && <Carregando oQue="clientes" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhum cliente encontrado"
          descricao={
            termo.trim() === ""
              ? "Ainda não há clientes cadastrados."
              : `Nada para "${termo.trim()}". Confira a grafia ou cadastre o cliente.`
          }
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-borda text-sm text-tinta-suave">
              <th className="py-2 font-medium">Cliente</th>
              <th className="py-2 font-medium">Documento</th>
              <th className="py-2 font-medium">Limite</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {estado.itens.map((item) => (
              <tr key={item.id} className="border-b border-borda">
                <td className="py-2 text-tinta">
                  {item.exibicao}
                  {!item.ativo && (
                    // Cor não é a única pista: o texto diz "Inativo".
                    <span className="ml-2 rounded-md border border-atencao bg-atencao-suave px-2 py-0.5 text-xs">
                      Inativo
                    </span>
                  )}
                </td>
                <td className="py-2 font-numero text-tinta-suave">
                  {item.documento ?? "—"}
                </td>
                <td className="py-2 font-numero text-tinta">
                  {item.vendeAPrazo ? formatarDinheiro(item.limiteCredito) : "—"}
                </td>
                <td className="py-2 text-right">
                  {pode("cliente:editar") && (
                    <Botao
                      tom="secundario"
                      onClick={() => {
                        setTela({ fase: "EDITANDO", cliente: item });
                      }}
                    >
                      Editar
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface PropsFormulario {
  readonly cliente?: ClienteDaLista | undefined;
  readonly podeDefinirLimite: boolean;
  readonly podeEditar: boolean;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}

function Formulario({
  cliente,
  podeDefinirLimite,
  aoConcluir,
  aoCancelar,
}: PropsFormulario): ReactNode {
  const { cliente: api } = useSessao();
  const editando = cliente !== undefined;

  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [documento, setDocumento] = useState(cliente?.documento ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [limite, setLimite] = useState(centavosParaReais(cliente?.limiteCredito ?? "0"));
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (nome.trim() === "") {
      setErro("Informe o nome do cliente.");
      return;
    }

    const centavos = podeDefinirLimite ? reaisParaCentavos(limite) : undefined;
    if (podeDefinirLimite && centavos === undefined) {
      setErro("Limite de crédito inválido.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    const corpo = {
      nome: nome.trim(),
      ...(documento.trim() === "" ? {} : { documento: documento.trim() }),
      ...(telefone.trim() === "" ? {} : { telefone: telefone.trim() }),
      ...(centavos === undefined ? {} : { limiteCredito: centavos }),
    };

    try {
      if (editando) {
        await api.requisitar(`/api/clientes/${cliente.id}`, {
          metodo: "PUT",
          corpo: { ...corpo, ativo: cliente.ativo },
        });
      } else {
        await api.requisitar("/api/clientes", {
          metodo: "POST",
          // Documento define o tipo: onze dígitos é CPF, catorze é CNPJ. Pedir
          // ao usuário que classifique o que o próprio número já diz é uma
          // pergunta a mais numa tela que já tem muitas.
          corpo: { ...corpo, tipoPessoa: ehCnpj(documento) ? "JURIDICA" : "FISICA" },
        });
      }

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-tinta">
        {editando ? `Editar ${cliente.exibicao}` : "Novo cliente"}
      </h1>

      <form
        onSubmit={(evento) => void salvar(evento)}
        className="flex flex-col gap-4"
        noValidate
      >
        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            {erro}
          </p>
        )}

        <CampoTexto
          rotulo="Nome"
          required
          autoFocus
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="CPF ou CNPJ"
          numerico
          ajuda="Opcional. Só é preciso para nota com destinatário."
          value={documento}
          onChange={(evento) => {
            setDocumento(evento.target.value.replace(/\D/g, "").slice(0, 14));
          }}
        />

        <CampoTexto
          rotulo="Telefone"
          numerico
          value={telefone}
          onChange={(evento) => {
            setTelefone(evento.target.value.replace(/\D/g, "").slice(0, 11));
          }}
        />

        {podeDefinirLimite && (
          <CampoTexto
            rotulo="Limite de crédito"
            numerico
            ajuda="Teto do fiado. Zero significa que não vende a prazo."
            value={limite}
            onChange={(evento) => {
              setLimite(evento.target.value);
            }}
          />
        )}

        <div className="flex gap-3">
          <Botao type="submit" ocupado={salvando} rotuloOcupado="Salvando…">
            Salvar
          </Botao>
          <Botao tom="secundario" type="button" onClick={aoCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

function ehCnpj(documento: string): boolean {
  return documento.replace(/\D/g, "").length > 11;
}

/** `"1990"` → `"19,90"`. */
function centavosParaReais(centavos: string): string {
  const valor = BigInt(centavos);
  return `${(valor / 100n).toString()},${(valor % 100n).toString().padStart(2, "0")}`;
}

/**
 * `"19,90"` → `"1990"`.
 *
 * Como no PDV, número **sem separador é reais**: `"2000"` é R$ 2.000,00. A
 * interpretação inversa daria ao cliente um limite cem vezes menor que o
 * pretendido, e o erro só apareceria quando a venda a prazo fosse recusada no
 * balcão.
 */
function reaisParaCentavos(texto: string): string | undefined {
  const limpo = texto.trim().replace(/\./g, ",");

  if (!/^\d+(,\d{0,2})?$/.test(limpo)) return undefined;

  const [inteiro = "0", decimais = ""] = limpo.split(",");
  return (BigInt(inteiro) * 100n + BigInt(decimais.padEnd(2, "0") || "0")).toString();
}
