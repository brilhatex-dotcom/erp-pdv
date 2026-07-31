import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

interface FornecedorDaLista {
  readonly id: string;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string;
  readonly exibicao: string;
  readonly documento: string;
  readonly telefone?: string;
  readonly email?: string;
  readonly prazoEntregaDias?: number;
  readonly ativo: boolean;
}

type Fase =
  | { readonly fase: "LISTA" }
  | { readonly fase: "CADASTRANDO" }
  | { readonly fase: "EDITANDO"; readonly fornecedor: FornecedorDaLista };

type EstadoBusca =
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly FornecedorDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Cadastro de fornecedores.
 *
 * Difere do cliente em um ponto que muda a tela inteira: **o documento é
 * obrigatório**. Fornecedor existe para sustentar entrada de mercadoria, e toda
 * entrada chega com uma nota que traz o CNPJ do emitente. Um fornecedor sem
 * documento é um cadastro que não fecha com nota nenhuma, e a divergência só
 * aparece no inventário — quando ninguém lembra de onde veio a mercadoria.
 *
 * Aceita CPF, e não só CNPJ, porque produtor rural e MEI de bairro fornecem
 * como pessoa física: o hortifruti compra do sitiante da região.
 */
export function Fornecedores(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [termo, setTermo] = useState("");
  const [estado, setEstado] = useState<EstadoBusca>({ fase: "BUSCANDO" });
  const [tela, setTela] = useState<Fase>({ fase: "LISTA" });
  const campoBusca = useRef<HTMLInputElement>(null);
  const jaBuscou = useRef(false);

  async function buscar(procurado = termo): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: FornecedorDaLista[] }>(
        `/api/fornecedores?termo=${encodeURIComponent(procurado.trim())}&apenasAtivos=false`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    void buscar("");
  });

  if (tela.fase !== "LISTA") {
    return (
      <Formulario
        fornecedor={tela.fase === "EDITANDO" ? tela.fornecedor : undefined}
        aoConcluir={() => {
          setTela({ fase: "LISTA" });
          void buscar();
          campoBusca.current?.focus();
        }}
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
          <h1 className="text-xl font-semibold text-tinta">Fornecedores</h1>
          <p className="text-sm text-tinta-suave">
            Procure antes de cadastrar: o mesmo fornecedor em dois registros divide o
            histórico de compra do produto.
          </p>
        </div>

        {pode("fornecedor:cadastrar") && (
          <Botao
            onClick={() => {
              setTela({ fase: "CADASTRANDO" });
            }}
          >
            Novo fornecedor
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
            rotulo="Procurar por razão social"
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

      {estado.fase === "BUSCANDO" && <Carregando oQue="fornecedores" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhum fornecedor encontrado"
          descricao={
            termo.trim() === ""
              ? "Ainda não há fornecedores cadastrados."
              : `Nada para "${termo.trim()}". Confira a grafia ou cadastre o fornecedor.`
          }
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-borda text-sm text-tinta-suave">
              <th className="py-2 font-medium">Fornecedor</th>
              <th className="py-2 font-medium">Documento</th>
              <th className="py-2 font-medium">Entrega</th>
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
                <td className="py-2 font-numero text-tinta-suave">{item.documento}</td>
                <td className="py-2 text-tinta-suave">
                  {item.prazoEntregaDias === undefined
                    ? "—"
                    : `${String(item.prazoEntregaDias)} dias`}
                </td>
                <td className="py-2 text-right">
                  {pode("fornecedor:editar") && (
                    <Botao
                      tom="secundario"
                      onClick={() => {
                        setTela({ fase: "EDITANDO", fornecedor: item });
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
  readonly fornecedor?: FornecedorDaLista | undefined;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}

function Formulario({ fornecedor, aoConcluir, aoCancelar }: PropsFormulario): ReactNode {
  const { cliente: api } = useSessao();
  const editando = fornecedor !== undefined;

  const [razaoSocial, setRazaoSocial] = useState(fornecedor?.razaoSocial ?? "");
  const [nomeFantasia, setNomeFantasia] = useState(fornecedor?.nomeFantasia ?? "");
  const [documento, setDocumento] = useState(fornecedor?.documento ?? "");
  const [telefone, setTelefone] = useState(fornecedor?.telefone ?? "");
  const [email, setEmail] = useState(fornecedor?.email ?? "");
  const [prazo, setPrazo] = useState(
    fornecedor?.prazoEntregaDias === undefined ? "" : String(fornecedor.prazoEntregaDias),
  );
  const [ativo, setAtivo] = useState(fornecedor?.ativo ?? true);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (razaoSocial.trim() === "") {
      setErro("Informe a razão social.");
      return;
    }

    // A validação real do dígito verificador é do servidor. Aqui só se confere
    // o tamanho, para não gastar uma ida à rede com um campo obviamente
    // incompleto — e para a mensagem chegar antes de o usuário sair do campo.
    const digitos = documento.replace(/\D/g, "");
    if (digitos.length !== 11 && digitos.length !== 14) {
      setErro("Informe o CPF (11 dígitos) ou o CNPJ (14 dígitos) do fornecedor.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    const corpo = {
      razaoSocial: razaoSocial.trim(),
      documento: digitos,
      ...(nomeFantasia.trim() === "" ? {} : { nomeFantasia: nomeFantasia.trim() }),
      ...(telefone.trim() === "" ? {} : { telefone: telefone.trim() }),
      ...(email.trim() === "" ? {} : { email: email.trim() }),
      ...(prazo.trim() === "" ? {} : { prazoEntregaDias: Number(prazo) }),
    };

    try {
      if (editando) {
        await api.requisitar(`/api/fornecedores/${fornecedor.id}`, {
          metodo: "PUT",
          corpo: { ...corpo, ativo },
        });
      } else {
        await api.requisitar("/api/fornecedores", { metodo: "POST", corpo });
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
        {editando ? `Editar ${fornecedor.exibicao}` : "Novo fornecedor"}
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
          rotulo="Razão social"
          required
          autoFocus
          value={razaoSocial}
          onChange={(evento) => {
            setRazaoSocial(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Nome fantasia"
          ajuda="Como o fornecedor é chamado no dia a dia."
          value={nomeFantasia}
          onChange={(evento) => {
            setNomeFantasia(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="CPF ou CNPJ"
          numerico
          required
          ajuda="Obrigatório: é o que liga o fornecedor à nota de entrada."
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

        <CampoTexto
          rotulo="E-mail"
          type="email"
          value={email}
          onChange={(evento) => {
            setEmail(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Prazo de entrega (dias)"
          numerico
          value={prazo}
          onChange={(evento) => {
            setPrazo(evento.target.value.replace(/\D/g, "").slice(0, 3));
          }}
        />

        {editando && (
          <label className="flex items-center gap-2 text-tinta">
            <input
              type="checkbox"
              checked={ativo}
              className="size-5 accent-acao"
              onChange={(evento) => {
                setAtivo(evento.target.checked);
              }}
            />
            Fornecedor ativo
          </label>
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
