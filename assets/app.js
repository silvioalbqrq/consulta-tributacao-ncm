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
  arquivos: [],
  registros: [],
  escolhas: new Map(),
  errosLeitura: [],
  falhasAnalise: [],
  filtro: "todos",
  busca: "",
  tamanhoPagina: 25,
  pagina: 1,
  visao: "itens",
  processando: false,
  descompactando: false,
};

const $ = (id) => document.getElementById(id);

/* Versão dos assets: ao publicar uma alteração, atualize este valor e o ?v= das
 * tags em index.html. Evita que o navegador use CSS/JS antigos do cache. */
const VERSAO = "2026.10.22f";

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

/** NCM de célula numérica: só repõe o zero perdido de um NCM de 8 dígitos (7 dígitos no número). */
const ncmDeCelula = (v) => {
  if (typeof v !== "number") return digitos(v);
  const s = String(Math.trunc(v));
  return s.length === 7 ? "0" + s : s;
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
      fetch(`data/cst-cclasstrib.json?v=${VERSAO}`).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch(`data/ncm-regras.json?v=${VERSAO}`).then((r) => {
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
    const r = await fetch(`data/ncm-descricoes.json?v=${VERSAO}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    S.desc = await r.json();
  } catch (e) {
    S.desc = null;
  }
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

/** Analisa o item: regra do NCM + escolha manual de tributação, quando houver. */
function analisarItem(reg) {
  const analise = analisarBase(reg);
  const opcoes = analise.esperados || [];
  analise.principalAuto = analise.principal || opcoes[0] || null;
  return aplicarEscolha(analise, reg);
}

/** Aplica a escolha manual do usuário entre as opções permitidas do NCM. */
function aplicarEscolha(analise, reg) {
  const escolha = codigoPad(reg.escolha, 6);
  const opcoes = analise.esperados || [];
  if (!escolha || opcoes.length < 2) return analise;
  const cand = opcoes.find((o) => o.cc === escolha);
  if (!cand) return analise;

  analise.manual = true;
  analise.principal = cand;
  const compativel = analise.declCc === cand.cc && (!analise.declCst || analise.declCst === cand.cst);
  if (compativel) {
    analise.status = "ok";
    analise.nota = `CST e cClassTrib compatíveis com o NCM (tributação escolhida manualmente entre ${opcoes.length} possibilidades).`;
  } else {
    analise.status = "div";
    analise.nota = `Correção definida manualmente: CST ${cand.cst} / cClassTrib ${cand.cc}, escolhido entre ${opcoes.length} possibilidades do NCM.`;
  }
  analise.alertas = checarValores(reg, cand);
  return analise;
}

function analisarBase(reg) {
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
        aba: "",
        nota,
        serie,
        emitente,
        chave,
        data,
        item: det.getAttribute("nItem") || "",
        ncm,
        codProd: prod ? val(prod, "cProd") : "",
        desc: prod ? val(prod, "xProd") : "",
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
      const ncmTxt = ncmDeCelula(ncmBruto);
      if (!ncmTxt) continue;

      const valores = {};
      if (m.vBC !== undefined) valores.vBC = linha[m.vBC];
      if (m.vIBSUF !== undefined) valores.vIBSUF = linha[m.vIBSUF];
      if (m.pIBSUF !== undefined) valores.pIBSUF = linha[m.pIBSUF];
      if (m.vCBS !== undefined) valores.vCBS = linha[m.vCBS];
      if (m.pCBS !== undefined) valores.pCBS = linha[m.pCBS];

      registros.push({
        origem: file.name,
        aba: nomeAba,
        nota: m.nota !== undefined ? String(linha[m.nota] ?? "").replace(/\.0$/, "") : "",
        serie: m.serie !== undefined ? String(linha[m.serie] ?? "") : "",
        emitente: "",
        chave: m.chave !== undefined ? digitos(linha[m.chave]) : "",
        data: m.data !== undefined ? linha[m.data] : "",
        item: m.item !== undefined ? String(linha[m.item] ?? "") : "",
        ncm: ncmTxt,
        codProd: m.codProd !== undefined ? String(linha[m.codProd] ?? "").replace(/\.0$/, "").trim() : "",
        desc: String(desc ?? "").trim(),
        cstIcms: m.cstIcms !== undefined ? codigoPad(linha[m.cstIcms], 2) : "",
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
  if (S.descompactando) {
    mostrarStatus("Aguarde: ainda estou descompactando os arquivos enviados.", "carregando");
    return;
  }
  if (!S.cat || !S.regras) {
    mostrarStatus("A base de classificação tributária ainda não foi carregada. Recarregue a página e tente novamente.", "erro");
    return;
  }
  S.processando = true;
  $("btnProcessar").disabled = true;
  const erros = [];
  const falhasAnalise = [];
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

    reaplicarEscolhas(registros);

    for (const reg of registros) {
      try {
        reg.analise = analisarItem(reg);
      } catch (e) {
        falhasAnalise.push(`${reg.origem}${reg.item ? " · item " + reg.item : ""}: ${e.message}`);
        reg.analise = {
          status: "revisar",
          declCst: codigoPad(reg.cst, 3),
          declCc: codigoPad(reg.cc, 6),
          esperados: [],
          alertas: [],
          nota: "Falha ao analisar este item.",
          regra: { permitidos: [], vedados: [], falhou: true },
        };
      }
    }
    S.registros = registros;
    S.errosLeitura = erros;
    S.falhasAnalise = falhasAnalise;
    S.filtro = "todos";
    S.busca = "";
    S.pagina = 1;

    if (!registros.length) {
      mostrarStatus("Nenhum item pôde ser lido." + (erros.length ? " " + erros.join(" | ") : ""), "erro");
      renderizar();
      return;
    }

    resumoStatus();
    renderizar();
    document.getElementById("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    mostrarStatus("Falha ao conferir os arquivos: " + e.message, "erro");
  } finally {
    S.processando = false;
    $("btnProcessar").disabled = !S.arquivos.length;
  }
}

function contar() {
  const c = { total: S.registros.length, ok: 0, div: 0, revisar: 0, semRegra: 0, alertas: 0, ajustados: 0 };
  for (const r of S.registros) {
    const st = r.analise ? r.analise.status : "revisar";
    if (st === "ok") c.ok++;
    else if (st === "sem-regra") c.semRegra++;
    else if (st === "revisar") c.revisar++;
    else c.div++;
    if (r.analise && r.analise.alertas.length) c.alertas++;
    if (r.analise && r.analise.manual) c.ajustados++;
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

/** Recalcula o resumo mostrado na barra de status (usado também após uma escolha manual). */
function resumoStatus() {
  if (!S.registros.length) return;
  const c = contar();
  let msg = `${c.total} item(ns) de ${S.arquivos.length} arquivo(s) conferido(s): ${c.div} divergência(s), ${c.revisar} para revisar.`;
  if (c.ajustados) msg += ` ${c.ajustados} com tributação escolhida manualmente.`;
  if (c.alertas) msg += ` ${c.alertas} item(ns) com alerta de valor.`;
  if (S.errosLeitura.length) msg += ` Falha ao ler ${S.errosLeitura.length} arquivo(s): ${S.errosLeitura.join(" | ")}`;
  if (S.falhasAnalise.length) msg += ` Falha ao analisar ${S.falhasAnalise.length} item(ns): ${S.falhasAnalise.join(" | ")}`;
  mostrarStatus(msg, S.errosLeitura.length || S.falhasAnalise.length || c.div ? "erro" : "ok");
}

function registroFiltrado(r) {
  const a = r.analise || {};
  if (S.filtro === "div" && !["div", "invalido"].includes(a.status)) return false;
  if (S.filtro === "revisar" && a.status !== "revisar") return false;
  if (S.filtro === "ok" && a.status !== "ok") return false;
  if (S.filtro === "sem-regra" && a.status !== "sem-regra") return false;
  if (S.filtro === "alerta" && !(a.alertas && a.alertas.length)) return false;
  if (S.filtro === "ajustados" && !a.manual) return false;

  const q = norm(S.busca);
  if (!q) return true;
  const alvo = norm(
    [
      r.ncm,
      r.codProd,
      r.desc,
      r.emitente,
      r.nota,
      r.origem,
      a.declCc,
      a.declCst,
      a.esperados && a.esperados.map((e) => e.cc).join(" "),
    ].join(" ")
  );
  return alvo.includes(q);
}

function renderizar() {
  const alvo = $("resultados");
  if (!S.registros.length) {
    alvo.innerHTML = "";
    return;
  }
  const c = contar();
  const filtrados = S.registros.filter(registroFiltrado);
  const indiceGlobal = new Map(S.registros.map((r, i) => [r, i]));
  const grupos = S.visao === "produto" ? agruparPorCodigo(filtrados) : null;
  const mostrarEmitente = grupos
    ? new Set(S.registros.map((r) => r.emitente).filter(Boolean)).size > 1
    : false;
  const linhas = grupos || filtrados;
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / S.tamanhoPagina));
  S.pagina = Math.min(Math.max(1, S.pagina), totalPaginas);
  const inicio = (S.pagina - 1) * S.tamanhoPagina;
  const visiveis = linhas.slice(inicio, inicio + S.tamanhoPagina);
  const singular = grupos ? "produto" : "item";
  const plural = grupos ? "produtos" : "itens";
  const unidade = linhas.length === 1 ? singular : plural;
  const rotuloTamanho = grupos ? "Produtos por página" : "Itens por página";
  const faixa = linhas.length
    ? `${inicio + 1}–${inicio + visiveis.length} de ${linhas.length} ${unidade}`
    : `0 ${unidade}`;
  const opcoesTamanho = TAMANHOS_PAGINA.map(
    (n) => `<option value="${n}"${n === S.tamanhoPagina ? " selected" : ""}>${n}</option>`
  ).join("");

  const kpi = (classe, valor, rotulo) =>
    `<div class="kpi ${classe}"><b>${valor}</b><span>${rotulo}</span></div>`;

  const defsChips = [
    ["todos", "Todos", c.total],
    ["div", "Divergentes", c.div],
    ["revisar", "Revisar", c.revisar],
    ["ok", "Conformes", c.ok],
    ["sem-regra", "Integral", c.semRegra],
    ["alerta", "Alerta de valor", c.alertas],
  ];
  if (c.ajustados) defsChips.push(["ajustados", "Ajustados", c.ajustados]);
  const chips = defsChips
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
        <input id="buscaResultado" type="search" placeholder="Filtrar por NCM, código, produto, nota…" value="${esc(S.busca)}" aria-label="Filtrar resultados">
        <button type="button" class="btn" id="btnCsv" title="Exporta a visão escolhida: todos os itens ou por código do produto">CSV</button>
        <button type="button" class="btn dourado" id="btnXlsx" title="Exporta a visão escolhida: todos os itens ou por código do produto">Baixar planilha</button>
        <button type="button" class="btn" id="btnImprimir" title="Imprime a visão escolhida (lista filtrada, não só esta página)">Imprimir</button>
      </div>
    </div>
    <div class="barra-sec">
      <div class="visao" role="group" aria-label="Como mostrar os itens">
        <button type="button" data-visao="itens" aria-pressed="${S.visao === "itens"}">Todos os itens</button>
        <button type="button" data-visao="produto" aria-pressed="${S.visao === "produto"}">Por código do produto</button>
      </div>
    </div>
    ${
      grupos
        ? `<div class="tabela-wrap">${gruposHtml(visiveis, mostrarEmitente)}</div>`
        : `<div class="tabela-wrap">${tabelaHtml(visiveis, indiceGlobal)}</div>`
    }
    <div class="barra-pag">
      <div class="paginacao">
        <label class="por-pagina">Por página
          <select id="tamanhoPagina" aria-label="${rotuloTamanho}">${opcoesTamanho}</select>
        </label>
        <button type="button" class="btn" id="pagAnterior"${S.pagina <= 1 ? " disabled" : ""}>‹ Anterior</button>
        <span class="pag-info">Página ${S.pagina} de ${totalPaginas} · ${faixa}</span>
        <button type="button" class="btn" id="pagProxima"${S.pagina >= totalPaginas ? " disabled" : ""}>Próxima ›</button>
        <button type="button" class="btn" id="pagUltima"${S.pagina >= totalPaginas ? " disabled" : ""} title="Ir para a última página">Última página »</button>
      </div>
    </div>
  `;

  alvo.querySelectorAll("[data-filtro]").forEach((b) =>
    b.addEventListener("click", () => {
      S.filtro = b.dataset.filtro;
      S.pagina = 1;
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
        S.pagina = 1;
        renderizar();
        const novo = $("buscaResultado");
        if (novo) {
          novo.focus();
          novo.setSelectionRange(novo.value.length, novo.value.length);
        }
      }, 180);
    });
  }
  alvo.querySelectorAll("[data-visao]").forEach((b) =>
    b.addEventListener("click", () => {
      if (S.visao === b.dataset.visao) return;
      S.visao = b.dataset.visao;
      S.pagina = 1;
      renderizar();
    })
  );
  if ($("tamanhoPagina"))
    $("tamanhoPagina").addEventListener("change", (e) => {
      S.tamanhoPagina = Number(e.target.value) || 25;
      S.pagina = 1;
      renderizar();
    });
  if ($("pagAnterior"))
    $("pagAnterior").addEventListener("click", () => {
      if (S.pagina <= 1) return;
      S.pagina--;
      renderizar();
      irParaTabela();
    });
  if ($("pagProxima"))
    $("pagProxima").addEventListener("click", () => {
      S.pagina++;
      renderizar();
      irParaTabela();
    });
  if ($("pagUltima"))
    $("pagUltima").addEventListener("click", () => {
      if (S.pagina >= totalPaginas) return;
      S.pagina = totalPaginas;
      renderizar();
      irParaTabela();
    });
  if ($("btnCsv")) $("btnCsv").addEventListener("click", exportarCsv);
  if ($("btnXlsx")) $("btnXlsx").addEventListener("click", exportarXlsx);
  if ($("btnImprimir"))
    $("btnImprimir").addEventListener("click", () => {
      prepararImpressao();
      window.print();
    });

  alvo.querySelectorAll("select[data-escolha]").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("keydown", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      definirEscolha(Number(sel.dataset.escolha), sel.value);
    });
  });

  alvo.querySelectorAll("tr[data-i], li[data-i]").forEach((tr) => {
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

const TAMANHOS_PAGINA = [10, 25, 50, 100];

/** Descrição do produto: a que vem do arquivo ou a da base de NCM. */
function descricaoItem(r) {
  return r.desc || descNcm(r.ncm);
}

/** Contexto do item nas listas: origem, nota/série, item e (opcional) data de emissão. */
function contextoItem(r, { origem = true, data = false } = {}) {
  const partes = [];
  if (origem && r.origem) partes.push(r.origem);
  if (r.nota) partes.push(`NF ${r.nota}${r.serie ? "/" + r.serie : ""}`);
  if (r.item) partes.push(`item ${r.item}`);
  if (data && r.data) partes.push(dataBR(r.data));
  return partes.join(" · ");
}

/** Código do produto (cProd) informado no arquivo, quando existir. */
function codigoProduto(r) {
  if (!r.codProd) return "";
  const cod = esc(r.codProd);
  return `<span class="cod-prod" title="Código do produto (cProd) informado no arquivo: ${cod}">cód. ${cod}</span>`;
}

/** Moldura da tabela de resultados (mesmas colunas nas duas visões). */
function tabelaResultado(corpo, produto, mostrarEmitente) {
  return `<table class="resultado">
    <thead><tr>
      <th>${produto ? (mostrarEmitente ? "Emitente / código" : "Código do produto") : "Origem / nota"}</th>
      <th>NCM e produto</th>
      <th>Declarado</th>
      <th>Correto</th>
      <th>Situação</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
  </table>`;
}

/** Corpo da tabela (visão "Todos os itens") com a página atual. */
function tabelaHtml(lista, indiceGlobal) {
  if (!lista.length) return '<p class="vazio">Nenhum item para este filtro.</p>';
  return tabelaResultado(lista.map((r) => linhaTabela(r, indiceGlobal.get(r))).join(""));
}

/** Corpo da visão "Por código do produto": uma linha por produto, sem os itens. */
function gruposHtml(lista, mostrarEmitente) {
  if (!lista.length) return '<p class="vazio">Nenhum item para este filtro.</p>';
  return tabelaResultado(lista.map((g) => linhaGrupo(g, mostrarEmitente)).join(""), true, mostrarEmitente);
}

/** Dados resumidos de um grupo (emitente + código) para tela, impressão e exportação. */
function resumoGrupo(g) {
  const analiseDe = (r) => r.analise || {};
  const parCorreto = (r) => {
    const a = analiseDe(r);
    const e = a.principal || (a.esperados && a.esperados[0]);
    return e ? `${e.cst}/${e.cc}` : "—";
  };
  const unicos = (lista) => [...new Set(lista)];
  return {
    ncms: unicos(g.itens.map((r) => r.ncm).filter(Boolean)),
    desc: descricaoItem(g.itens[0]) || "",
    declarados: unicos(g.itens.map((r) => `${analiseDe(r).declCst || "—"}/${analiseDe(r).declCc || "—"}`)),
    corretos: unicos(g.itens.map(parCorreto)),
  };
}

/** Uma linha por código do produto, sem repetir os itens embaixo. */
function linhaGrupo(g, mostrarEmitente) {
  const r = resumoGrupo(g);
  const s = SELOS[g.status] || SELOS.revisar;
  const emit = mostrarEmitente && g.emitente ? `<b>${esc(g.emitente)}</b>` : "";
  const ncm = r.ncms.length === 1 ? esc(r.ncms[0]) : r.ncms.length ? `${r.ncms.length} NCMs` : "—";
  const par = (lista, plural) => {
    const texto = lista.length === 1 ? esc(lista[0]) : `${lista.length} ${plural}`;
    return `<span class="rotulo">CST / cClassTrib</span><span class="valor" title="${esc(
      lista.join(" · ")
    )}">${texto}</span>`;
  };
  return `<tr class="grupo-produto">
    <td class="origem">${emit}<div class="produto"><span class="cod-prod">${g.porNcm ? "NCM" : "código"} ${esc(
    g.codigo
  )}</span><span class="desc">${g.itens.length} ${g.itens.length === 1 ? "item" : "itens"}</span></div></td>
    <td class="num"><b>${ncm}</b><div class="produto"><span class="desc">${esc(r.desc) || "—"}</span></div></td>
    <td class="par">${par(r.declarados, "tributações")}</td>
    <td class="par">${par(r.corretos, "pares")}</td>
    <td><span class="selo ${s.classe}">${s.texto}</span></td>
  </tr>`;
}


/** Agrupa por emitente + código do produto (cProd); sem o código, por emitente + NCM. */
function agruparPorCodigo(lista) {
  const ordem = { div: 0, invalido: 1, revisar: 2, ok: 3, "sem-regra": 4 };
  const peso = (status) => ordem[status] ?? 9;
  const mapa = new Map();
  for (const r of lista) {
    const emitente = (r.emitente || "").trim();
    const codProd = (r.codProd || "").trim();
    const codigo = codProd || r.ncm || "—";
    const chave = `${norm(emitente)}|${codProd ? "c:" : "n:"}${codigo}`;
    let g = mapa.get(chave);
    if (!g) {
      g = { codigo, emitente, porNcm: !codProd, status: "ok", itens: [] };
      mapa.set(chave, g);
    }
    g.itens.push(r);
    const st = (r.analise || {}).status || "revisar";
    if (peso(st) < peso(g.status)) g.status = st;
  }
  return Array.from(mapa.values()).sort((x, y) => {
    const d = peso(x.status) - peso(y.status);
    if (d) return d;
    return String(x.codigo).localeCompare(String(y.codigo), "pt-BR", { numeric: true });
  });
}

/** Rola até o início da lista depois de trocar de página. */
function irParaTabela() {
  const el = document.querySelector("#resultados .tabela-wrap");
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Seletor do CST/cClassTrib correto quando o NCM tem mais de uma possibilidade. */
function selectCorreto(a, indice) {
  const e = a.principal || a.esperados[0];
  const opts = a.esperados
    .map((x) => {
      const sug = a.principalAuto && x.cc === a.principalAuto.cc ? " · sugestão" : "";
      return `<option value="${esc(x.cc)}"${x.cc === e.cc ? " selected" : ""}>${esc(x.cc)} (CST ${esc(x.cst)}${sug})</option>`;
    })
    .join("");
  return `<select class="escolha-cc" data-escolha="${indice}" aria-label="Escolher a tributação do item (${a.esperados.length} opções permitidas)">${opts}</select>`;
}

function linhaTabela(r, indice) {
  const i = indice;
  const a = r.analise || {};
  const s = SELOS[a.status] || SELOS.revisar;
  const desc = descricaoItem(r);
  const notaTxt = esc(contextoItem(r, { origem: false, data: true }));

  let correto = "";
  if (a.esperados && a.esperados.length) {
    const e = a.principal || a.esperados[0];
    if (a.esperados.length > 1) {
      correto = `<span class="rotulo">CST / cClassTrib</span>${selectCorreto(a, i)}${
        a.manual ? '<span class="escolha-nota">escolha manual</span>' : `<span class="rotulo">${a.esperados.length} opções</span>`
      }`;
    } else {
      correto = `<span class="rotulo">CST / cClassTrib</span><span class="valor">${esc(e.cst)} <span class="cc">${esc(e.cc)}</span></span>`;
    }
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
    <td class="num"><b>${esc(r.ncm || "—")}</b><div class="produto">${codigoProduto(r)}<span class="desc">${esc(desc) || "—"}</span></div></td>
    <td class="par"><span class="rotulo">CST / cClassTrib</span><span class="valor">${esc(a.declCst || "—")} <span class="cc">${esc(a.declCc || "—")}</span></span></td>
    <td class="par">${correto}</td>
    <td><span class="selo ${s.classe}">${s.texto}</span>${a.manual ? '<span class="selo info">ajustado</span>' : ""}${alerta}</td>
  </tr>`;
}

/* ------------------------------------------------------------------ */
/* detalhe                                                            */
/* ------------------------------------------------------------------ */

/** Chave do item entre uma conferência e outra (mesmo arquivo, chave/nota, item e NCM). */
const chaveEscolha = (r) => [r.origem, r.chave || "", r.nota || "", r.item || "", digitos(r.ncm)].join("|");

/** Guarda (ou apaga) a escolha manual para reaplicar quando a lista for conferida de novo. */
function lembrarEscolha(r) {
  const k = chaveEscolha(r);
  if (r.escolha) S.escolhas.set(k, r.escolha);
  else S.escolhas.delete(k);
}

/** Devolve as escolhas manuais aos itens recém-lidos do mesmo arquivo/nota/item. */
function reaplicarEscolhas(registros) {
  for (const r of registros) {
    const salva = S.escolhas.get(chaveEscolha(r));
    if (salva) r.escolha = salva;
  }
}

/** Define a tributação do item (escolha manual) ou volta à sugestão automática. */
function definirEscolha(indice, cc) {
  const r = S.registros[indice];
  if (!r) return;
  const auto = r.analise && r.analise.principalAuto;
  const cod = codigoPad(cc, 6);
  if (!cod || (auto && cod === auto.cc)) delete r.escolha;
  else r.escolha = cod;
  lembrarEscolha(r);
  r.analise = analisarItem(r);
  renderizar();
  resumoStatus();
  if ($("dlg").open) abrirDetalhe(indice);
}

/** Título da caixa "Correto" no detalhe do item. */
function tituloCorreto(a, opcoes) {
  if (a.manual) return `Escolhido entre ${opcoes.length} possibilidades`;
  if (a.status === "ok") return "Confirmado no item";
  if (opcoes.length > 1) return `Sugestão (1 de ${opcoes.length})`;
  return "Esperado para o NCM";
}

function abrirDetalhe(indice) {
  const r = S.registros[indice];
  if (!r) return;
  const a = r.analise || {};
  const regra = a.regra || { permitidos: [], vedados: [] };
  const desc = descNcm(r.ncm);
  const s = SELOS[a.status] || SELOS.revisar;
  const opcoes = a.esperados || [];
  const escolhidoCc = a.principal ? a.principal.cc : "";
  const autoCc = a.principalAuto ? a.principalAuto.cc : "";
  const podeEscolher = opcoes.length > 1;

  const candidatoCard = (c, vedado) => `
    <div class="candidato${vedado ? " vedado" : ""}${podeEscolher && !vedado && c.cc === escolhidoCc ? " escolhido" : ""}">
      <div class="topo-linha">
        <span class="cod">${esc(c.cc)}</span>
        <span class="cst">CST ${esc(c.cst)}</span>
        <span class="selo ${vedado ? "err" : "ok"}">${vedado ? "VEDADO" : "PERMITIDO"}</span>
        ${c.cc === a.declCc ? '<span class="selo info">Declarado</span>' : ""}
        ${podeEscolher && !vedado && a.manual && c.cc === escolhidoCc ? '<span class="selo ok">Escolhido</span>' : ""}
      </div>
      <p>${esc(c.nome)}</p>
      ${c.conds.map((x) => `<p class="cond">Condição: ${esc(x)}</p>`).join("")}
      <div class="tags">
        <span class="${num(c.redIbs) >= 100 ? "red" : ""}">Redução IBS ${pct(c.redIbs)}</span>
        <span class="${num(c.redCbs) >= 100 ? "red" : ""}">Redução CBS ${pct(c.redCbs)}</span>
        ${c.anexo ? `<span>Anexo ${esc(c.anexo)}</span>` : ""}
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Legislação</a>` : ""}
      </div>
      ${
        podeEscolher && !vedado
          ? `<div class="acoes">
              <button type="button" class="btn${c.cc === escolhidoCc && a.manual ? "" : " primario"}" data-usar="${indice}" data-cc="${esc(c.cc)}">${
                a.manual && c.cc === escolhidoCc ? "Manter esta tributação" : "Usar esta tributação"
              }</button>
              ${
                a.manual && c.cc === autoCc
                  ? `<button type="button" class="btn" data-usar="${indice}" data-cc="">Voltar à sugestão automática</button>`
                  : ""
              }
            </div>`
          : ""
      }
    </div>`;

  const declarado = `<div class="caixa ${a.status === "ok" ? "ok" : "err"}">
      <span class="titulo">Declarado no item</span>
      <div class="linha">CST ${esc(a.declCst || "—")} · cClassTrib ${esc(a.declCc || "—")}</div>
      <div class="nome">${esc(catNome(a.declCc) || (a.declCc ? "cClassTrib não localizado na base" : "sem cClassTrib"))}</div>
    </div>`;

  let correto;
  if (opcoes.length) {
    const e = a.principal || opcoes[0];
    const titulo = tituloCorreto(a, opcoes);
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

  let tituloRegras = regra.permitidos.length ? "Possibilidades permitidas para o NCM" : "Regra aplicada";
  let possibilidades;
  if (regra.falhou) {
    tituloRegras = "Regra indisponível";
    possibilidades = `<div class="candidatos"><div class="candidato">
      <p>Não foi possível consultar a regra deste NCM. A observação acima traz o motivo; tente conferir o arquivo novamente.</p>
    </div></div>`;
  } else if (regra.multiplosNcm && regra.multiplosNcm.length) {
    possibilidades = `<div class="candidatos"><div class="candidato">
      <p>O NCM informado está incompleto. Existem ${regra.multiplosNcm.length} NCMs na base começando com ${esc(regra.cod)}; informe os 8 dígitos para consultar a regra correta.</p>
    </div></div>`;
  } else if (regra.permitidos.length) {
    possibilidades = `<div class="candidatos">${regra.permitidos.map((c) => candidatoCard(c, false)).join("")}</div>`;
  } else {
    possibilidades = `<div class="candidatos"><div class="candidato">
      <div class="topo-linha"><span class="cod">000001</span><span class="cst">CST 000</span><span class="selo ok">PADRÃO</span></div>
      <p>O NCM não consta em nenhum anexo com tratamento específico. Aplica-se a tributação integral do IBS e da CBS.</p>
      <div class="tags"><span>Redução IBS 0%</span><span>Redução CBS 0%</span></div>
    </div></div>`;
  }

  // Os links oficiais vêm do rodapé, para não ficarem duplicados aqui.
  const href = (id) => {
    const el = $(id);
    return el ? el.href : "";
  };
  const fontes = { portal: href("linkPortal"), espelho: href("linkEspelho") };

  $("dlgTitulo").textContent = `NCM ${r.ncm || "—"} · ${r.nota ? "NF " + r.nota : r.origem}`;
  $("dlgCorpo").innerHTML = `
    <div class="dlg-produto">
      <div class="topo-linha">
        <span class="ncm">${esc(r.ncm || "—")}</span>
        <span class="selo ${s.classe}">${s.texto}</span>
      </div>
      <p>${esc(r.desc || desc) || "Sem descrição do produto."}</p>
      ${desc && r.desc ? `<p class="miudo">NCM: ${esc(desc)}</p>` : ""}
      <p class="miudo">${esc(r.origem)}${r.aba ? " · aba " + esc(r.aba) : ""}${
        r.nota ? " · NF " + esc(r.nota) + (r.serie ? "/" + esc(r.serie) : "") : ""
      }${r.item ? " · item " + esc(r.item) : ""}${r.chave ? " · chave " + esc(r.chave) : ""}</p>
    </div>

    <h3>Comparação</h3>
    <div class="duelo">${declarado}${correto}</div>
    <p class="nota-dlg">${esc(a.nota || "")}</p>
    ${alertas}

    <h3>${tituloRegras}${podeEscolher ? " — escolha a que se aplica a este item" : ""}</h3>
    ${possibilidades}

    ${
      regra.vedados && regra.vedados.length
        ? `<h3>Vedado para este NCM</h3><div class="candidatos">${regra.vedados
            .map((c) => candidatoCard(c, true))
            .join("")}</div>`
        : ""
    }

    <h3>Referências</h3>
    <p class="refs">
      <a href="${esc(fontes.portal)}" target="_blank" rel="noopener">Portal da Conformidade Fácil (SEFAZ-RS)</a>
      · <a href="${esc(fontes.espelho)}" target="_blank" rel="noopener">Consulta CST × cClassTrib</a>
    </p>
  `;
  $("dlgCorpo").querySelectorAll("[data-usar]").forEach((b) =>
    b.addEventListener("click", () => definirEscolha(Number(b.dataset.usar), b.dataset.cc || ""))
  );
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
    alvo.innerHTML = `<p class="vazio vazio-pad">Informe um NCM para consultar.</p>`;
    return;
  }

  const regra = regrasDoNcm(cod);
  const desc = descNcm(regra.chave || cod);

  if (regra.multiplosNcm && regra.multiplosNcm.length) {
    alvo.innerHTML = `<p class="ajuda ajuda-topo">${regra.multiplosNcm.length} NCMs começam com <b>${esc(cod)}</b>. Selecione:</p>
      <ul class="lista-arquivos lista-ncms">
        ${regra.multiplosNcm
          .slice(0, 200)
          .map((k) => {
            const rr = regrasDoNcm(k);
            const cc = rr.permitidos.map((p) => p.cc).join(", ") || "000001";
            return `<li><span class="tipo">NCM</span><button type="button" class="btn btn-link" data-ncm="${k}">${k}</button><span class="nome">${esc(descNcm(k))}</span><span class="tipo">${cc}</span></li>`;
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
    <p class="ajuda ajuda-topo"><b>NCM ${esc(regra.chave || cod)}</b> — ${esc(desc) || "descrição não disponível"}</p>
    <div class="candidatos">${cards}</div>
    ${regra.vedados.length ? `<p class="ajuda ajuda-fim">Vedado: ${regra.vedados.map((v) => esc(v.cc)).join(", ")}</p>` : ""}
    ${regra.permitidos.length > 1 ? `<p class="ajuda ajuda-fim">Há mais de uma possibilidade: a escolha depende da condição de uso do produto.</p>` : ""}
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
    "Origem", "Emitente", "Aba", "Nota", "Série", "Item", "Código do produto", "NCM", "Descrição do produto",
    "Valor do item", "CST decl.", "cClassTrib decl.", "CST correto", "cClassTrib correto",
    "Situação", "Redução IBS", "Redução CBS", "Observação",
  ];
}

function linhaExport(r) {
  const a = r.analise || {};
  const e = a.principal || (a.esperados && a.esperados[0]);
  return [
    r.origem, r.emitente || "", r.aba || "", r.nota || "", r.serie || "", r.item || "", r.codProd || "", r.ncm || "",
    descricaoItem(r) || "",
    num(r.valor) ? num(r.valor) : "",
    a.declCst || "", a.declCc || "",
    e ? e.cst : "", e ? e.cc : "",
    (SELOS[a.status] || SELOS.revisar).texto,
    e ? pct(e.redIbs) : "", e ? pct(e.redCbs) : "",
    [a.nota, ...(a.alertas || [])].filter(Boolean).join(" | "),
  ];
}

/** Célula do CSV pronta para o Excel: aspas dobradas e, em texto que o Excel abriria
 *  como fórmula (=, +, -, @), um apóstrofo na frente (o Excel não o exibe). */
function celulaCsv(c) {
  let s = c == null ? "" : String(c);
  if (typeof c === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function exportarCsv() {
  const produto = S.visao === "produto";
  const dados = produto ? [cabecalhoProduto(), ...gruposExport()] : [cabecalho(), ...S.registros.map(linhaExport)];
  const csv = dados.map((linha) => linha.map(celulaCsv).join(";")).join("\r\n");
  baixar(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), nomeArquivo("csv"));
}

/** Sufixo do nome do arquivo conforme a visão escolhida. */
const sufixoVisao = () => (S.visao === "produto" ? "Por Código" : "Todos os Itens");

const nomeArquivo = (ext) => `${nomeBase()} - ${sufixoVisao()}.${ext}`;

/** Cabeçalho da exportação da visão "Por código do produto": uma linha por produto. */
function cabecalhoProduto() {
  return [
    "Emitente", "Código do produto", "NCM", "Descrição do produto", "Itens", "Valor total",
    "CST/cClassTrib declarados", "CST/cClassTrib corretos", "Situação",
  ];
}

/** Uma linha por produto (emitente + código), sem repetir o código. */
function linhaGrupoExport(g) {
  const r = resumoGrupo(g);
  const total = g.itens.reduce((s, x) => s + num(x.valor), 0);
  return [
    g.emitente || "",
    g.codigo,
    r.ncms.join(", "),
    r.desc,
    g.itens.length,
    Math.round(total * 100) / 100,
    r.declarados.join(", "),
    r.corretos.join(", "),
    (SELOS[g.status] || SELOS.revisar).texto,
  ];
}

function gruposExport() {
  return agruparPorCodigo(S.registros).map(linhaGrupoExport);
}

function exportarXlsx() {
  const wb = XLSX.utils.book_new();
  if (S.visao === "produto") {
    const dados = [cabecalhoProduto(), ...gruposExport()];
    const ws = XLSX.utils.aoa_to_sheet(dados);
    ws["!cols"] = [
      { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 42 }, { wch: 8 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 18 },
    ];
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dados.length - 1, c: dados[0].length - 1 } }),
    };
    XLSX.utils.book_append_sheet(wb, ws, "Por código");
    XLSX.writeFile(wb, nomeArquivo("xlsx"));
    return;
  }

  const todos = S.registros;
  const ws = XLSX.utils.aoa_to_sheet([cabecalho(), ...todos.map(linhaExport)]);
  ws["!cols"] = [
    { wch: 28 }, { wch: 30 }, { wch: 12 }, { wch: 9 }, { wch: 7 }, { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 42 },
    { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 18 }, { wch: 11 }, { wch: 11 },
    { wch: 70 },
  ];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: todos.length, c: cabecalho().length - 1 } }) };

  XLSX.utils.book_append_sheet(wb, ws, "Conferência");

  // Planilha para redigitação: só preenche quando a correção é inequívoca.
  const correcao = [
    ["Origem", "Emitente", "Nota", "Item", "Código do produto", "NCM", "Descrição", "CST IBS/CBS", "cClassTrib", "Situação", "Observação"],
  ];
  for (const r of todos) {
    const a = r.analise || {};
    const opcoesArr = a.esperados || [];
    // Correção inequívoca: NCM com uma única opção, ou opção escolhida manualmente.
    let e = null;
    if (a.manual) e = a.principal;
    else if (opcoesArr.length === 1) e = opcoesArr[0];
    const corrigivel = e && a.status === "div";
    const opcoes = opcoesArr.map((x) => x.cc).join(", ");
    let observacao;
    if (corrigivel) observacao = a.manual ? a.nota || `Corrigido para ${e.cst}/${e.cc}.` : `Corrigido para ${e.cst}/${e.cc}. ${a.nota || ""}`.trim();
    else if (a.status === "ok" || a.status === "sem-regra") observacao = "Sem alteração.";
    else if (a.status === "invalido") observacao = "NCM inválido: não foi possível determinar o CST/cClassTrib.";
    else observacao = `Não corrigido automaticamente. ${a.nota || ""}${opcoes ? " Opções: " + opcoes + "." : ""}`.trim();

    correcao.push([
      r.origem, r.emitente || "", r.nota || "", r.item || "", r.codProd || "", r.ncm || "", descricaoItem(r) || "",
      corrigivel ? e.cst : a.declCst || "",
      corrigivel ? e.cc : a.declCc || "",
      (SELOS[a.status] || SELOS.revisar).texto,
      observacao,
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(correcao);
  ws2["!cols"] = [
    { wch: 28 }, { wch: 30 }, { wch: 9 }, { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 42 }, { wch: 12 }, { wch: 12 },
    { wch: 18 }, { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Corrigida");

  XLSX.writeFile(wb, nomeArquivo("xlsx"));
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
/* impressao                                                           */
/* ------------------------------------------------------------------ */

const ROTULO_FILTRO = {
  todos: "Todos",
  div: "Divergentes",
  revisar: "Revisar",
  ok: "Conformes",
  "sem-regra": "Integral (sem regra)",
  alerta: "Alerta de valor",
  ajustados: "Ajustados",
};

let tituloOriginal = "";

/** Preenche a área de impressão com TODOS os itens filtrados (não só a página atual). */
function prepararImpressao() {
  const area = $("areaImpressao");
  if (!area || !S.registros.length) return;
  // O navegador usa o título como nome do PDF; ele volta ao normal em limparImpressao.
  if (!tituloOriginal) tituloOriginal = document.title;
  document.title = `${nomeBase()} - ${sufixoVisao()}`;
  const filtrados = S.registros.filter(registroFiltrado);
  const meta = [
    `Base ${$("metaSnapshot") ? $("metaSnapshot").textContent : ""}`.trim(),
    `Filtro: ${ROTULO_FILTRO[S.filtro] || "Todos"}${S.busca ? ` · busca "${S.busca}"` : ""} · ${filtrados.length} de ${S.registros.length} item(ns)`,
    `Visualização: ${S.visao === "produto" ? "por código do produto" : "todos os itens"}`,
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
  ].join(" · ");
  const corpo = S.visao === "produto" ? impressaoProdutos(filtrados) : impressaoItens(filtrados);
  area.innerHTML = `<h1>Conferência IBS/CBS — NCM × CST × cClassTrib</h1><p class="meta">${esc(meta)}</p>${corpo}`;
}

function limparImpressao() {
  const area = $("areaImpressao");
  if (area) area.innerHTML = "";
  if (tituloOriginal) {
    document.title = tituloOriginal;
    tituloOriginal = "";
  }
}

function impressaoItens(lista) {
  if (!lista.length) return '<p class="meta">Nenhum item para este filtro.</p>';
  return `<table class="imp-tabela">
    <thead><tr><th>Origem / nota</th><th>NCM e produto</th><th>Declarado</th><th>Correto</th><th>Situação</th></tr></thead>
    <tbody>${lista.map(linhaImpressao).join("")}</tbody>
  </table>`;
}

function impressaoProdutos(lista) {
  const grupos = agruparPorCodigo(lista);
  if (!grupos.length) return '<p class="meta">Nenhum item para este filtro.</p>';
  // Mesma regra da tela: o emitente só aparece quando o lote tem mais de um.
  const multi = new Set(lista.map((r) => r.emitente).filter(Boolean)).size > 1;
  const pares = (lista) => lista.map((x) => esc(x)).join("<br>");
  const linhas = grupos
    .map((g) => {
      const r = resumoGrupo(g);
      const s = SELOS[g.status] || SELOS.revisar;
      const ncm = r.ncms.length === 1 ? esc(r.ncms[0]) : r.ncms.length ? `${r.ncms.length} NCMs` : "—";
      const emit = multi && g.emitente ? `${esc(g.emitente)} · ` : "";
      return `<tr>
        <td><b>${emit}${g.porNcm ? "NCM" : "código"} ${esc(g.codigo)}</b><br>${g.itens.length} item(ns)</td>
        <td>${ncm}<br>${esc(r.desc) || "—"}</td>
        <td class="imp-num">${pares(r.declarados)}</td>
        <td class="imp-num">${pares(r.corretos)}</td>
        <td>${s.texto}</td>
      </tr>`;
    })
    .join("");
  return `<table class="imp-tabela">
    <thead><tr><th>${multi ? "Emitente / código" : "Código do produto"}</th><th>NCM e produto</th><th>Declarado</th><th>Correto</th><th>Situação</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>`;
}

function linhaImpressao(r) {
  const a = r.analise || {};
  const s = SELOS[a.status] || SELOS.revisar;
  const desc = descricaoItem(r);
  const p = a.principal || (a.esperados && a.esperados[0]) || null;
  const correto = p ? `${esc(p.cst)} / ${esc(p.cc)}${a.manual ? " (escolha manual)" : ""}` : "—";
  const nota = esc(contextoItem(r, { data: true }));
  return `<tr>
    <td>${nota}</td>
    <td><b>${esc(r.ncm || "—")}</b> ${codigoProduto(r)}<br>${esc(desc) || "—"}</td>
    <td class="imp-num">${esc(a.declCst || "—")} / ${esc(a.declCc || "—")}</td>
    <td class="imp-num">${correto}</td>
    <td>${s.texto}</td>
  </tr>`;
}

/* ------------------------------------------------------------------ */
/* arquivos                                                           */
/* ------------------------------------------------------------------ */

const EXT_OK = ["xml", "xlsx", "xls", "csv"];
const EXT_PACOTE = ["zip", "rar"];
const TIPO_MIME = {
  xml: "text/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};
/* Limite só por bytes (o que de fato pesa na memória). Contar arquivos barrava
 * lotes legítimos de XML pequenos: 3.635 NFC-e = 31 MB e ~75 MB de heap. */
const LIMITE_PACOTE_BYTES = 300 * 1024 * 1024;

function extensao(nome) {
  return (String(nome || "").split(".").pop() || "").toLowerCase();
}

function caminhoLimpo(nome) {
  return String(nome || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Entrada que interessa dentro de pasta/compactado, ignorando lixo do sistema. */
function entradaUtil(nome) {
  const caminho = caminhoLimpo(nome);
  if (!caminho || caminho.endsWith("/")) return false;
  if (/(^|\/)__MACOSX(\/|$)/.test(caminho)) return false;
  const base = caminho.split("/").pop();
  if (!base || base.startsWith(".") || base.startsWith("~$")) return false;
  return EXT_OK.includes(extensao(base));
}

function extensaoAceita(nome) {
  const ext = extensao(nome);
  return EXT_OK.includes(ext) || EXT_PACOTE.includes(ext);
}

/** Cria um File a partir dos bytes extraídos, mantendo o caminho interno como nome. */
function arquivoDeBytes(bytes, nome, pacote) {
  const caminho = caminhoLimpo(nome);
  const f = new File([bytes], caminho, {
    type: TIPO_MIME[extensao(caminho)] || "application/octet-stream",
  });
  if (pacote) Object.defineProperty(f, "pacote", { value: pacote, enumerable: false });
  return f;
}

/** Mantém o caminho relativo como nome (pasta escolhida/arrastada), para não perder a origem. */
function comCaminho(f, caminho) {
  const nome = caminhoLimpo(caminho);
  if (!nome || nome === f.name) return f;
  try {
    return new File([f], nome, { type: f.type, lastModified: f.lastModified });
  } catch (_) {
    return f;
  }
}

/** Erro marcado para o limite de tamanho, para não virar "arquivo corrompido". */
function erroLimite(rotulo) {
  const mb = LIMITE_PACOTE_BYTES / (1024 * 1024);
  const e = new Error(`o ${rotulo} passa de ${mb} MB depois de descompactado`);
  e.limite = true;
  return e;
}

async function descompactarZip(file) {
  const fflate = window.fflate;
  if (!fflate || typeof fflate.unzipSync !== "function") {
    throw new Error("o descompactador de ZIP não foi carregado; recarregue a página");
  }
  // O limite é conferido no filter, com o tamanho descompactado declarado em cada
  // entrada: conferir depois do unzipSync já teria inflado o pacote inteiro.
  let total = 0;
  let entradas;
  try {
    const dados = new Uint8Array(await file.arrayBuffer());
    entradas = fflate.unzipSync(dados, {
      filter: (e) => {
        if (!entradaUtil(e.name)) return false;
        total += e.originalSize;
        if (total > LIMITE_PACOTE_BYTES) throw erroLimite("ZIP");
        return true;
      },
    });
  } catch (e) {
    if (e && e.limite) throw e;
    throw new Error("ZIP inválido, corrompido ou protegido por senha");
  }
  return Object.entries(entradas).map(([nome, bytes]) => arquivoDeBytes(bytes, nome, file.name));
}

let unrarPronto = null;

/** Carrega o unrar (wasm) só na primeira vez que aparece um RAR. */
function carregarUnrar() {
  if (!unrarPronto) {
    unrarPronto = (async () => {
      const modulo = await import(
        new URL(`assets/vendor/unrar/index.esm.js?v=${VERSAO}`, document.baseURI).href
      );
      const resposta = await fetch(
        new URL(`assets/vendor/unrar/unrar.wasm?v=${VERSAO}`, document.baseURI).href
      );
      if (!resposta.ok) throw new Error("não foi possível baixar o descompactador de RAR");
      return { modulo, wasmBinary: await resposta.arrayBuffer() };
    })().catch((e) => {
      unrarPronto = null;
      throw e;
    });
  }
  return unrarPronto;
}

const MOTIVOS_RAR = {
  ERAR_MISSING_PASSWORD: "RAR protegido por senha",
  ERAR_BAD_PASSWORD: "RAR protegido por senha (senha incorreta)",
  ERAR_BAD_ARCHIVE: "não é um arquivo RAR válido",
  ERAR_UNKNOWN_FORMAT: "formato de RAR não suportado",
  ERAR_BAD_DATA: "RAR corrompido",
  ERAR_EREAD: "RAR corrompido ou incompleto",
  ERAR_EOPEN: "não foi possível abrir o RAR",
  ERAR_NO_MEMORY: "memória insuficiente para descompactar o RAR",
};

function mensagemRar(e) {
  if (e && MOTIVOS_RAR[e.reason]) return MOTIVOS_RAR[e.reason];
  return (e && e.message) || "não foi possível descompactar o RAR";
}

async function descompactarRar(file) {
  const { modulo, wasmBinary } = await carregarUnrar();
  let extrator;
  try {
    extrator = await modulo.createExtractorFromData({ wasmBinary, data: await file.arrayBuffer() });
  } catch (e) {
    throw new Error(mensagemRar(e));
  }
  const saida = [];
  let total = 0;
  let concluido = false;
  try {
    const { files } = extrator.extract({
      files: (h) => {
        if (h.flags.directory || !entradaUtil(h.name)) return false;
        total += h.unpSize;
        if (total > LIMITE_PACOTE_BYTES) throw erroLimite("RAR");
        return true;
      },
    });
    for (const item of files) {
      saida.push(arquivoDeBytes(item.extraction, item.fileHeader.name, file.name));
    }
    concluido = true;
  } catch (e) {
    if (e && e.limite) throw e;
    throw new Error(mensagemRar(e));
  } finally {
    if (!concluido && extrator && typeof extrator.closeArc === "function") {
      try {
        extrator.closeArc();
      } catch (_) {
        /* ignore */
      }
    }
  }
  return saida;
}

function adicionarNaLista(novo) {
  if (S.arquivos.some((x) => x.name === novo.name && x.size === novo.size)) return false;
  S.arquivos.push(novo);
  return true;
}

async function adicionarArquivos(lista) {
  const arquivos = Array.from(lista || []);
  if (!arquivos.length) return;

  const simples = [];
  const pacotes = [];
  for (const bruto of arquivos) {
    const f = comCaminho(bruto, bruto.webkitRelativePath || "");
    const ext = extensao(f.name);
    if (EXT_OK.includes(ext)) simples.push(f);
    else if (EXT_PACOTE.includes(ext)) pacotes.push(f);
  }

  let adicionados = 0;
  for (const f of simples) if (adicionarNaLista(f)) adicionados++;

  const avisos = [];
  const erros = [];
  if (pacotes.length) {
    S.descompactando = true;
    renderArquivos();
    try {
      for (const pacote of pacotes) {
        mostrarStatus(`Descompactando ${pacote.name}…`, "carregando");
        await tick();
        try {
          const extraidos =
            extensao(pacote.name) === "zip" ? await descompactarZip(pacote) : await descompactarRar(pacote);
          for (const f of extraidos) if (adicionarNaLista(f)) adicionados++;
          avisos.push(
            extraidos.length
              ? `${pacote.name}: ${extraidos.length} arquivo(s)`
              : `${pacote.name}: nenhum XML ou planilha dentro`
          );
        } catch (e) {
          erros.push(`${pacote.name}: ${e.message}`);
        }
      }
    } finally {
      S.descompactando = false;
    }
  }

  renderArquivos();
  if (erros.length) mostrarStatus(erros.join(" | "), "erro");
  else if (avisos.length) mostrarStatus(`${avisos.join(" · ")}. ${S.arquivos.length} arquivo(s) na lista.`, "ok");
  else if (!adicionados && S.arquivos.length) mostrarStatus("Os arquivos selecionados já estavam na lista.", "ok");
  else if (!adicionados) {
    mostrarStatus("Nenhum arquivo compatível foi selecionado. Envie XML, XLSX, XLS, CSV, ZIP ou RAR.", "erro");
  }
}

/** Percorre uma entrada arrastada (pasta ou arquivo) e devolve os File compatíveis. */
async function lerEntrada(entrada) {
  if (!entrada) return [];
  if (entrada.isFile) {
    if (!extensaoAceita(entrada.name)) return [];
    const arquivo = await new Promise((res) => entrada.file((f) => res(f || null), () => res(null)));
    return arquivo ? [comCaminho(arquivo, entrada.fullPath || arquivo.name)] : [];
  }
  if (!entrada.isDirectory) return [];
  const leitor = entrada.createReader();
  const saida = [];
  while (true) {
    const lote = await new Promise((res) => leitor.readEntries((e) => res(e || []), () => res([])));
    if (!lote.length) break;
    for (const item of lote) saida.push(...(await lerEntrada(item)));
  }
  return saida;
}

async function arquivosDoTransfer(dt) {
  const itens = dt && dt.items ? Array.from(dt.items) : [];
  const entradas = itens
    .filter((i) => i.kind === "file" && typeof i.webkitGetAsEntry === "function")
    .map((i) => {
      try {
        return i.webkitGetAsEntry();
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  if (!entradas.length) return dt && dt.files ? Array.from(dt.files) : [];
  const listas = await Promise.all(entradas.map(lerEntrada));
  const arquivos = listas.reduce((acc, l) => acc.concat(l), []);
  if (arquivos.length) return arquivos;
  return dt && dt.files ? Array.from(dt.files) : [];
}

function renderArquivos() {
  const ul = $("listaArquivos");
  ul.hidden = !S.arquivos.length;
  ul.innerHTML = S.arquivos
    .map(
      (f, i) => `<li>
        <span class="tipo">${esc((f.name.split(".").pop() || "").toUpperCase())}</span>
        <span class="nome" title="${esc(f.pacote ? `${f.name} (de ${f.pacote})` : f.name)}">${esc(f.name)}</span>
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
  $("btnProcessar").disabled = !S.arquivos.length || S.processando || S.descompactando;
  $("btnLimpar").disabled = !S.arquivos.length && !S.registros.length;
}


/* ------------------------------------------------------------------ */
/* eventos                                                            */
/* ------------------------------------------------------------------ */

function iniciar() {
  const zona = $("zona");
  const input = $("arquivos");
  const inputPasta = $("arquivosPasta");

  input.addEventListener("change", () => {
    const lista = Array.from(input.files || []);
    input.value = "";
    adicionarArquivos(lista);
  });

  $("btnPasta").addEventListener("click", () => inputPasta.click());

  inputPasta.addEventListener("change", () => {
    const lista = Array.from(inputPasta.files || []);
    inputPasta.value = "";
    adicionarArquivos(lista);
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
  zona.addEventListener("drop", async (e) => {
    if (!e.dataTransfer) return;
    mostrarStatus("Lendo os arquivos arrastados…", "carregando");
    const lista = await arquivosDoTransfer(e.dataTransfer);
    await adicionarArquivos(lista);
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
    S.escolhas.clear();
    S.errosLeitura = [];
    S.falhasAnalise = [];
    S.filtro = "todos";
    S.busca = "";
    S.pagina = 1;
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

  // Rodapé: copiar a chave Pix / a invoice Lightning e revelar o valor completo.
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const alvo = $(btn.dataset.copy);
      if (!alvo) return;
      const texto = (alvo.getAttribute("data-full") || alvo.textContent || "").trim();
      if (!texto) return;
      try {
        await navigator.clipboard.writeText(texto);
        btn.textContent = "Copiado!";
        setTimeout(() => {
          btn.textContent = "Copiar";
        }, 1500);
      } catch {
        mostrarStatus(
          "O navegador não permitiu copiar automaticamente. Use “ver chave completa” e copie o texto com Ctrl+C.",
          "erro"
        );
      }
    });
  });

  document.querySelectorAll("[data-reveal]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const alvo = $(link.dataset.reveal);
      if (!alvo) return;
      const completo = alvo.getAttribute("data-full") || "";
      if (!alvo.getAttribute("data-short")) alvo.setAttribute("data-short", alvo.textContent);
      const curto = alvo.getAttribute("data-short");
      const mostrando = alvo.textContent === completo;
      alvo.textContent = mostrando ? curto : completo;
      link.textContent = mostrando ? link.dataset.rotulo || "ver completo" : "ocultar";
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("ncmManual").focus();
    }
  });

  // Impressão: monta a lista completa (todas as páginas) antes de imprimir.
  window.addEventListener("beforeprint", prepararImpressao);
  window.addEventListener("afterprint", limparImpressao);

  renderArquivos();
  carregarBase();
}

document.addEventListener("DOMContentLoaded", iniciar);
