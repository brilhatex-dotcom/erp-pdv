import { Botao, Carregando } from "@erp/ui";
import { type ReactNode, useState } from "react";

import { useSessao } from "@erp/cliente-api";
import { Categorias } from "./telas/Categorias.js";
import { Clientes } from "./telas/Clientes.js";
import { Fornecedores } from "./telas/Fornecedores.js";
import { ConsultarProduto } from "./telas/ConsultarProduto.js";
import { Login } from "./telas/Login.js";

/**
 * Raiz da retaguarda.
 *
 * Enquanto restaura a sessão pelo cookie, mostra "carregando" — e **não** a
 * tela de login. Piscar o login para quem já está autenticado é o defeito
 * clássico de SPA com token em memória: assusta o usuário e o faz digitar a
 * senha sem precisar.
 */
export function App(): ReactNode {
  const { usuario, restaurando } = useSessao();

  if (restaurando) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Carregando oQue="sua sessão" />
      </main>
    );
  }

  if (usuario === undefined) return <Login />;

  return <Retaguarda />;
}

/**
 * Telas da retaguarda.
 *
 * Cada seção declara a permissão que a habilita. Mostrar uma aba que só
 * responde "sem permissão" ao ser clicada é pior do que escondê-la: o usuário
 * tenta, falha e abre chamado perguntando o que está quebrado.
 *
 * `undefined` significa "basta estar autenticado".
 */
const SECOES = [
  { chave: "PRODUTOS", rotulo: "Produtos", permissao: undefined },
  { chave: "CLIENTES", rotulo: "Clientes", permissao: "cliente:consultar" },
  { chave: "FORNECEDORES", rotulo: "Fornecedores", permissao: "fornecedor:consultar" },
  { chave: "CATEGORIAS", rotulo: "Categorias", permissao: "categoria:gerenciar" },
] as const;

type Secao = (typeof SECOES)[number]["chave"];

function Retaguarda(): ReactNode {
  const { usuario, sair, pode } = useSessao();
  const [secao, setSecao] = useState<Secao>("PRODUTOS");

  const visiveis = SECOES.filter(
    (atual) => atual.permissao === undefined || pode(atual.permissao),
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-borda bg-papel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-2" aria-label="Seções da retaguarda">
            {visiveis.map((atual) => (
              <Botao
                key={atual.chave}
                tom={secao === atual.chave ? "primario" : "secundario"}
                aria-current={secao === atual.chave ? "page" : undefined}
                onClick={() => {
                  setSecao(atual.chave);
                }}
              >
                {atual.rotulo}
              </Botao>
            ))}
          </nav>

          <div className="flex items-center gap-3 text-sm text-tinta-suave">
            <span>
              {usuario?.nome} · {usuario?.papel}
            </span>
            <Botao tom="secundario" onClick={() => void sair()}>
              Sair
            </Botao>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Conteudo secao={secao} />
      </main>
    </div>
  );
}

function Conteudo({ secao }: { readonly secao: Secao }): ReactNode {
  switch (secao) {
    case "CLIENTES":
      return <Clientes />;
    case "FORNECEDORES":
      return <Fornecedores />;
    case "CATEGORIAS":
      return <Categorias />;
    default:
      return <ConsultarProduto />;
  }
}
