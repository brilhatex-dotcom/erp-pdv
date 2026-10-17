import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

import { EnviarImagem } from "../componentes/EnviarImagem.js";

interface CategoriaDaLista {
  readonly id: string;
  readonly nome: string;
  readonly ativa: boolean;
  /** A figura do botão do caixa, quando não há foto. */
  readonly icone?: string;
  readonly imagemId?: string;
}

/** O estado completo que a alteração grava: o que não vier, sai. */
interface CategoriaGravada {
  readonly nome: string;
  readonly ativa: boolean;
  readonly icone: string | undefined;
  readonly imagemId: string | undefined;
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
 * Categoria tem **um campo** obrigatório. Abrir uma tela para preencher um
 * campo e voltar é três cliques onde cabe um — por isso o cadastro é uma linha
 * acima da lista, e a edição (nome, ícone e foto do botão do caixa) acontece na
 * própria linha.
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
  const [iconeEditado, setIconeEditado] = useState("");
  const [imagemEditada, setImagemEditada] = useState<string | undefined>(undefined);
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
    gravada: CategoriaGravada,
  ): Promise<void> {
    setErroForm(undefined);

    try {
      await api.requisitar(`/api/categorias/${categoria.id}`, {
        metodo: "PUT",
        corpo: {
          nome: gravada.nome,
          ativa: gravada.ativa,
          ...(gravada.icone === undefined ? {} : { icone: gravada.icone }),
          ...(gravada.imagemId === undefined ? {} : { imagemId: gravada.imagemId }),
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
                  className="flex flex-1 flex-col gap-3"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    const icone = iconeEditado.trim();
                    void gravar(item, {
                      nome: nomeEditado,
                      ativa: item.ativa,
                      icone: icone === "" ? undefined : icone,
                      imagemId: imagemEditada,
                    });
                  }}
                  noValidate
                >
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <CampoTexto
                      rotulo={`Novo nome de ${item.nome}`}
                      autoFocus
                      value={nomeEditado}
                      onChange={(evento) => {
                        setNomeEditado(evento.target.value);
                      }}
                    />
                    <CampoTexto
                      rotulo="Ícone no caixa"
                      ajuda="Um emoji: 🍞 🥤 🍎"
                      value={iconeEditado}
                      onChange={(evento) => {
                        setIconeEditado(evento.target.value);
                      }}
                    />
                  </div>
                  <EnviarImagem
                    rotulo="Foto no caixa"
                    imagemId={imagemEditada}
                    aoMudar={setImagemEditada}
                  />
                  <div className="flex gap-3">
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
                  </div>
                </form>
              ) : (
                <>
                  <span className="flex items-center gap-2 text-tinta">
                    {item.imagemId !== undefined ? (
                      <img
                        src={`/api/imagens/${item.imagemId}`}
                        alt=""
                        className="size-8 rounded object-cover"
                      />
                    ) : (
                      item.icone !== undefined && (
                        <span aria-hidden="true" className="text-xl">
                          {item.icone}
                        </span>
                      )
                    )}
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
                          setIconeEditado(item.icone ?? "");
                          setImagemEditada(item.imagemId);
                        }}
                      >
                        Editar
                      </Botao>
                      <Botao
                        tom="secundario"
                        onClick={() =>
                          void gravar(item, {
                            nome: item.nome,
                            ativa: !item.ativa,
                            icone: item.icone,
                            imagemId: item.imagemId,
                          })
                        }
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
