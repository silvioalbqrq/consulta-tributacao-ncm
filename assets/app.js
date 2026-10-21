/* Conferencia IBS/CBS - NCM x CST x cClassTrib
 * 100% client-side: le XML (NF-e/NFC-e), XLSX/XLS/CSV e cruza o NCM com a
 * base de classificacao tributaria do IBS/CBS (Portal da Conformidade Facil).
 */
"use strict";

/* ------------------------------------------------------------------ */
/* estado                                                              */
/* ------------------------------------------------------------------ */

const S = {
  cat: null,          // { meta, csts, classificacoes }
  regras: null,       // { meta, variantes, ncm }
  desc: null,         // descricoes NCM (carregado em segundo plano)
  descPronto: false,
  arquivos: [],
  registros: [],
  filtro: "todos",
  busca: "",
  limite: 250,
  processando: false,
};

const $ = (id) => document.getElementById(id);

const CC_PADRAO = "000001";
const CST_PADRAO = "000";

const SELOS = {
  ok: { texto: "Conforme", classe: "ok" },
  div: { texto: "Divergente", classe: "err" },
  revisar: { texto: "Revisar", classe: "warn" },
  "sem-regra": { texto: "Integral confirmada", classe: "info" },
  invalido: { texto: "NCM inválido", classe: "err" },
};

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

