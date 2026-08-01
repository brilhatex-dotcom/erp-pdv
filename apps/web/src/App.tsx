import { Botao, Carregando } from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useSessao } from "@erp/cliente-api";
import { BarreiraDeErro } from "./BarreiraDeErro.js";
import { Caixas } from "./telas/Caixas.js";
import { Categorias } from "./telas/Categorias.js";
import { Clientes } from "./telas/Clientes.js";
import { Compras } from "./telas/Compras.js";
import { ConsultarProduto } from "./telas/ConsultarProduto.js";
import { Estoque } from "./telas/Estoque.js";
import { Fornecedores } from "./telas/Fornecedores.js";
import { Login } from "./telas/Login.js";
import { PrimeiroAcesso } from "./telas/PrimeiroAcesso.js";
import { Produtos } from "./telas/Produtos.js";
import { Usuarios } from "./telas/Usuarios.js";

/**
 * Raiz da retaguarda.
 *
 * Enquanto restaura a sessão pelo cookie, mostra "carregando" — e **não** a
 * tela de login. Piscar o login para quem já está autenticado é o defeito
 * clássico de SPA com token em memória: assusta o usuário e o faz digitar a
 * senha sem precisar.
 */
export function App(): ReactNode {
  const { cliente, usuario, restaurando } = useSessao();

  // `undefined` enquanto a pergunta não foi respondida: mostrar o login antes
  // de saber faria a instalação nova piscar uma tela que ninguém consegue usar.
  const [precisaConfiguracao, setPrecisaConfiguracao] = useState<boolean | undefined>(
    undefined,
  );
  const jaPerguntou = useRef(false);

  useEffect(() => {
    if (jaPerguntou.current) return;
    jaPerguntou.current = true;

    void cliente
      // `unknown`, e não `boolean`: o tipo é uma promessa sobre a resposta, e a
      // resposta vem da rede. Declará-la `boolean` faria o compilador garantir
      // algo que ele não pode verificar.
      .requisitar<{ precisaConfiguracao?: unknown }>("/api/instalacao/situacao")
      .then((situacao) => {
        // Resposta sem o campo, ou com ele em outro formato, deixaria o estado
        // indefinido e a tela presa em "carregando" para sempre. Na dúvida,
        // segue para o login — que sabe se recuperar.
        setPrecisaConfiguracao(situacao.precisaConfiguracao === true);
      })
      .catch(() => {
        // Servidor fora do ar na primeira carga. Segue para o login, que tem
        // tratamento de erro próprio — travar aqui deixaria a tela em branco.
        setPrecisaConfiguracao(false);
      });
  });

  if (restaurando || precisaConfiguracao === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Carregando oQue="sua sessão" />
      </main>
    );
  }

  if (usuario === undefined && precisaConfiguracao) {
    return (
      <PrimeiroAcesso
        aoConcluir={() => {
          setPrecisaConfiguracao(false);
        }}
      />
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
  // Separada do cadastro de propósito: aqui se bipa o código e o preço aparece
  // grande, para responder ao cliente que perguntou no balcão. A lista de
  // cadastro responde outra pergunta — "que produtos eu tenho".
  { chave: "CONSULTA", rotulo: "Consulta de preço", permissao: undefined },
  { chave: "ESTOQUE", rotulo: "Estoque", permissao: undefined },
  { chave: "COMPRAS", rotulo: "Compras", permissao: "estoque:entrada" },
  { chave: "CLIENTES", rotulo: "Clientes", permissao: "cliente:consultar" },
  { chave: "FORNECEDORES", rotulo: "Fornecedores", permissao: "fornecedor:consultar" },
  { chave: "CATEGORIAS", rotulo: "Categorias", permissao: "categoria:gerenciar" },
  { chave: "USUARIOS", rotulo: "Usuários", permissao: "usuario:criar" },
  { chave: "CAIXAS", rotulo: "Caixas", permissao: "relatorio:vendas" },
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
        {/*
          A barreira envolve só o conteúdo, e não a página: se uma tela quebra,
          o cabeçalho e a navegação continuam de pé e o usuário troca de seção
          em vez de ficar preso. `key` a reinicia ao mudar de aba — sem isso,
          uma tela que quebrou deixaria a barreira aberta sobre a seguinte.
        */}
        <BarreiraDeErro key={secao}>
          <Conteudo secao={secao} />
        </BarreiraDeErro>
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
    case "USUARIOS":
      return <Usuarios />;
    case "CAIXAS":
      return <Caixas />;
    case "CONSULTA":
      return <ConsultarProduto />;
    case "ESTOQUE":
      return <Estoque />;
    case "COMPRAS":
      return <Compras />;
    default:
      return <Produtos />;
  }
}
