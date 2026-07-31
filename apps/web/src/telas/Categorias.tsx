import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

interface CategoriaDaLista {
  readonly id: string;
  readonly nome: string;
  readonly ativa: boolean;
}

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly CategoriaDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Categorias de produto.
 *
 * ### Sem tela de formulário separada
 *
 * Categoria tem **um campo**. Abrir uma tela para preencher um campo e voltar é
 * três cliques onde cabe um — por isso o cadastro é uma linha acima da lista, e
 * a renomeação acontece na própria linha.
 *
 * ### Desativar, nunca apagar
 *
 * A categoria já está referenciada por produtos e por relatórios de meses
 * passados. Apagá-la deixaria o relatório do trimestre anterior com uma linha
 * órfã, e o dono descobriria isso ao comparar com o ano passado. Desativar tira
 * da lista de escolha e preserva o histórico.
 */
export function Categorias(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const [nova, setNova] = useState("");
  const [erroForm, setErroForm] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | undefined>(undefined);
  const [nomeEditado, setNomeEditado] = useState("");
  const campoNova = useRef<HTMLInputElement>(null);
  const jaCarregou = useRef(false);

  const podeGerenciar = pode("categoria:gerenciar");

  async function carregar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      const resposta = await api.requisitar<{ itens: CategoriaDaLista[] }>(
        "/api/categorias?apenasAtivas=false",
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar();
  });

  async function criar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (nova.trim() === "") {
      setErroForm("Informe o nome da categoria.");
      return;
    }

    setSalvando(true);
    setErroForm(undefined);

    try {
      await api.requisitar("/api/categorias", {
        metodo: "POST",
        corpo: { nome: nova.trim() },
      });

      setNova("");
      await carregar();
      // O foco volta ao campo: quem cadastra uma categoria costuma cadastrar
      // três ou quatro de uma vez, no dia em que monta a loja.
      campoNova.current?.focus();
    } catch (causa) {
      setErroForm(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  async function gravar(
    categoria: CategoriaDaLista,
    mudancas: { readonly nome?: string; readonly ativa?: boolean },
  ): Promise<void> {
    setErroForm(undefined);

    try {
      await api.requisitar(`/api/categorias/${categoria.id}`, {
        metodo: "PUT",
        corpo: {
          nome: mudancas.nome ?? categoria.nome,
          ativa: mudancas.ativa ?? categoria.ativa,
        },
      });

      setEditandoId(undefined);
      await carregar();
    } catch (causa) {
      setErroForm(mensagemDe(causa));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Categorias</h1>
        <p className="text-sm text-tinta-suave">
          Agrupam os produtos no relatório de vendas. Sem subgrupo: uma lista só, fácil de
          manter.
        </p>
      </header>

      {erroForm !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
        >
          {erroForm}
        </p>
      )}

      {podeGerenciar && (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="flex items-end gap-3"
          noValidate
        >
          <div className="flex-1">
            <CampoTexto
              ref={campoNova}
              rotulo="Nova categoria"
              autoFocus
              value={nova}
              onChange={(evento) => {
                setNova(evento.target.value);
              }}
            />
          </div>
          <Botao type="submit" ocupado={salvando} rotuloOcupado="Salvando…">
            Adicionar
          </Botao>
        </form>
      )}

      {estado.fase === "CARREGANDO" && <Carregando oQue="categorias" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhuma categoria"
          descricao="Categorias agrupam os produtos no relatório. Crie a primeira acima."
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <ul className="flex flex-col">
          {estado.itens.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-borda py-2"
            >
              {editandoId === item.id ? (
                <form
                  className="flex flex-1 items-end gap-3"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    void gravar(item, { nome: nomeEditado });
                  }}
                  noValidate
                >
                  <div className="flex-1">
                    <CampoTexto
                      rotulo={`Novo nome de ${item.nome}`}
                      autoFocus
                      value={nomeEditado}
                      onChange={(evento) => {
                        setNomeEditado(evento.target.value);
                      }}
                    />
                  </div>
                  <Botao type="submit">Salvar</Botao>
                  <Botao
                    tom="secundario"
                    type="button"
                    onClick={() => {
                      setEditandoId(undefined);
                    }}
                  >
                    Cancelar
                  </Botao>
                </form>
              ) : (
                <>
                  <span className="text-tinta">
                    {item.nome}
                    {!item.ativa && (
                      <span className="ml-2 rounded-md border border-atencao bg-atencao-suave px-2 py-0.5 text-xs">
                        Inativa
                      </span>
                    )}
                  </span>

                  {podeGerenciar && (
                    <span className="flex gap-2">
                      <Botao
                        tom="secundario"
                        onClick={() => {
                          setEditandoId(item.id);
                          setNomeEditado(item.nome);
                        }}
                      >
                        Renomear
                      </Botao>
                      <Botao
                        tom="secundario"
                        onClick={() => void gravar(item, { ativa: !item.ativa })}
                      >
                        {item.ativa ? "Desativar" : "Reativar"}
                      </Botao>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