const norm = (s) =>
  (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const esc = (s) =>
  (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const digitos = (s) => (s == null ? "" : String(s)).replace(/\D+/g, "");

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, "").replace(/^R\$/, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const moeda = (v) =>
  Number(num(v)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (v) => {
  const n = num(v);
  if (!n) return "0%";
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
};

const dataBR = (iso) => {
  if (!iso) return "";
  if (iso instanceof Date && !isNaN(iso)) return iso.toLocaleDateString("pt-BR");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(iso));
  return d ? `${d[1]}/${d[2]}/${d[3]}` : String(iso);
};

const codigoPad = (v, tamanho) => {
  let s = v == null ? "" : String(v).trim();
  if (!s) return "";
  if (typeof v === "number") s = String(Math.trunc(v));
  s = s.replace(/\.0+$/, "");
  if (!/^\d+$/.test(s)) return s.toUpperCase();
  if (s.length < tamanho) s = s.padStart(tamanho, "0");
  return s;
};

/* ------------------------------------------------------------------ */
/* base de dados                                                       */
/* ------------------------------------------------------------------ */

async function carregarBase() {
  if (location.protocol === "file:") {
    mostrarStatus(
      "Abra o site por HTTP (ex.: python -m http.server 8000). O navegador bloqueia a leitura dos dados em file://.",
      "erro"
    );
    return false;
  }
  mostrarStatus("Carregando base de classificação tributária…", "carregando");
  try {
    const [cat, regras] = await Promise.all([
      fetch("data/cst-cclasstrib.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("data/ncm-regras.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
    ]);
    S.cat = cat;
    S.regras = regras;
    preencherMeta();
    mostrarStatus("");
    carregarDescricoes();
    return true;
  } catch (e) {
    mostrarStatus("Não foi possível carregar a base de dados (" + e.message + ").", "erro");
    return false;
  }
}

async function carregarDescricoes() {
  try {
    const r = await fetch("data/ncm-descricoes.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    S.desc = await r.json();
  } catch (e) {
    S.desc = null;
  }
  S.descPronto = true;
  if (S.registros.length) renderizar();
  if ($("ncmManual").value.trim()) consultarManual();
}

function preencherMeta() {
  const m = S.cat && S.cat.meta ? S.cat.meta : {};
  if ($("metaSnapshot")) $("metaSnapshot").textContent = m.snapshot || "IT 2025.002";
  if ($("metaNcm")) $("metaNcm").textContent = `${(m.ncmComRegra || 0).toLocaleString("pt-BR")} NCMs com regra`;
  if ($("metaGerado")) $("metaGerado").textContent = m.geradoEm ? "Base gerada em " + dataBR(m.geradoEm) : "";
}

const descNcm = (ncm) => {
  if (!S.desc || !ncm) return "";
  const cod = digitos(ncm);
  if (S.desc.i && S.desc.i[cod]) return S.desc.i[cod];
  for (let n = cod.length - 1; n >= 4; n--) {
    const g = S.desc.g && S.desc.g[cod.slice(0, n)];
    if (g) return g;
  }
  return "";
};

/* ------------------------------------------------------------------ */
/* regras por NCM                                                      */
/* ------------------------------------------------------------------ */

const CATALOGO = () => (S.cat && S.cat.classificacoes) || {};

function detalheClassificacao(cc) {
  const c = CATALOGO()[cc];
  if (!c) return null;
  return {
    cc: c.CodClassTrib || cc,
    cst: c.Cst || "",
    nome: c.NomeReduzido || c.NomeClassTrib || "",
    nomeCompleto: c.NomeClassTrib || c.NomeReduzido || "",
    redIbs: c.PercRedIbs,
    redCbs: c.PercRedCbs,
    tipoAliq: c.TipoAliq,
    url: c.TexUrlLegislacao || "",
    anexo: c.NroAnexo,
  };
}

/** Regras de um NCM, separadas em permitidas e vedadas, agrupadas por cClassTrib. */
function regrasDoNcm(ncm) {
  const cod = digitos(ncm);
  const vazio = { cod, encontrado: false, exato: false, permitidos: [], vedados: [] };
  if (!S.regras || !cod) return vazio;

  let chave = null;
  let exato = false;
  if (S.regras.ncm[cod]) {
    chave = cod;
    exato = true;
  } else {
    // NCM com 7 digitos (arquivo truncado) ou incompleto: tenta prefixo.
    const candidatos = Object.keys(S.regras.ncm).filter((k) => k.startsWith(cod));
    if (candidatos.length === 1) chave = candidatos[0];
    else if (candidatos.length > 1) return { ...vazio, encontrado: true, multiplosNcm: candidatos };
  }
  if (!chave) return vazio;

  const mapa = new Map();
  for (const [cc, perm, vid] of S.regras.ncm[chave]) {
    const cat = detalheClassificacao(cc);
    if (!cat) continue;
    const variante = (S.regras.variantes && S.regras.variantes[String(vid)]) || {};
    const chaveMapa = cc + "|" + (perm === "VEDADO" ? "V" : "P");
    let item = mapa.get(chaveMapa);
    if (!item) {
      item = { ...cat, perm: perm === "VEDADO" ? "VEDADO" : "PERMITIDO", conds: [], itens: [], anexos: [] };
      mapa.set(chaveMapa, item);
    }
    if (variante.DescCondicao && !item.conds.includes(variante.DescCondicao)) item.conds.push(variante.DescCondicao);
    if (variante.DescExcecao && !item.conds.includes(variante.DescExcecao)) item.conds.push("Exceto: " + variante.DescExcecao);
    if (variante.DescItemAnexo && !item.itens.includes(variante.DescItemAnexo)) item.itens.push(variante.DescItemAnexo);
    if (variante.Observacao && !item.itens.includes(variante.Observacao)) item.itens.push(variante.Observacao);
    if (variante.DescAnexo && !item.anexos.includes(variante.DescAnexo)) item.anexos.push(variante.DescAnexo);
    if (variante.NroAnexo && !item.anexo) item.anexo = variante.NroAnexo;
  }

  const permitidos = [];
  const vedados = [];
  for (const item of mapa.values()) {
    item.conds.sort();
    (item.perm === "VEDADO" ? vedados : permitidos).push(item);
  }
  permitidos.sort((a, b) => (a.cc < b.cc ? -1 : 1));
  vedados.sort((a, b) => (a.cc < b.cc ? -1 : 1));

  const usouPrefixo = chave !== cod;
  return {
    cod,
    chave,
    exato,
    encontrado: true,
    usouPrefixo,
    permitidos,
    vedados,
    observacao: usouPrefixo ? `NCM ${cod} conferido pelo código ${chave} da base.` : "",
  };
}

/* ------------------------------------------------------------------ */
/* analise de um item                                                  */
/* ------------------------------------------------------------------ */

function analisarItem(reg) {
  const ncm = digitos(reg.ncm);
  const declCst = codigoPad(reg.cst, 3);
  const declCc = codigoPad(reg.cc, 6);
  const regra = regrasDoNcm(ncm);
  const analise = {
    ncmValido: ncm.length >= 4,
    declCst,
    declCc,
    regra,
    status: "revisar",
    esperados: [],
    alertas: [],
    nota: "",
    tipo: regra.permitidos.length ? (regra.permitidos.length > 1 ? "multipla" : "unica") : "nenhuma",
  };

  if (!analise.ncmValido) {
    analise.status = "invalido";
    analise.nota = "NCM ausente ou com menos de 4 dígitos.";
    return analise;
  }

  if (regra.multiplosNcm && regra.multiplosNcm.length) {
    analise.status = "revisar";
    analise.esperados = [];
    analise.nota = `NCM incompleto: ${regra.multiplosNcm.length} NCMs da base começam com ${ncm}. Informe os 8 dígitos.`;
    return analise;
  }

  if (!regra.permitidos.length) {
    analise.esperados = [detalheClassificacao(CC_PADRAO) || { cc: CC_PADRAO, cst: CST_PADRAO, nome: "Tributação integral" }];
    analise.principal = analise.esperados[0];
    const ccPadrao = analise.esperados[0];
    if (!declCc) {
      analise.status = "revisar";
      analise.nota = reg.semGrupo
        ? "O XML não possui o grupo IBSCBS. Para este NCM sem regra específica, o esperado é CST 000 / cClassTrib 000001."
        : "NCM sem regra específica nos anexos: a tributação é integral (CST 000 / cClassTrib 000001), mas o item não informa cClassTrib.";
    } else if (declCc === CC_PADRAO) {
      if (declCst && declCst !== (ccPadrao.cst || CST_PADRAO)) {
        analise.status = "div";
        analise.nota = `cClassTrib 000001 corresponde ao CST ${ccPadrao.cst || CST_PADRAO}, mas o item informa CST ${declCst}.`;
      } else {
        analise.status = "sem-regra";
        analise.nota = "NCM sem tratamento específico nos anexos: tributação integral confirmada.";
      }
    } else {
      analise.status = "div";
      analise.nota = `O NCM não consta nos anexos de nenhum cClassTrib com redução/benefício. O esperado é CST 000 / cClassTrib 000001; o item informa ${declCst || "—"} / ${declCc}.`;
    }
    if (regra.vedados.length) {
      analise.nota += " O NCM aparece como VEDADO em " + regra.vedados.map((v) => v.cc).join(", ") + ".";
    }
    analise.alertas = checarValores(reg, analise.esperados[0]);
    return analise;
  }

  analise.esperados = regra.permitidos;
  const escolhido = regra.permitidos.find((p) => p.cc === declCc);
  if (escolhido) analise.principal = escolhido;

  if (escolhido) {
    if (declCst && declCst !== escolhido.cst) {
      analise.status = "div";
      analise.nota = `O cClassTrib ${escolhido.cc} corresponde ao CST ${escolhido.cst}, mas o item informa CST ${declCst}.`;
    } else {
      analise.status = "ok";
      analise.nota = "CST e cClassTrib compatíveis com o NCM.";
    }
    analise.alertas = checarValores(reg, escolhido);
    return analise;
  }

  const vedado = regra.vedados.find((v) => v.cc === declCc);
  if (vedado) {
    analise.status = "div";
    analise.nota = `O cClassTrib ${declCc} é VEDADO para este NCM (restrição expressa no anexo).`;
  } else if (!declCc) {
    analise.status = "revisar";
    analise.nota = reg.semGrupo
      ? "O XML não possui o grupo IBSCBS: não há CST nem cClassTrib informados para o item."
      : "Item sem cClassTrib informado. O NCM possui " + (regra.permitidos.length === 1 ? "um cClassTrib aplicável" : "mais de um cClassTrib possível") + ".";
  } else if (regra.permitidos.length === 1) {
    analise.status = "div";
    analise.principal = regra.permitidos[0];
    analise.nota = `O NCM está vinculado ao cClassTrib ${regra.permitidos[0].cc} (CST ${regra.permitidos[0].cst}); o item informa ${declCc} (CST ${declCst || "—"}).`;
  } else {
    analise.status = "revisar";
    analise.nota = `O item informa ${declCc}, que não está entre as ${regra.permitidos.length} possibilidades do NCM. A escolha depende da condição de uso.`;
  }
  analise.alertas = checarValores(reg, regra.permitidos.length === 1 ? regra.permitidos[0] : null);
  return analise;
}

/** Confere se os valores de IBS/CBS refletem a reducao do cClassTrib aplicavel. */
function checarValores(reg, cand) {
  const alertas = [];
  const v = reg.valores || {};
  if (!cand) return alertas;
  const temValor = ["vIBSUF", "vCBS", "vIBS"].some((k) => v[k] !== undefined && v[k] !== "" && v[k] !== null);
  if (!temValor) return alertas;

  const base = num(v.vBC);
  const redI = num(cand.redIbs);
  const redC = num(cand.redCbs);

  const checar = (rotulo, valor, aliquota, reducao) => {
    const vv = num(valor);
    if (valor === undefined || valor === "" || valor === null) return;
    if (reducao >= 99.995) {
      if (vv > 0.004) {
        alertas.push(`${rotulo}: cClassTrib ${cand.cc} reduz ${pct(reducao)} da alíquota, então o valor deveria ser 0,00 (informado ${moeda(vv)}).`);
      }
      return;
    }
    if (base > 0 && aliquota > 0) {
      const esperado = base * (aliquota / 100) * (1 - reducao / 100);
      if (Math.abs(esperado - vv) > 0.02) {
        alertas.push(`${rotulo}: com redução de ${pct(reducao)}, o esperado sobre a base ${moeda(base)} seria ${moeda(esperado)} (informado ${moeda(vv)}).`);
      }
    }
  };

  checar("IBS estadual (vIBSUF)", v.vIBSUF, num(v.pIBSUF), redI);
  checar("CBS (vCBS)", v.vCBS, num(v.pCBS), redC);
  return alertas;
}

/* ------------------------------------------------------------------ */
/* leitura de XML                                                      */
/* ------------------------------------------------------------------ */

const nos = (raiz, nome) => Array.from(raiz.getElementsByTagNameNS("*", nome));
const no = (raiz, nome) => nos(raiz, nome)[0] || null;
const val = (raiz, nome) => {
  const e = no(raiz, nome);
  return e ? (e.textContent || "").trim() : "";
};

async function lerXml(file) {
  const texto = await file.text();
  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (no(doc, "parsererror")) throw new Error("XML inválido");

  const infs = nos(doc, "infNFe");
  if (!infs.length) throw new Error("não contém grupo infNFe (NF-e/NFC-e)");

  const registros = [];
  for (const inf of infs) {
    const ide = no(inf, "ide");
    const emit = no(inf, "emit");
    const chaveAttr = inf.getAttribute("Id") || "";
    const chave = digitos(chaveAttr) || val(doc, "chNFe");
    const nota = ide ? val(ide, "nNF") : "";
    const serie = ide ? val(ide, "serie") : "";
    const data = ide ? val(ide, "dhEmi") || val(ide, "dEmi") : "";
    const modelo = ide ? val(ide, "mod") : "";
    const emitente = emit ? val(emit, "xNome") : "";

    for (const det of nos(inf, "det")) {
      const prod = no(det, "prod");
      const imposto = no(det, "imposto");
      const ncm = prod ? val(prod, "NCM") : "";
      if (!ncm && !prod) continue;

      let cstIcms = "";
      if (imposto) {
        const icms = no(imposto, "ICMS");
        if (icms && icms.firstElementChild) {
          const grupo = icms.firstElementChild;
          cstIcms = val(grupo, "CST") || val(grupo, "CSOSN");
        }
      }

      let cst = "";
      let cc = "";
      let semGrupo = true;
      const valores = {};
      if (imposto) {
        const ibs = nos(imposto, "IBSCBS").find((e) => e.parentNode === imposto) || no(imposto, "IBSCBS");
        if (ibs) {
          semGrupo = false;
          cst = val(ibs, "CST");
          cc = val(ibs, "cClassTrib");
          const g = no(ibs, "gIBSCBS") || ibs;
          valores.vBC = val(g, "vBC");
          valores.pIBSUF = val(g, "pIBSUF");
          valores.vIBSUF = val(g, "vIBSUF");
          valores.pIBSMun = val(g, "pIBSMun");
          valores.vIBSMun = val(g, "vIBSMun");
          valores.vIBS = val(g, "vIBS");
          valores.pCBS = val(g, "pCBS");
          valores.vCBS = val(g, "vCBS");
        }
      }

      registros.push({
        origem: file.name,
        tipo: "xml",
        aba: "",
        nota,
        serie,
        modelo,
        emitente,
        chave,
        data,
        item: det.getAttribute("nItem") || "",
        ncm,
        desc: prod ? val(prod, "xProd") : "",
        cfop: prod ? val(prod, "CFOP") : "",
        cstIcms,
        cst,
        cc,
        semGrupo,
        valor: prod ? val(prod, "vProd") : "",
        valores,
      });
    }
  }
  if (!registros.length) throw new Error("nenhum item encontrado");
  return registros;
}

/* ------------------------------------------------------------------ */
/* leitura de planilha / CSV                                           */
/* ------------------------------------------------------------------ */

const ALIAS = [
  ["ncm", (h) => h === "ncm" || /^ncm\b/.test(h) || h.includes("ncm")],
  ["cc", (h) => h.includes("cclass") || h.includes("class trib") || h.includes("classificacao tributaria")],
  ["cstIcms", (h) => h.includes("icms") || h.includes("csosn")],
  ["cstPis", (h) => h.includes("pis")],
  ["cstCofins", (h) => h.includes("cofins")],
  ["cst", (h) => h.includes("cst")],
  ["codProd", (h) => h.includes("codigo produto") || h.includes("cod produto") || h === "cprod" || h === "codigo" || h === "cod"],
  ["desc", (h) => h.includes("descricao") || (h.includes("produto") && !h.includes("codigo") && !h.includes("cod produto") && !h.includes("ncm"))],
  ["nota", (h) => h === "nf" || h === "nota" || h.includes("numero nf") || h.includes("numero da nf") || h.includes("numero nota")],
  ["serie", (h) => h.includes("serie")],
  ["item", (h) => h === "item" || h === "n item" || h === "nro item"],
  ["data", (h) => h.includes("data")],
  ["chave", (h) => h.includes("chave")],
  ["cfop", (h) => h.includes("cfop")],
  ["valor", (h) => h.includes("valor total") || h.includes("valor liquido") || h.includes("total item")],
  ["vBC", (h) => h === "vbc" || h.includes("base ibs") || h.includes("base de calculo ibs")],
  ["vIBSUF", (h) => h.includes("vibsuf") || (h.includes("valor") && h.includes("ibs") && h.includes("uf"))],
  ["pIBSUF", (h) => h.includes("pibsuf") || (h.includes("aliquota") && h.includes("ibs"))],
  ["vCBS", (h) => h.includes("vcbs") || (h === "cbs") || (h.includes("valor") && h.includes("cbs"))],
  ["pCBS", (h) => h.includes("pcbs") || (h.includes("aliquota") && h.includes("cbs"))],
];

function mapearCabecalho(linha) {
  const mapa = {};
  const usados = new Set();
  const celulas = linha.map((c, i) => ({ i, h: norm(c) }));
  for (const [campo, teste] of ALIAS) {
    for (const { i, h } of celulas) {
      if (!h || usados.has(i)) continue;
      if (campo === "cst" && (h.includes("icms") || h.includes("pis") || h.includes("cofins"))) continue;
      if (campo === "valor" && h.includes("unitario")) continue;
      if (teste(h)) {
        mapa[campo] = i;
        usados.add(i);
        break;
      }
    }
  }
  return mapa;
}

function acharCabecalho(linhas) {
  let melhor = -1;
  let melhorMapa = null;
  let melhorNota = -1;
  const limite = Math.min(linhas.length, 20);
  for (let r = 0; r < limite; r++) {
    const mapa = mapearCabecalho(linhas[r] || []);
    if (mapa.ncm === undefined) continue;
    const nota = Object.keys(mapa).length + (mapa.cc !== undefined ? 3 : 0) + (mapa.cst !== undefined ? 2 : 0);
    if (nota > melhorNota) {
      melhor = r;
      melhorMapa = mapa;
      melhorNota = nota;
    }
  }
  return melhor >= 0 ? { linha: melhor, mapa: melhorMapa } : null;
}

async function lerPlanilha(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: true });
  const registros = [];

  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba];
    if (!ws) continue;
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: true });
    if (!linhas.length) continue;
    const cab = acharCabecalho(linhas);
    if (!cab) continue;
    const m = cab.mapa;

    for (let r = cab.linha + 1; r < linhas.length; r++) {
      const linha = linhas[r] || [];
      const ncmBruto = linha[m.ncm];
      const desc = m.desc !== undefined ? linha[m.desc] : "";
      if ((ncmBruto === null || ncmBruto === undefined || ncmBruto === "") && !desc) continue;
      const ncmTxt = typeof ncmBruto === "number" ? String(Math.trunc(ncmBruto)).padStart(8, "0") : digitos(ncmBruto);
      if (!ncmTxt) continue;

      const valores = {};
      if (m.vBC !== undefined) valores.vBC = linha[m.vBC];
      if (m.vIBSUF !== undefined) valores.vIBSUF = linha[m.vIBSUF];
      if (m.pIBSUF !== undefined) valores.pIBSUF = linha[m.pIBSUF];
      if (m.vCBS !== undefined) valores.vCBS = linha[m.vCBS];
      if (m.pCBS !== undefined) valores.pCBS = linha[m.pCBS];

      registros.push({
        origem: file.name,
        tipo: "planilha",
        aba: nomeAba,
        nota: m.nota !== undefined ? String(linha[m.nota] ?? "").replace(/\.0$/, "") : "",
        serie: m.serie !== undefined ? String(linha[m.serie] ?? "") : "",
        modelo: "",
        emitente: "",
        chave: m.chave !== undefined ? digitos(linha[m.chave]) : "",
        data: m.data !== undefined ? linha[m.data] : "",
        item: m.item !== undefined ? String(linha[m.item] ?? "") : "",
        ncm: ncmTxt,
        desc: String(desc ?? "").trim(),
        cfop: m.cfop !== undefined ? String(linha[m.cfop] ?? "") : "",
        cstIcms: m.cstIcms !== undefined ? codigoPad(linha[m.cstIcms], 2) : "",
        cstPis: m.cstPis !== undefined ? codigoPad(linha[m.cstPis], 2) : "",
        cstCofins: m.cstCofins !== undefined ? codigoPad(linha[m.cstCofins], 2) : "",
        cst: m.cst !== undefined ? codigoPad(linha[m.cst], 3) : "",
        cc: m.cc !== undefined ? codigoPad(linha[m.cc], 6) : "",
        valor: m.valor !== undefined ? linha[m.valor] : "",
        semGrupo: m.cst === undefined && m.cc === undefined,
        valores,
      });
    }
  }

  if (!registros.length) {
    throw new Error("não encontrei uma coluna NCM nas primeiras linhas da planilha");
  }
  return registros;
}

