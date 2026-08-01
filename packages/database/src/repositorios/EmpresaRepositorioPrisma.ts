import type { EmpresaRepository } from "@erp/application";
import {
  CNPJ,
  ehRegimeTributario,
  Empresa,
  Endereco,
  type RegimeTributario,
} from "@erp/domain";

import {
  emailDeColuna,
  inscricaoDeColuna,
  telefoneDeColuna,
} from "../mapeadores/cadastroMapeador.js";
import { paraId } from "../mapeadores/comuns.js";
import type { Prisma, PrismaClient } from "../gerado/index.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * A empresa da instalação, em disco.
 *
 * ### `porUnica`, não `porId`
 *
 * Nenhum caminho do sistema conhece o identificador da empresa — só existe uma
 * (ADR-0024). Expor busca por id obrigaria toda tela a descobri-lo antes, e a
 * primeira que errasse leria o cadastro de outro lugar.
 *
 * ### O endereço é obrigatório aqui, e opcional nos outros cadastros
 *
 * `enderecoDeColunas` devolve `undefined` quando as colunas estão vazias, o que
 * serve a cliente e fornecedor. Para a empresa, colunas vazias significam linha
 * corrompida: o schema as declara `NOT NULL`. Reconstruir com endereço ausente
 * esconderia o defeito até o dia da primeira emissão.
 */
export class EmpresaRepositorioPrisma implements EmpresaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async atual(): Promise<Empresa | undefined> {
    const linha = await this.prisma.empresa.findUnique({ where: { unica: true } });

    return linha === null ? undefined : paraEmpresa(linha);
  }

  async salvar(empresa: Empresa): Promise<void> {
    // Sem `enderecoParaColunas`: aquele mapeador devolve `null` porque serve a
    // cliente e fornecedor, onde o endereço é opcional. Aqui ele é obrigatório
    // no agregado e `NOT NULL` no schema, então ler direto do objeto de valor
    // dispensa oito fallbacks que nunca acontecem — e que esconderiam um
    // endereço meio gravado se um dia acontecessem.
    const { endereco } = empresa;

    const dados = {
      razaoSocial: empresa.razaoSocial,
      nomeFantasia: empresa.nomeFantasia ?? null,
      razaoSocialBusca: empresa.razaoSocialBusca,
      cnpj: empresa.cnpj.caracteres,
      inscricaoEstadual: empresa.inscricaoEstadual?.valor ?? null,
      inscricaoMunicipal: empresa.inscricaoMunicipal ?? null,
      regimeTributario: empresa.regimeTributario,
      telefone: empresa.telefone?.digitos ?? null,
      email: empresa.email?.valor ?? null,
      logradouro: endereco.logradouro,
      numero: endereco.numero,
      complemento: endereco.complemento ?? null,
      bairro: endereco.bairro,
      municipio: endereco.municipio,
      codigoMunicipioIbge: endereco.codigoMunicipioIbge ?? null,
      uf: endereco.uf,
      cep: endereco.cep,
    };

    // `where` pelo `unica`, e não pelo id: o segundo cadastro de uma instalação
    // deve **atualizar** o que existe, não criar uma linha que o índice único
    // recusaria com erro de banco na cara do lojista.
    await this.prisma.empresa.upsert({
      where: { unica: true },
      create: { id: empresa.id.valor, unica: true, ...dados },
      update: dados,
    });
  }
}

interface LinhaEmpresa {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  regimeTributario: string;
  telefone: string | null;
  email: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  codigoMunicipioIbge: string | null;
  uf: string;
  cep: string;
}

function paraEmpresa(linha: LinhaEmpresa): Empresa {
  return Empresa.reconstituir({
    id: paraId(linha.id),
    razaoSocial: linha.razaoSocial,
    nomeFantasia: linha.nomeFantasia ?? undefined,
    cnpj: CNPJ.criar(linha.cnpj).unwrap(),
    inscricaoEstadual: inscricaoDeColuna(linha.inscricaoEstadual),
    inscricaoMunicipal: linha.inscricaoMunicipal ?? undefined,
    regimeTributario: regimeDeColuna(linha.regimeTributario),
    endereco: Endereco.criar({
      logradouro: linha.logradouro,
      numero: linha.numero,
      complemento: linha.complemento ?? undefined,
      bairro: linha.bairro,
      municipio: linha.municipio,
      codigoMunicipioIbge: linha.codigoMunicipioIbge ?? undefined,
      uf: linha.uf,
      cep: linha.cep,
    }).unwrap(),
    telefone: telefoneDeColuna(linha.telefone),
    email: emailDeColuna(linha.email),
  });
}

/**
 * Traduz a coluna de texto para o regime.
 *
 * Valor desconhecido cai em `REGIME_NORMAL` em vez de estourar: é o regime que
 * calcula imposto cheio, então errar para esse lado cobra a mais e aparece na
 * conferência — enquanto errar para o Simples cobraria a menos e só apareceria
 * na fiscalização.
 */
function regimeDeColuna(valor: string): RegimeTributario {
  return ehRegimeTributario(valor) ? valor : "REGIME_NORMAL";
}
