// Regressão da lógica do front-end, sem navegador. Roda no CI depois do node --check.
// Uso: node scripts/test_front.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../", import.meta.url);
const ler = (caminho) => readFileSync(new URL(caminho, raiz), "utf8");

// O app só usa document no carregamento (DOMContentLoaded) e dentro das funções de tela.
globalThis.document = { addEventListener() {} };
vm.runInThisContext(
  `${ler("assets/app.js")}
globalThis.__app = { S, analisarBase, analisarItem, ncmDeCelula, chaveEscolha, lembrarEscolha, reaplicarEscolhas, agruparPorCodigo, linhaTabela, gruposHtml, resumoGrupo, impressaoProdutos, registroFiltrado, celulaCsv, descompactarZip, cabecalhoProduto, gruposExport, nomeArquivo, escolherGrupo };`,
  { filename: "app.js" }
);

const { S, analisarBase, analisarItem, ncmDeCelula, chaveEscolha, lembrarEscolha, reaplicarEscolhas, agruparPorCodigo, linhaTabela, gruposHtml, resumoGrupo, impressaoProdutos, registroFiltrado, celulaCsv, descompactarZip, cabecalhoProduto, gruposExport, nomeArquivo, escolherGrupo } = globalThis.__app;
S.cat = JSON.parse(ler("data/cst-cclasstrib.json"));
S.regras = JSON.parse(ler("data/ncm-regras.json"));

let falhas = 0;
function checar(cond, msg) {
  console.log(`${cond ? "  ok  " : "  FALHA  "} ${msg}`);
  if (!cond) falhas++;
}

const item = (extra = {}) => ({ ncm: "", cst: "", cc: "", semGrupo: false, valores: {}, ...extra });
const analisar = (ncm, cst, cc) => analisarBase(item({ ncm, cst, cc }));

console.log("Regra por NCM");
checar(analisar("19030000", "200", "200003").status === "ok", "19030000 com 200/200003 é conforme");
checar(analisar("19030000", "000", "200003").status === "div", "CST 000 não serve para cClassTrib 200003");
checar(analisar("19030000", "200", "000001").status === "div", "cClassTrib 000001 não serve para 19030000");
checar(analisar("99999999", "000", "000001").status === "sem-regra", "NCM sem anexo + 000001 é integral confirmada");
checar(analisar("", "", "").status === "invalido", "NCM ausente é inválido");

console.log("NCM de planilha numérica");
checar(ncmDeCelula(1903) === "1903", "NCM de 4 dígitos numérico não ganha zeros à esquerda");
checar(ncmDeCelula(190300) === "190300", "NCM de 6 dígitos numérico também fica como está");
checar(ncmDeCelula(2013000) === "02013000", "NCM de 8 dígitos sem o zero à esquerda é completado");
checar(ncmDeCelula(19030000) === "19030000", "NCM de 8 dígitos numérico fica igual");
checar(ncmDeCelula("01903000") === "01903000", "NCM em texto continua igual");
checar(
  analisar(ncmDeCelula(1903), "200", "200003").status === "ok",
  "NCM 1903 numérico acha a regra da posição"
);

console.log("Escolhas manuais");
S.escolhas.clear();
const itemManual = {
  origem: "nota.xml", nota: "10", item: "1", ncm: "02102000",
  cst: "000", cc: "000001", semGrupo: false, valores: {},
};
const auto = analisarItem(itemManual);
checar(auto.status === "revisar" && auto.esperados.length === 3, "item com 3 possibilidades começa em revisar");
itemManual.escolha = "200003";
lembrarEscolha(itemManual);
const relido = { ...itemManual };
delete relido.escolha;
reaplicarEscolhas([relido]);
checar(relido.escolha === "200003", "escolha manual volta ao item relido");
const aplicada = analisarItem(relido);
checar(aplicada.manual === true && aplicada.principal.cc === "200003", "escolha restaurada é aplicada à análise");
checar(aplicada.status === "div", "escolha 200003 com 000/000001 continua divergente");
const outroNcm = { ...itemManual, ncm: "19030000" };
delete outroNcm.escolha;
reaplicarEscolhas([outroNcm]);
checar(outroNcm.escolha === undefined, "a escolha não vaza para outro NCM");
delete relido.escolha;
lembrarEscolha(relido);
checar(!S.escolhas.has(chaveEscolha(relido)), "voltar à sugestão apaga a escolha guardada");
const unico = analisarItem(item({ ncm: "02013000", cst: "000", cc: "000001", escolha: "200003" }));
checar(
  unico.manual === true && unico.principal.cc === "200003",
  "escolha também vale quando o NCM tem uma única possibilidade"
);