/* ------------------------------------------------------------------ */
/* processamento em lote                                               */
/* ------------------------------------------------------------------ */

const tick = () => new Promise((r) => setTimeout(r, 0));

async function processarArquivos() {
  if (!S.arquivos.length || S.processando) return;
  if (!S.cat || !S.regras) {
    mostrarStatus("A base de classificação tributária ainda não foi carregada. Recarregue a página e tente novamente.", "erro");
    return;
  }
  S.processando = true;
  $("btnProcessar").disabled = true;
  const erros = [];
  const registros = [];

  try {
    for (let i = 0; i < S.arquivos.length; i++) {
      const f = S.arquivos[i];
      mostrarStatus(`Lendo ${i + 1} de ${S.arquivos.length}: ${f.name}…`, "carregando");
      if (i % 3 === 0) await tick();
      try {
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        const lidos = ext === "xml" ? await lerXml(f) : await lerPlanilha(f);
        registros.push(...lidos);
      } catch (e) {
        erros.push(`${f.name}: ${e.message}`);
      }
    }

    for (const reg of registros) reg.analise = analisarItem(reg);
    S.registros = registros;
    S.filtro = "todos";
    S.busca = "";
    S.limite = 250;

    if (!registros.length) {
      mostrarStatus("Nenhum item pôde ser lido." + (erros.length ? " " + erros.join(" | ") : ""), "erro");
      renderizar();
      return;
    }

    const resumo = contar();
    let msg = `${registros.length} item(ns) de ${S.arquivos.length} arquivo(s) conferido(s): ${resumo.div} divergência(s), ${resumo.revisar} para revisar.`;
    if (resumo.alertas) msg += ` ${resumo.alertas} item(ns) com alerta de valor.`;
    if (erros.length) msg += ` Falha ao ler ${erros.length} arquivo(s): ${erros.join(" | ")}`;
    mostrarStatus(msg, erros.length ? "erro" : resumo.div ? "erro" : "ok");
    renderizar();
    document.getElementById("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    S.processando = false;
    $("btnProcessar").disabled = !S.arquivos.length;
  }
}

function contar() {
  const c = { total: S.registros.length, ok: 0, div: 0, revisar: 0, semRegra: 0, alertas: 0 };
  for (const r of S.registros) {
    const st = r.analise ? r.analise.status : "revisar";
    if (st === "ok") c.ok++;
    else if (st === "sem-regra") c.semRegra++;
    else if (st === "revisar") c.revisar++;
    else c.div++;
    if (r.analise && r.analise.alertas.length) c.alertas++;
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */

function mostrarStatus(msg, tipo) {
  const el = $("status");
  if (!msg) {
    el.hidden = true;
    el.className = "status";
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.className = "status" + (tipo ? " " + tipo : "");
  el.innerHTML =
    (tipo === "carregando" ? '<span class="spinner" aria-hidden="true"></span>' : "") +
    `<span>${esc(msg)}</span>`;
}

function registroFiltrado(r) {
  const a = r.analise || {};
  if (S.filtro === "div" && !["div", "invalido"].includes(a.status)) return false;
  if (S.filtro === "revisar" && a.status !== "revisar") return false;
  if (S.filtro === "ok" && a.status !== "ok") return false;
  if (S.filtro === "sem-regra" && a.status !== "sem-regra") return false;
  if (S.filtro === "alerta" && !(a.alertas && a.alertas.length)) return false;

  if (!S.busca) return true;
  const alvo = norm(
    [r.ncm, r.desc, r.nota, r.origem, a.declCc, a.declCst, a.esperados && a.esperados.map((e) => e.cc).join(" ")]
      .join(" ")
  );
  return alvo.includes(S.busca);
}

function renderizar() {
  const alvo = $("resultados");
  if (!S.registros.length) {
    alvo.innerHTML = "";
    return;
  }
  const c = contar();
  const filtrados = S.registros.filter(registroFiltrado);
  const visiveis = filtrados.slice(0, S.limite);
  const indiceGlobal = new Map(S.registros.map((r, i) => [r, i]));

  const kpi = (classe, valor, rotulo) =>
    `<div class="kpi ${classe}"><b>${valor}</b><span>${rotulo}</span></div>`;

  const chips = [
    ["todos", "Todos", c.total],
    ["div", "Divergentes", c.div],
    ["revisar", "Revisar", c.revisar],
    ["ok", "Conformes", c.ok],
    ["sem-regra", "Integral", c.semRegra],
    ["alerta", "Alerta de valor", c.alertas],
  ]
    .map(
      ([id, rotulo, n]) =>
        `<button type="button" data-filtro="${id}" aria-pressed="${S.filtro === id}">${rotulo} <b>${n}</b></button>`
    )
    .join("");

  alvo.innerHTML = `
    <div class="resumo">
      ${kpi("info", c.total, "Itens conferidos")}
      ${kpi("ok", c.ok, "Conformes")}
      ${kpi("err", c.div, "Divergentes")}
      ${kpi("warn", c.revisar, "Revisar")}
      ${kpi("", c.semRegra, "Integral (sem regra)")}
      ${kpi("warn", c.alertas, "Alertas de valor")}
    </div>
    <div class="barra">
      <div class="filtros" role="group" aria-label="Filtrar resultados">${chips}</div>
      <div class="busca-resultado">
        <input id="buscaResultado" type="search" placeholder="Filtrar por NCM, produto, nota…" value="${esc(S.busca)}" aria-label="Filtrar resultados">
        <button type="button" class="btn" id="btnCsv" title="Exporta todos os itens conferidos">CSV</button>
        <button type="button" class="btn dourado" id="btnXlsx" title="Exporta todos os itens conferidos">Baixar planilha</button>
      </div>
    </div>
    <div class="tabela-wrap">
      ${
        visiveis.length
          ? `<table class="resultado">
        <thead><tr>
          <th>Origem / nota</th>
          <th>NCM e produto</th>
          <th>Declarado</th>
          <th>Correto</th>
          <th>Situação</th>
        </tr></thead>
        <tbody>${visiveis.map((r) => linhaTabela(r, indiceGlobal.get(r))).join("")}</tbody>
      </table>`
          : `<p class="vazio">Nenhum item para este filtro.</p>`
      }
    </div>
    ${
      filtrados.length > visiveis.length
        ? `<div class="acoes"><button type="button" class="btn" id="btnMais">Mostrar mais ${Math.min(
            250,
            filtrados.length - visiveis.length
          )} de ${filtrados.length - visiveis.length} restantes</button></div>`
        : ""
    }
  `;

  alvo.querySelectorAll("[data-filtro]").forEach((b) =>
    b.addEventListener("click", () => {
      S.filtro = b.dataset.filtro;
      S.limite = 250;
      renderizar();
    })
  );
  const busca = $("buscaResultado");
  if (busca) {
    let timerBusca = null;
    busca.addEventListener("input", () => {
      S.busca = busca.value;
      clearTimeout(timerBusca);
      timerBusca = setTimeout(() => {
        S.limite = 250;
        renderizar();
        const novo = $("buscaResultado");
        if (novo) {
          novo.focus();
          novo.setSelectionRange(novo.value.length, novo.value.length);
        }
      }, 180);
    });
  }
  if ($("btnMais"))
    $("btnMais").addEventListener("click", () => {
      S.limite += 250;
      renderizar();
    });
  if ($("btnCsv")) $("btnCsv").addEventListener("click", exportarCsv);
  if ($("btnXlsx")) $("btnXlsx").addEventListener("click", exportarXlsx);

  alvo.querySelectorAll("tbody tr[data-i]").forEach((tr) => {
    const abrir = () => abrirDetalhe(Number(tr.dataset.i));
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrir();
      }
    });
  });
}

function linhaTabela(r, indice) {
  const i = indice;
  const a = r.analise || {};
  const s = SELOS[a.status] || SELOS.revisar;
  const desc = r.desc || descNcm(r.ncm);
  const notaTxt = [
    r.nota ? `NF ${esc(r.nota)}${r.serie ? "/" + esc(r.serie) : ""}` : "",
    r.item ? `item ${esc(r.item)}` : "",
    r.data ? dataBR(r.data) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  let correto = "";
  if (a.esperados && a.esperados.length) {
    const e = a.principal || a.esperados[0];
    const extras = a.esperados.length - 1;
    const nota = a.status === "ok" || extras <= 0 ? "" : `<span class="rotulo">+${extras} opção(ões)</span>`;
    correto = `<span class="rotulo">CST / cClassTrib</span><span class="valor">${esc(e.cst)} <span class="cc">${esc(e.cc)}</span></span>${nota}`;
  } else if (a.status === "invalido") {
    correto = '<span class="rotulo">—</span>';
  } else {
    correto = '<span class="rotulo">Ver detalhe</span>';
  }

  const alerta =
    a.alertas && a.alertas.length
      ? `<span class="alerta" title="${esc(a.alertas.join(" "))}">⚠ valor</span>`
      : "";

  return `<tr data-i="${i}" tabindex="0">
    <td class="origem"><b title="${esc(r.origem)}">${esc(r.origem)}</b>${notaTxt || "—"}</td>
    <td class="num"><b>${esc(r.ncm || "—")}</b><div class="produto"><span class="desc">${esc(desc) || "—"}</span></div></td>
    <td class="par"><span class="rotulo">CST / cClassTrib</span><span class="valor">${esc(a.declCst || "—")} <span class="cc">${esc(a.declCc || "—")}</span></span></td>
    <td class="par">${correto}</td>
    <td><span class="selo ${s.classe}">${s.texto}</span>${alerta}</td>
  </tr>`;
}

/* ------------------------------------------------------------------ */
/* detalhe                                                            */
/* ------------------------------------------------------------------ */

function abrirDetalhe(indice) {
  const r = S.registros[indice];
  if (!r) return;
  const a = r.analise || {};
  const regra = a.regra || { permitidos: [], vedados: [] };
  const desc = descNcm(r.ncm);
  const s = SELOS[a.status] || SELOS.revisar;

  const candidatoCard = (c, vedado) => `
    <div class="candidato${vedado ? " vedado" : ""}">
      <div class="topo-linha">
        <span class="cod">${esc(c.cc)}</span>
        <span class="cst">CST ${esc(c.cst)}</span>
        <span class="selo ${vedado ? "err" : "ok"}">${vedado ? "VEDADO" : "PERMITIDO"}</span>
        ${c.cc === a.declCc ? '<span class="selo info">Declarado</span>' : ""}
      </div>
      <p>${esc(c.nome)}</p>
      ${c.conds.map((x) => `<p class="cond">Condição: ${esc(x)}</p>`).join("")}
      <div class="tags">
        <span class="${num(c.redIbs) >= 100 ? "red" : ""}">Redução IBS ${pct(c.redIbs)}</span>
        <span class="${num(c.redCbs) >= 100 ? "red" : ""}">Redução CBS ${pct(c.redCbs)}</span>
        ${c.anexo ? `<span>Anexo ${esc(c.anexo)}</span>` : ""}
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Legislação</a>` : ""}
      </div>
    </div>`;

  const declarado = `<div class="caixa ${a.status === "ok" ? "ok" : "err"}">
      <span class="titulo">Declarado no item</span>
      <div class="linha">CST ${esc(a.declCst || "—")} · cClassTrib ${esc(a.declCc || "—")}</div>
      <div class="nome">${esc(catNome(a.declCc) || (a.declCc ? "cClassTrib não localizado na base" : "sem cClassTrib"))}</div>
    </div>`;

  let correto;
  if (a.esperados && a.esperados.length) {
    const e = a.principal || a.esperados[0];
    const titulo = a.status === "ok"
      ? "Confirmado no item"
      : a.esperados.length > 1
      ? `Possibilidade 1 de ${a.esperados.length}`
      : "Esperado para o NCM";
    correto = `<div class="caixa ok">
        <span class="titulo">${titulo}</span>
        <div class="linha">CST ${esc(e.cst)} · cClassTrib ${esc(e.cc)}</div>
        <div class="nome">${esc(e.nome)}</div>
      </div>`;
  } else {
    correto = `<div class="caixa"><span class="titulo">Esperado para o NCM</span><div class="linha">—</div><div class="nome">${
      a.status === "invalido" ? "NCM inválido" : "Consulte as opções abaixo"
    }</div></div>`;
  }

  const alertas = a.alertas && a.alertas.length
    ? `<h3>Alertas de valor</h3><ul class="aviso-lista">${a.alertas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : "";

  $("dlgTitulo").textContent = `NCM ${r.ncm || "—"} · ${r.nota ? "NF " + r.nota : r.origem}`;
  $("dlgCorpo").innerHTML = `
    <div class="dlg-produto">
      <div class="topo-linha" style="display:flex;gap:10px;align-items:center;justify-content:space-between">
        <span class="ncm">${esc(r.ncm || "—")}</span>
        <span class="selo ${s.classe}">${s.texto}</span>
      </div>
      <p>${esc(r.desc || desc) || "Sem descrição do produto."}</p>
      ${desc && r.desc ? `<p style="font-size:12px">NCM: ${esc(desc)}</p>` : ""}
      <p style="font-size:12px">${esc(r.origem)}${r.aba ? " · aba " + esc(r.aba) : ""}${
        r.nota ? " · NF " + esc(r.nota) + (r.serie ? "/" + esc(r.serie) : "") : ""
      }${r.item ? " · item " + esc(r.item) : ""}${r.chave ? " · chave " + esc(r.chave) : ""}</p>
    </div>

    <h3>Comparação</h3>
    <div class="duelo">${declarado}${correto}</div>
    <p style="font-size:13px;margin:10px 0 0">${esc(a.nota || "")}</p>
    ${alertas}

    <h3>${regra.permitidos.length ? "Possibilidades permitidas para o NCM" : "Regra aplicada"}</h3>
    ${
      regra.multiplosNcm && regra.multiplosNcm.length
        ? `<div class="candidatos"><div class="candidato">
            <p>O NCM informado está incompleto. Existem ${regra.multiplosNcm.length} NCMs na base começando com ${esc(regra.cod)}; informe os 8 dígitos para consultar a regra correta.</p>
          </div></div>`
        : regra.permitidos.length
        ? `<div class="candidatos">${regra.permitidos.map((c) => candidatoCard(c, false)).join("")}</div>`
        : `<div class="candidatos"><div class="candidato">
            <div class="topo-linha"><span class="cod">000001</span><span class="cst">CST 000</span><span class="selo ok">PADRÃO</span></div>
            <p>O NCM não consta em nenhum anexo com tratamento específico. Aplica-se a tributação integral do IBS e da CBS.</p>
            <div class="tags"><span>Redução IBS 0%</span><span>Redução CBS 0%</span></div>
          </div></div>`
    }

    ${
      regra.vedados && regra.vedados.length
        ? `<h3>Vedado para este NCM</h3><div class="candidatos">${regra.vedados
            .map((c) => candidatoCard(c, true))
            .join("")}</div>`
        : ""
    }

    <h3>Referências</h3>
    <p style="font-size:12.5px">
      <a href="https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria" target="_blank" rel="noopener">Portal da Conformidade Fácil (SEFAZ-RS)</a>
      · <a href="https://silvioalbqrq.github.io/cst-cclasstrib/" target="_blank" rel="noopener">Consulta CST × cClassTrib</a>
    </p>
  `;
  const dlg = $("dlg");
  if (!dlg.open) dlg.showModal();
}

function catNome(cc) {
  if (!cc) return "";
  const d = detalheClassificacao(codigoPad(cc, 6));
  return d ? `${d.nome}` : "";
}

/* ------------------------------------------------------------------ */
/* consulta manual                                                    */
/* ------------------------------------------------------------------ */

function consultarManual() {
  const bruto = $("ncmManual").value;
  const cod = digitos(bruto);
  const alvo = $("manualResultado");
  if (!cod) {
    alvo.innerHTML = `<p class="vazio" style="padding:14px 0">Informe um NCM para consultar.</p>`;
    return;
  }

  const regra = regrasDoNcm(cod);
  const desc = descNcm(regra.chave || cod);

  if (regra.multiplosNcm && regra.multiplosNcm.length) {
    alvo.innerHTML = `<p class="ajuda" style="margin:0 0 8px">${regra.multiplosNcm.length} NCMs começam com <b>${esc(cod)}</b>. Selecione:</p>
      <ul class="lista-arquivos" style="max-height:240px;display:block">
        ${regra.multiplosNcm
          .slice(0, 200)
          .map((k) => {
            const rr = regrasDoNcm(k);
            const cc = rr.permitidos.map((p) => p.cc).join(", ") || "000001";
            return `<li><span class="tipo">NCM</span><button type="button" class="btn" style="border:0;background:none;padding:0;font-weight:600" data-ncm="${k}">${k}</button><span class="nome">${esc(descNcm(k))}</span><span class="tipo">${cc}</span></li>`;
          })
          .join("")}
      </ul>`;
    alvo.querySelectorAll("[data-ncm]").forEach((b) =>
      b.addEventListener("click", () => {
        $("ncmManual").value = b.dataset.ncm;
        consultarManual();
      })
    );
    return;
  }

  if (!regra.encontrado) {
    alvo.innerHTML = `<div class="caixa">
      <span class="titulo">NCM ${esc(cod)}</span>
      <div class="linha">CST 000 · cClassTrib 000001</div>
      <div class="nome">Não consta nos anexos: tributação integral do IBS e da CBS.</div>
    </div>`;
    return;
  }

  const cards = regra.permitidos.length
    ? regra.permitidos.map((c) => candidatoSimples(c, false)).join("")
    : `<div class="candidato"><span class="cod">000001</span> <span class="cst">CST 000</span><p>NCM sem tratamento específico: tributação integral.</p></div>`;

  alvo.innerHTML = `
    <p class="ajuda" style="margin:0 0 8px"><b>NCM ${esc(regra.chave || cod)}</b> — ${esc(desc) || "descrição não disponível"}</p>
    <div class="candidatos">${cards}</div>
    ${regra.vedados.length ? `<p class="ajuda" style="margin:10px 0 0">Vedado: ${regra.vedados.map((v) => esc(v.cc)).join(", ")}</p>` : ""}
    ${regra.permitidos.length > 1 ? `<p class="ajuda" style="margin:8px 0 0">Há mais de uma possibilidade: a escolha depende da condição de uso do produto.</p>` : ""}
  `;
}

function candidatoSimples(c, vedado) {
  return `<div class="candidato${vedado ? " vedado" : ""}">
    <div class="topo-linha">
      <span class="cod">${esc(c.cc)}</span>
      <span class="cst">CST ${esc(c.cst)}</span>
      ${c.anexo ? `<span class="tipo">Anexo ${esc(c.anexo)}</span>` : ""}
    </div>
    <p>${esc(c.nome)}</p>
    ${c.conds.map((x) => `<p class="cond">Condição: ${esc(x)}</p>`).join("")}
    <div class="tags">
      <span class="${num(c.redIbs) >= 100 ? "red" : ""}">Redução IBS ${pct(c.redIbs)}</span>
      <span class="${num(c.redCbs) >= 100 ? "red" : ""}">Redução CBS ${pct(c.redCbs)}</span>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* exportacao                                                         */
/* ------------------------------------------------------------------ */

function nomeBase() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `conferencia-ibs-cbs-${iso}`;
}

function cabecalho() {
  return [
    "Origem", "Aba", "Nota", "Série", "Item", "NCM", "Descrição do produto", "Valor do item",
    "CST decl.", "cClassTrib decl.", "CST correto", "cClassTrib correto",
    "Situação", "Redução IBS", "Redução CBS", "Observação",
  ];
}

function linhaExport(r) {
  const a = r.analise || {};
  const e = a.principal || (a.esperados && a.esperados[0]);
  return [
    r.origem, r.aba || "", r.nota || "", r.serie || "", r.item || "", r.ncm || "",
    r.desc || descNcm(r.ncm) || "",
    num(r.valor) ? num(r.valor) : "",
    a.declCst || "", a.declCc || "",
    e ? e.cst : "", e ? e.cc : "",
    (SELOS[a.status] || SELOS.revisar).texto,
    e ? pct(e.redIbs) : "", e ? pct(e.redCbs) : "",
    [a.nota, ...(a.alertas || [])].filter(Boolean).join(" | "),
  ];
}

function exportarCsv() {
  const dados = [cabecalho(), ...S.registros.map(linhaExport)];
  const csv = dados
    .map((linha) => linha.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  baixar(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), nomeBase() + ".csv");
}

function exportarXlsx() {
  const todos = S.registros;
  const ws = XLSX.utils.aoa_to_sheet([cabecalho(), ...todos.map(linhaExport)]);
  ws["!cols"] = [
    { wch: 28 }, { wch: 12 }, { wch: 9 }, { wch: 7 }, { wch: 6 }, { wch: 11 }, { wch: 42 }, { wch: 12 },
    { wch: 9 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 70 },
  ];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: todos.length, c: cabecalho().length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conferência");

  // Planilha para redigitação: só preenche quando a correção é inequívoca.
  const correcao = [
    ["Origem", "Nota", "Item", "NCM", "Descrição", "CST IBS/CBS", "cClassTrib", "Situação", "Observação"],
  ];
  for (const r of todos) {
    const a = r.analise || {};
    const e = a.esperados && a.esperados.length === 1 ? a.esperados[0] : null;
    const corrigivel = e && a.status === "div";
    const opcoes = (a.esperados || []).map((x) => x.cc).join(", ");
    let observacao;
    if (corrigivel) observacao = `Corrigido para ${e.cst}/${e.cc}. ${a.nota || ""}`.trim();
    else if (a.status === "ok" || a.status === "sem-regra") observacao = "Sem alteração.";
    else if (a.status === "invalido") observacao = "NCM inválido: não foi possível determinar o CST/cClassTrib.";
    else observacao = `Não corrigido automaticamente. ${a.nota || ""}${opcoes ? " Opções: " + opcoes + "." : ""}`.trim();

    correcao.push([
      r.origem, r.nota || "", r.item || "", r.ncm || "", r.desc || descNcm(r.ncm) || "",
      corrigivel ? e.cst : a.declCst || "",
      corrigivel ? e.cc : a.declCc || "",
      (SELOS[a.status] || SELOS.revisar).texto,
      observacao,
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(correcao);
  ws2["!cols"] = [
    { wch: 28 }, { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 42 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Corrigida");

  XLSX.writeFile(wb, nomeBase() + ".xlsx");
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------------ */
/* arquivos                                                           */
/* ------------------------------------------------------------------ */

const EXT_OK = ["xml", "xlsx", "xls", "csv"];

function adicionarArquivos(lista) {
  const novos = Array.from(lista).filter((f) => {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    return EXT_OK.includes(ext);
  });
  for (const f of novos) {
    if (!S.arquivos.some((x) => x.name === f.name && x.size === f.size)) S.arquivos.push(f);
  }
  renderArquivos();
}

function renderArquivos() {
  const ul = $("listaArquivos");
  ul.hidden = !S.arquivos.length;
  ul.innerHTML = S.arquivos
    .map(
      (f, i) => `<li>
        <span class="tipo">${esc((f.name.split(".").pop() || "").toUpperCase())}</span>
        <span class="nome" title="${esc(f.name)}">${esc(f.name)}</span>
        <button type="button" class="remover" data-remover="${i}" aria-label="Remover ${esc(f.name)}">×</button>
      </li>`
    )
    .join("");
  ul.querySelectorAll("[data-remover]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      S.arquivos.splice(Number(b.dataset.remover), 1);
      renderArquivos();
    })
  );
  $("btnProcessar").disabled = !S.arquivos.length || S.processando;
  $("btnLimpar").disabled = !S.arquivos.length && !S.registros.length;
}

/* ------------------------------------------------------------------ */
/* eventos                                                            */
/* ------------------------------------------------------------------ */

function iniciar() {
  const zona = $("zona");
  const input = $("arquivos");

  input.addEventListener("change", () => {
    adicionarArquivos(input.files);
    input.value = "";
  });

  ;["dragenter", "dragover"].forEach((ev) =>
    zona.addEventListener(ev, (e) => {
      e.preventDefault();
      zona.classList.add("ativo");
    })
  );
  ;["dragleave", "drop"].forEach((ev) =>
    zona.addEventListener(ev, (e) => {
      e.preventDefault();
      zona.classList.remove("ativo");
    })
  );
  zona.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) adicionarArquivos(e.dataTransfer.files);
  });
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  $("btnProcessar").addEventListener("click", processarArquivos);

  $("btnLimpar").addEventListener("click", () => {
    S.arquivos = [];
    S.registros = [];
    S.filtro = "todos";
    S.busca = "";
    renderArquivos();
    renderizar();
    mostrarStatus("");
    $("ncmManual").value = "";
    $("manualResultado").innerHTML = "";
  });

  $("formManual").addEventListener("submit", (e) => {
    e.preventDefault();
    consultarManual();
  });

  document.querySelectorAll("[data-ncm]").forEach((b) =>
    b.addEventListener("click", () => {
      $("ncmManual").value = b.dataset.ncm;
      consultarManual();
    })
  );

  $("dlgFechar").addEventListener("click", () => $("dlg").close());
  $("dlg").addEventListener("click", (e) => {
    if (e.target === $("dlg")) $("dlg").close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("ncmManual").focus();
    }
  });

  renderArquivos();
  carregarBase();
}

document.addEventListener("DOMContentLoaded", iniciar);
