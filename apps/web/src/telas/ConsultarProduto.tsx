import {
  Botao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  Vazio,
} from "@erp/ui";
import { type SyntheticEvent, type ReactNode, useRef, useState } from "react";

import { ErroDaApi, mensagemDe } from "@erp/cliente-api";
import { useSessao } from "@erp/cliente-api";

interface ProdutoEncontrado {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv: string;
  readonly tipo: "UNITARIO" | "PESAVEL";
  readonly unidade: string;
  /** Centavos em texto — a API nunca manda dinheiro como número. */
  readonly precoVenda: string;
  /** Só chega para quem tem `produto:ver_custo`. */
  readonly custo?: string;
  readonly ativo: boolean;
}

type Estado =
  | { readonly fase: "OCIOSO" }
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "ACHOU"; readonly produto: ProdutoEncontrado }
  | { readonly fase: "NAO_ACHOU"; readonly codigo: string }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Consulta de produto por código.
 *
 * É a tela que prova a corrente inteira funcionando: campo → API → autorização
 * no servidor → banco → tela. E é o fluxo mais usado da retaguarda, porque
 * "quanto custa isso?" é a pergunta que o balcão faz o dia todo.
 *
 * O estado é uma **união discriminada**, não três booleanos soltos. Com
 * `carregando`, `erro` e `produto` independentes, existe o estado impossível
 * "carregando e com erro ao mesmo tempo" — e é exatamente ele que aparece na
 * tela do cliente como um spinner eterno sobre uma mensagem de falha.
 */
export function ConsultarProduto(): ReactNode {
  const { cliente, pode } = useSessao();
  const [codigo, setCodigo] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "OCIOSO" });
  const campo = useRef<HTMLInputElement>(null);

  async function buscar(evento?: SyntheticEvent): Promise<void> {
    evento?.preventDefault();

    const procurado = codigo.trim();
    if (procurado === "") return;

    setEstado({ fase: "BUSCANDO" });

    try {
      const produto = await cliente.requisitar<ProdutoEncontrado>(
        `/api/produtos/buscar?codigo=${encodeURIComponent(procurado)}`,
      );
      setEstado({ fase: "ACHOU", produto });
    } catch (causa) {
      // 404 não é falha: é resposta. Tratá-lo como erro faria a tela mostrar
      // "tentar de novo" para um código que simplesmente não existe.
      if (causa instanceof ErroDaApi && causa.status === 404) {
        setEstado({ fase: "NAO_ACHOU", codigo: procurado });
      } else {
        setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
      }
    } finally {
      // O foco volta ao campo para a próxima consulta, sem tocar no mouse.
      campo.current?.select();
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Consultar produto</h1>
        <p className="text-sm text-tinta-suave">
          Bipe o código de barras ou digite o código, o SKU ou a referência.
        </p>
      </header>

      <form
        onSubmit={(evento) => void buscar(evento)}
        className="flex items-end gap-3"
        noValidate
      >
        <div className="flex-1">
          <CampoTexto
            ref={campo}
            rotulo="Código do produto"
            autoFocus
            value={codigo}
            onChange={(evento) => {
              setCodigo(evento.target.value);
            }}
          />
        </div>
        <Botao
          type="submit"
          ocupado={estado.fase === "BUSCANDO"}
          rotuloOcupado="Buscando…"
        >
          Buscar
        </Botao>
      </form>

      {estado.fase === "BUSCANDO" && <Carregando oQue="produto" />}

      {estado.fase === "NAO_ACHOU" && (
        <Vazio
          titulo="Produto não encontrado"
          descricao={`Nenhum produto com o código ${estado.codigo}. Confira o código ou cadastre o produto.`}
        />
      )}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "ACHOU" && (
        <FichaDoProduto
          produto={estado.produto}
          mostrarCusto={pode("produto:ver_custo")}
        />
      )}
    </section>
  );
}

interface PropsFicha {
  readonly produto: ProdutoEncontrado;
  readonly mostrarCusto: boolean;
}

function FichaDoProduto({ produto, mostrarCusto }: PropsFicha): ReactNode {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-borda bg-papel p-5 shadow-cartao">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-tinta">{produto.descricao}</h2>
          <p className="text-sm text-tinta-suave">
            {produto.sku} · {produto.tipo === "PESAVEL" ? "Pesável" : "Unitário"} ·{" "}
            {produto.unidade}
          </p>
        </div>

        {!produto.ativo && (
          // Cor não é a única pista: o texto diz "Inativo".
          <span className="rounded-md border border-atencao bg-atencao-suave px-2 py-1 text-sm font-medium text-tinta">
            Inativo
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <Valor
          rotulo="Preço de venda"
          valor={formatarDinheiro(produto.precoVenda)}
          destaque
        />
        {/*
          O custo só aparece se o servidor o enviou. A checagem de permissão
          aqui apenas evita mostrar um campo vazio — quem decide é o servidor,
          que simplesmente não coloca o campo na resposta.
        */}
        {mostrarCusto && produto.custo !== undefined && (
          <Valor rotulo="Custo" valor={formatarDinheiro(produto.custo)} />
        )}
      </dl>
    </article>
  );
}

function Valor({
  rotulo,
  valor,
  destaque = false,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly destaque?: boolean;
}): ReactNode {
  return (
    <div>
      <dt className="text-sm text-tinta-suave">{rotulo}</dt>
      {/* `font-numero` alinha os dígitos: desalinhamento em coluna de dinheiro
          é onde o olho erra. */}
      <dd
        className={
          destaque
            ? "font-numero text-2xl font-semibold text-tinta"
            : "font-numero text-lg text-tinta"
        }
      >
        {valor}
      </dd>
    </div>
  );
}
