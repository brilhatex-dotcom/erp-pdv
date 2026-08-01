import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

interface UsuarioDaLista {
  readonly id: string;
  readonly matricula: string;
  readonly nome: string;
  readonly papel: string;
  readonly ativo: boolean;
  readonly precisaTrocarCredencial: boolean;
  readonly temPin: boolean;
  readonly temSenha: boolean;
}

/** Os papéis, com o nome que o lojista entende — não o código do sistema. */
const PAPEIS = [
  { codigo: "OPERADOR_CAIXA", rotulo: "Operador de caixa", onde: "Só o PDV" },
  { codigo: "SUPERVISOR", rotulo: "Supervisor", onde: "PDV, com cancelamento e sangria" },
  {
    codigo: "ESTOQUISTA",
    rotulo: "Estoquista",
    onde: "Produtos, estoque e fornecedores",
  },
  { codigo: "FINANCEIRO", rotulo: "Financeiro", onde: "Contas e relatórios" },
  { codigo: "GERENTE", rotulo: "Gerente", onde: "Quase tudo" },
  { codigo: "CONTADOR", rotulo: "Contador", onde: "Somente leitura" },
  { codigo: "ADMIN", rotulo: "Administrador", onde: "Tudo, incluindo usuários" },
] as const;

type Fase =
  | { readonly fase: "LISTA" }
  | { readonly fase: "CADASTRANDO" }
  | { readonly fase: "EDITANDO"; readonly usuario: UsuarioDaLista }
  | { readonly fase: "CREDENCIAL"; readonly usuario: UsuarioDaLista };

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly UsuarioDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

function rotuloDoPapel(codigo: string): string {
  return PAPEIS.find((papel) => papel.codigo === codigo)?.rotulo ?? codigo;
}

/**
 * Gestão de usuários.
 *
 * ### Os papéis aparecem com o nome que o lojista usa
 *
 * "Operador de caixa", não `OPERADOR_CAIXA`; e cada um vem com uma linha
 * dizendo o que ele alcança. Sem isso, quem cadastra escolhe pelo nome que soa
 * mais importante — e é assim que todo mundo na loja vira gerente.
 *
 * ### Desativar, nunca apagar
 *
 * O usuário está referenciado por vendas, sangrias e conferências de meses
 * passados. Apagá-lo deixaria a auditoria com registros órfãos, justamente onde
 * ela existe para responder "quem fez isso?".
 */