console.log("Agrupamento por código do produto");
const registros = [
  { codProd: "1", ncm: "02013000", emitente: "FORNECEDOR A", analise: { status: "ok" } },
  { codProd: "1", ncm: "02013000", emitente: "FORNECEDOR A", analise: { status: "div" } },
  { codProd: "1", ncm: "34022000", emitente: "FORNECEDOR B", analise: { status: "ok" } },
  { codProd: "", ncm: "10011100", emitente: "", analise: { status: "ok" } },
  { codProd: "", ncm: "10011100", emitente: "", analise: { status: "ok" } },
];
const grupos = agruparPorCodigo(registros);
checar(grupos.length === 3, `código repetido em emitentes diferentes não se mistura (${grupos.length} grupos)`);
checar(grupos.filter((g) => g.itens.length === 2).length === 2, "mesmo emitente e mesmo NCM ficam no mesmo grupo");
checar(
  grupos.find((g) => g.codigo === "1" && g.emitente === "FORNECEDOR A").status === "div",
  "o grupo assume a pior situação"
);

console.log("Visão por código do produto");
const itemGrupo = {
  origem: "nota.xml", nota: "10", item: "1", codProd: "2", ncm: "02013000",
  desc: "COSTELA BOVINA", emitente: "FORNECEDOR A",
  analise: {
    status: "div", declCst: "000", declCc: "000001",
    esperados: [{ cst: "200", cc: "200003" }], principal: { cst: "200", cc: "200003" },
  },
};
const grupo = {
  chave: "fornecedor a|c:2", codigo: "2", emitente: "FORNECEDOR A", porNcm: false, status: "div", itens: [itemGrupo],
};
const htmlGrupo = gruposHtml([grupo], false);
checar((htmlGrupo.match(/<tr class="grupo-produto">/g) || []).length === 1, "cada código vira uma única linha");
checar(!htmlGrupo.includes("data-i="), "a linha do código não traz os itens embaixo");
checar(htmlGrupo.includes("código 2"), "a linha mostra o código");
checar(htmlGrupo.includes("000/000001") && htmlGrupo.includes("200/200003"), "a linha mostra o declarado e o correto");
checar(htmlGrupo.includes("Divergente"), "a linha mostra a situação do grupo");
checar(
  !htmlGrupo.includes("data-grupo="),
  "o grupo divergente não mostra o seletor de CST/cClassTrib"
);
checar(linhaTabela(itemGrupo, 0).includes("cód. 2"), "a visão de todos os itens continua mostrando o código");
checar(
  !linhaTabela(itemGrupo, 0).includes("data-escolha="),
  "o item divergente não mostra o seletor"
);
const analiseRevisar = analisarItem(item({ ncm: "02102000", cst: "000", cc: "000001" }));
checar(
  linhaTabela({ ...itemGrupo, ncm: "02102000", analise: analiseRevisar }, 0).includes("data-escolha="),
  "o item em revisar mostra o seletor"
);
const analiseOkMulti = analisarItem(item({ ncm: "02102000", cst: "200", cc: "200003" }));
checar(
  analiseOkMulti.status === "ok" && analiseOkMulti.esperados.length === 3 &&
    !linhaTabela({ ...itemGrupo, ncm: "02102000", analise: analiseOkMulti }, 0).includes("data-escolha="),
  "item conforme com várias opções não mostra o seletor"
);
const grupoRevisar = {
  ...grupo,
  chave: "fornecedor a|c:3",
  codigo: "3",
  status: "revisar",
  itens: [{ ...itemGrupo, codProd: "3", ncm: "02102000", analise: analiseRevisar }],
};
const htmlRevisar = gruposHtml([grupoRevisar], false);
checar(
  htmlRevisar.includes("data-grupo=") && htmlRevisar.includes("515001"),
  "o grupo em revisar mostra o seletor com as três opções"
);
checar(
  htmlRevisar.includes("200/200003") && htmlRevisar.includes("CST / cClassTrib · sugestão"),
  "o grupo em revisar mostra a sugestão de CST/cClassTrib"
);
const grupoMisto = {
  ...grupoRevisar,
  chave: "fornecedor a|c:4",
  codigo: "4",
  itens: [
    grupoRevisar.itens[0],
    {
      ...itemGrupo,
      codProd: "4",
      ncm: "02102000",
      analise: analisarItem(item({ ncm: "02102000", cst: "200", cc: "200038" })),
    },
  ],
};
checar(
  !gruposHtml([grupoMisto], false).includes("· sugestão"),
  "grupo com sugestões diferentes não mostra uma sugestão única"
);
S.escolhas.clear();
const itemDoGrupo = {
  origem: "nota.xml", nota: "10", item: "1", codProd: "9", ncm: "02102000",
  cst: "000", cc: "000001", semGrupo: false, valores: {},
};
itemDoGrupo.analise = analisarItem(itemDoGrupo);
S.registros = [itemDoGrupo];
const g9 = agruparPorCodigo(S.registros)[0];
escolherGrupo(g9.chave, "515001");
checar(
  itemDoGrupo.escolha === "515001" && itemDoGrupo.analise.manual === true,
  "a escolha no grupo vale para o item do grupo"
);
escolherGrupo(g9.chave, "");
checar(!itemDoGrupo.escolha && !itemDoGrupo.analise.manual, "o seletor do grupo também volta à sugestão");
const impresso = impressaoProdutos([itemGrupo]);
checar((impresso.match(/<tr>/g) || []).length === 2, "a impressão tem só o cabeçalho e uma linha por código");
checar(!impresso.includes("item 1"), "a impressão não lista os itens");
const grupo2 = {
  ...grupo,
  itens: [itemGrupo, { ...itemGrupo, analise: { ...itemGrupo.analise, declCst: "200", declCc: "200003" } }],
};
checar(gruposHtml([grupo2], false).includes("2 tributações"), "declarações diferentes viram contagem");

