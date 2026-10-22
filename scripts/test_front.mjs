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
globalThis.__app = { S, analisarBase, agruparPorCodigo, registroFiltrado, celulaCsv, descompactarZip };`,
  { filename: "app.js" }
);

const { S, analisarBase, agruparPorCodigo, registroFiltrado, celulaCsv, descompactarZip } = globalThis.__app;
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