export function Usuarios(): ReactNode {
  const { cliente, usuario: eu } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const [tela, setTela] = useState<Fase>({ fase: "LISTA" });
  const jaCarregou = useRef(false);

  async function carregar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      const resposta = await cliente.requisitar<{ itens: UsuarioDaLista[] }>(
        "/api/usuarios",
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

  function voltar(): void {
    setTela({ fase: "LISTA" });
    void carregar();
  }

  if (tela.fase === "CADASTRANDO" || tela.fase === "EDITANDO") {
    return (
      <Formulario
        usuario={tela.fase === "EDITANDO" ? tela.usuario : undefined}
        aoConcluir={voltar}
        aoCancelar={() => {
          setTela({ fase: "LISTA" });
        }}
      />
    );
  }

  if (tela.fase === "CREDENCIAL") {
    return (
      <TrocaDeCredencial
        usuario={tela.usuario}
        aoConcluir={voltar}
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
          <h1 className="text-xl font-semibold text-tinta">Usuários</h1>
          <p className="text-sm text-tinta-suave">
            Cada pessoa com a própria matrícula: é o que faz a venda e a sangria ficarem
            no nome de quem as fez.
          </p>
        </div>

        <Botao
          onClick={() => {
            setTela({ fase: "CADASTRANDO" });
          }}
        >
          Novo usuário
        </Botao>
      </header>

      {estado.fase === "CARREGANDO" && <Carregando oQue="usuários" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio titulo="Nenhum usuário" descricao="Crie o primeiro acima." />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-borda text-sm text-tinta-suave">
              <th className="py-2 font-medium">Matrícula</th>
              <th className="py-2 font-medium">Nome</th>
              <th className="py-2 font-medium">Papel</th>
              <th className="py-2 font-medium">Acesso</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {estado.itens.map((item) => (
              <tr key={item.id} className="border-b border-borda">
                <td className="py-2 font-numero text-tinta">{item.matricula}</td>
                <td className="py-2 text-tinta">
                  {item.nome}
                  {item.id === eu?.id && (
                    <span className="ml-2 text-xs text-tinta-suave">(você)</span>
                  )}
                </td>
                <td className="py-2 text-tinta-suave">{rotuloDoPapel(item.papel)}</td>
                <td className="py-2 text-sm text-tinta-suave">
                  {!item.ativo && (
                    // Cor não é a única pista: o texto diz "Inativo".
                    <span className="rounded-md border border-atencao bg-atencao-suave px-2 py-0.5">
                      Inativo
                    </span>
                  )}
                  {item.ativo && item.precisaTrocarCredencial && (
                    <span className="text-tinta-suave">Troca pendente</span>
                  )}
                  {item.ativo && !item.precisaTrocarCredencial && (
                    <span>
                      {item.temPin && item.temSenha
                        ? "PIN e senha"
                        : item.temPin
                          ? "Só PIN"
                          : "Só senha"}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  <span className="flex justify-end gap-2">
                    <Botao
                      tom="secundario"
                      onClick={() => {
                        setTela({ fase: "CREDENCIAL", usuario: item });
                      }}
                    >
                      Credencial
                    </Botao>
                    <Botao
                      tom="secundario"
                      onClick={() => {
                        setTela({ fase: "EDITANDO", usuario: item });
                      }}
                    >
                      Editar
                    </Botao>
                  </span>
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
  readonly usuario?: UsuarioDaLista | undefined;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}

function Formulario({ usuario, aoConcluir, aoCancelar }: PropsFormulario): ReactNode {
  const { cliente } = useSessao();
  const editando = usuario !== undefined;

  const [matricula, setMatricula] = useState(usuario?.matricula ?? "");
  const [nome, setNome] = useState(usuario?.nome ?? "");
  const [papel, setPapel] = useState<string>(usuario?.papel ?? "OPERADOR_CAIXA");
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [pin, setPin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (nome.trim() === "") {
      setErro("Informe o nome.");
      return;
    }

    if (!editando && pin === "" && senha === "") {
      setErro("Informe o PIN do balcão, a senha da retaguarda, ou os dois.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    try {
      if (editando) {
        await cliente.requisitar(`/api/usuarios/${usuario.id}`, {
          metodo: "PUT",
          corpo: { nome: nome.trim(), papel, ativo },
        });
      } else {
        await cliente.requisitar("/api/usuarios", {
          metodo: "POST",
          corpo: {
            matricula: matricula.trim(),
            nome: nome.trim(),
            papel,
            ...(pin === "" ? {} : { pin }),
            ...(senha === "" ? {} : { senha }),
          },
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
        {editando ? `Editar ${usuario.nome}` : "Novo usuário"}
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

        {!editando && (
          <CampoTexto
            rotulo="Matrícula"
            numerico
            required
            autoFocus
            ajuda="O número que a pessoa digita para entrar. Não muda depois."
            value={matricula}
            onChange={(evento) => {
              setMatricula(evento.target.value.replace(/\D/g, "").slice(0, 6));
            }}
          />
        )}

        <CampoTexto
          rotulo="Nome"
          required
          autoFocus={editando}
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
          }}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-tinta">Papel</legend>
          {PAPEIS.map((opcao) => (
            <label key={opcao.codigo} className="flex items-start gap-2 text-tinta">
              <input
                type="radio"
                name="papel"
                className="mt-1 accent-acao"
                checked={papel === opcao.codigo}
                onChange={() => {
                  setPapel(opcao.codigo);
                }}
              />
              <span>
                {opcao.rotulo}
                {/* O alcance de cada papel, em uma linha: sem isso, escolhe-se
                    pelo nome que soa mais importante. */}
                <span className="block text-sm text-tinta-suave">{opcao.onde}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {!editando && (
          <>
            <CampoTexto
              rotulo="PIN do balcão"
              type="password"
              numerico
              ajuda="6 dígitos. Só para quem opera caixa."
              value={pin}
              onChange={(evento) => {
                setPin(evento.target.value.replace(/\D/g, "").slice(0, 6));
              }}
            />

            <CampoTexto
              rotulo="Senha da retaguarda"
              type="password"
              autoComplete="new-password"
              ajuda="Ao menos 12 caracteres. Só para quem usa a retaguarda."
              value={senha}
              onChange={(evento) => {
                setSenha(evento.target.value);
              }}
            />

            <p className="text-sm text-tinta-suave">
              A pessoa será obrigada a trocar no primeiro acesso — você acabou de digitar
              esta credencial e a conhece.
            </p>
          </>
        )}

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
            Acesso ativo
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

interface PropsCredencial {
  readonly usuario: UsuarioDaLista;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}

/**
 * Repõe PIN ou senha de outra pessoa.
 *
 * O chamado mais comum do módulo: "esqueci o PIN e agora não entro". Repor
 * destrava quem ficou bloqueado por tentativas — senão o administrador repõe a
 * credencial e o operador continua preso.
 */
function TrocaDeCredencial({
  usuario,
  aoConcluir,
  aoCancelar,
}: PropsCredencial): ReactNode {
  const { cliente } = useSessao();
  const [pin, setPin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (pin === "" && senha === "") {
      setErro("Informe o PIN, a senha, ou os dois.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    try {
      await cliente.requisitar(`/api/usuarios/${usuario.id}/credencial`, {
        metodo: "PUT",
        corpo: {
          ...(pin === "" ? {} : { pin }),
          ...(senha === "" ? {} : { senha }),
        },
      });

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-tinta">Credencial de {usuario.nome}</h1>

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
          rotulo="Novo PIN do balcão"
          type="password"
          numerico
          autoFocus
          ajuda="6 dígitos. Deixe em branco para não mexer."
          value={pin}
          onChange={(evento) => {
            setPin(evento.target.value.replace(/\D/g, "").slice(0, 6));
          }}
        />

        <CampoTexto
          rotulo="Nova senha da retaguarda"
          type="password"
          autoComplete="new-password"
          ajuda="Ao menos 12 caracteres. Deixe em branco para não mexer."
          value={senha}
          onChange={(evento) => {
            setSenha(evento.target.value);
          }}
        />

        <p className="text-sm text-tinta-suave">
          A pessoa será obrigada a trocar no primeiro acesso, e um bloqueio por tentativas
          erradas é liberado junto.
        </p>

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