console.log("Busca");
S.registros = [
  { ncm: "02013000", desc: "COSTELA BOVINA", emitente: "FORNECEDOR A", analise: { status: "ok", alertas: [] } },
];
S.filtro = "todos";
const buscar = (q) => {
  S.busca = q;
  return S.registros.filter(registroFiltrado).length;
};
checar(buscar("COSTELA") === 1, "busca aceita maiúsculas");
checar(buscar("costela") === 1, "busca aceita minúsculas");
checar(buscar("FORNECEDOR A") === 1, "busca inclui o emitente");
checar(buscar("FORNECEDOR B") === 0, "busca não inventa resultado");

console.log("CSV");
checar(celulaCsv("=1+1") === `"'=1+1"`, "texto com = não vira fórmula no Excel");
checar(celulaCsv(12.5) === `"12.5"`, "número continua número");
checar(celulaCsv('diz "oi"') === `"diz ""oi"""`, "aspas continuam escapadas");

console.log("Exportação por visão");
const analiseProduto = { status: "div", declCst: "000", declCc: "200003", esperados: [{ cst: "200", cc: "200003" }] };
S.registros = [
  { codProd: "7", ncm: "02013000", emitente: "A", desc: "COSTELA", valor: 10.1, analise: analiseProduto },
  { codProd: "7", ncm: "02013000", emitente: "A", desc: "COSTELA", valor: 0.2, analise: analiseProduto },
  { codProd: "8", ncm: "34022000", emitente: "A", desc: "SABAO", valor: 5, analise: { status: "ok", declCst: "200", declCc: "200003", esperados: [{ cst: "200", cc: "200003" }] } },
];
S.visao = "produto";
const linhasProduto = gruposExport();
checar(linhasProduto.length === 2, "visão por código exporta uma linha por código, sem repetir o código");
checar(
  linhasProduto.every((l) => l.length === cabecalhoProduto().length),
  "cada linha tem o número de colunas do cabeçalho"
);
checar(linhasProduto[0][4] === 2 && linhasProduto[0][5] === 10.3, "o grupo conta os itens e soma o valor");
checar(nomeArquivo("xlsx").endsWith(" - Por Código.xlsx"), "o nome do arquivo mostra a visão por código");
S.visao = "itens";
checar(nomeArquivo("csv").endsWith(" - Todos os Itens.csv"), "o nome do arquivo mostra todos os itens");

console.log("Limite de pacote");
// O fflate só avisa o tamanho descompactado dentro do filter; o teste simula a entrada grande.
globalThis.window = {
  fflate: {
    unzipSync: (_dados, { filter }) => {
      filter({ name: "nota.xml", originalSize: 301 * 1024 * 1024 });
      return {};
    },
  },
};
const pacoteGrande = { name: "grande.zip", arrayBuffer: async () => new ArrayBuffer(0) };
const erroLimite = await descompactarZip(pacoteGrande).then(
  () => null,
  (e) => e
);
checar(!!erroLimite && erroLimite.limite === true, "ZIP acima de 300 MB é barrado antes de descompactar");
checar(!!erroLimite && /300 MB/.test(erroLimite.message), "a mensagem mostra o limite da constante");

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
