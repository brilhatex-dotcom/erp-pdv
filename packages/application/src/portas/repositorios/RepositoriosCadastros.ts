import type {
  Categoria,
  Cliente,
  Documento,
  Empresa,
  Fornecedor,
  Identificador,
} from "@erp/domain";

/**
 * Portas dos cadastros de apoio: categoria, cliente e fornecedor.
 *
 * Como nas demais, os métodos falam de **negócio**: `porDocumento` existe
 * porque cadastrar o mesmo CNPJ duas vezes é o defeito clássico deste módulo —
 * o comprador não acha o fornecedor, cadastra de novo, e o histórico de compra
 * do produto passa a estar dividido entre dois registros que ninguém consegue
 * juntar depois.
 */

import type { FiltroBusca } from "./FiltroBusca.js";

export type { FiltroBusca };

/**
 * A empresa da instalação.
 *
 * Sem `porId`: nenhum caminho do sistema conhece o identificador dela, porque
 * só existe uma (ADR-0024). Expor busca por id obrigaria toda tela a
 * descobri-lo antes, e a primeira que errasse leria o cadastro de outro lugar.
 */
export interface EmpresaRepository {
  atual(): Promise<Empresa | undefined>;
  salvar(empresa: Empresa): Promise<void>;
}

export interface CategoriaRepository {
  porId(id: Identificador): Promise<Categoria | undefined>;

  /**
   * Busca pelo nome **normalizado**, não pelo texto digitado.
   *
   * É o que impede "Bebidas" e "bebidas " de virarem duas categorias — que na
   * tela parecem a mesma e no relatório dividem o faturamento em duas linhas.
   */
  porNome(nome: string): Promise<Categoria | undefined>;

  listar(apenasAtivas: boolean): Promise<readonly Categoria[]>;

  salvar(categoria: Categoria): Promise<void>;
}

export interface ClienteRepository {
  porId(id: Identificador): Promise<Cliente | undefined>;
  porDocumento(documento: Documento): Promise<Cliente | undefined>;
  buscar(filtro: FiltroBusca): Promise<readonly Cliente[]>;
  salvar(cliente: Cliente): Promise<void>;
}

export interface FornecedorRepository {
  porId(id: Identificador): Promise<Fornecedor | undefined>;
  porDocumento(documento: Documento): Promise<Fornecedor | undefined>;
  buscar(filtro: FiltroBusca): Promise<readonly Fornecedor[]>;
  salvar(fornecedor: Fornecedor): Promise<void>;
}
