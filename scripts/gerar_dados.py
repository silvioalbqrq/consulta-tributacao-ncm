# -*- coding: utf-8 -*-
"""Gera a base local do site de conferencia NCM x CST x cClassTrib.

Entrada: snapshot `classificacao-tributaria.json` do site irmao
cst-cclasstrib-site (dados do Portal da Conformidade Facil / SEFAZ-RS).

Saidas:
  data/cst-cclasstrib.json  catalogo de CST e cClassTrib (enxuto)
  data/ncm-regras.json      indice reverso NCM -> variantes (cClassTrib)
  data/ncm-descricoes.json  descricoes hierarquicas da NCM (copia)

Uso:
  python scripts/gerar_dados.py [caminho/classificacao-tributaria.json]
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PADRAO = os.path.join(
    os.path.dirname(REPO), "cst-cclasstrib-site", "data", "classificacao-tributaria.json"
)

CST_CAMPOS = [
    "Cst", "NomeCst", "IndExigeTrib", "IndReducaoBc", "IndReducaoAliq",
    "IndTransferenciaCred", "IndDiferimento", "IndMonofasica",
    "IndCredPresIbsZfm", "IndAjusteCompet", "DthIniVig", "DthFimVig",
]

CC_CAMPOS = [
    "CodClassTrib", "Cst", "NomeClassTrib", "NomeReduzido", "TipoAliq",
    "PercRedIbs", "PercRedCbs", "IndTribRegular", "IndPermiteCredPres",
    "IndEstornoCred", "NroAnexo", "TexUrlLegislacao",
    "DthIniVig", "DthFimVig",
]

# Campos repetidos em cada vinculo; guardados em pool para o JSON ficar pequeno.
VARIANTE_CAMPOS = [
    "DescCondicao", "DescExcecao", "Observacao", "NroAnexo", "NroItemAnexoLei",
    "DescItemAnexo", "DescAnexo", "DthIniVig", "DthFimVig",
]


def enxuto(obj, campos):
    return {k: obj.get(k) for k in campos if obj.get(k) is not None}


def main() -> int:
    origem = sys.argv[1] if len(sys.argv) > 1 else PADRAO
    if not os.path.exists(origem):
        print(f"ERRO: snapshot nao encontrado: {origem}")
        return 1

    with open(origem, encoding="utf-8") as fh:
        bruto = json.load(fh)

    csts = []
    classificacoes = {}
    variantes = {}          # chave -> dict enxuto
    ncm_regras = {}         # NCM -> [[cc, perm, variante_id], ...]
    total_vinculos = 0
    codigos_com_ncm = set()

    def id_variante(dados):
        chave = json.dumps(dados, ensure_ascii=False, sort_keys=True)
        vid = variantes.get(chave)
        if vid is None:
            vid = len(variantes) + 1
            variantes[chave] = vid
        return vid

    for pai in bruto:
        csts.append(enxuto(pai, CST_CAMPOS))
        for filho in pai.get("ClassificacoesTributarias", []):
            cod = filho.get("CodClassTrib")
            if not cod:
                continue
            item = enxuto(filho, CC_CAMPOS)
            item["Cst"] = filho.get("Cst") or pai.get("Cst")
            classificacoes[cod] = item

            for anexo in filho.get("Anexos") or []:
                if (anexo.get("TipoCodigo") or "").upper() != "NCM":
                    continue
                ncm = "".join(ch for ch in str(anexo.get("CodNcmNbs") or "") if ch.isdigit())
                if not ncm:
                    continue
                dados = enxuto(anexo, VARIANTE_CAMPOS)
                vid = id_variante(dados)
                regra = [cod, anexo.get("TipoPermissao") or "PERMITIDO", vid]
                ncm_regras.setdefault(ncm, []).append(regra)
                total_vinculos += 1
                codigos_com_ncm.add(cod)

    # Ordena e remove duplicidades exatas dentro de cada NCM.
    for ncm, regras in ncm_regras.items():
        vistas = set()
        limpas = []
        for regra in regras:
            chave = tuple(regra)
            if chave in vistas:
                continue
            vistas.add(chave)
            limpas.append(regra)
        limpas.sort(key=lambda r: (r[0], r[1]))
        ncm_regras[ncm] = limpas

    # Pool invertido: id -> dados
    pool = {}
    for chave, vid in variantes.items():
        pool[str(vid)] = json.loads(chave)

    hoje = dt.date.today().isoformat()
    meta = {
        "geradoEm": hoje,
        "fonte": "https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria",
        "espelho": "https://silvioalbqrq.github.io/cst-cclasstrib/",
        "snapshot": "IT 2025.002 v1.70",
        "ncmComRegra": len(ncm_regras),
        "vinculos": total_vinculos,
        "cClassTribComNcm": len(codigos_com_ncm),
        "cClassTribTotal": len(classificacoes),
    }

    out_dir = os.path.join(REPO, "data")
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "cst-cclasstrib.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"meta": meta, "csts": csts, "classificacoes": classificacoes},
            fh, ensure_ascii=False, separators=(",", ":"),
        )

    with open(os.path.join(out_dir, "ncm-regras.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"meta": meta, "variantes": pool, "ncm": dict(sorted(ncm_regras.items()))},
            fh, ensure_ascii=False, separators=(",", ":"),
        )

    desc_destino = os.path.join(out_dir, "ncm-descricoes.json")
    candidatos_desc = [
        os.path.join(os.path.dirname(origem), "ncm-descricoes.json"),
        os.path.join(os.path.dirname(REPO), "cst-cclasstrib-site", "data", "ncm-descricoes.json"),
    ]
    for desc_origem in candidatos_desc:
        if os.path.exists(desc_origem) and os.path.abspath(desc_origem) != os.path.abspath(desc_destino):
            shutil.copyfile(desc_origem, desc_destino)
            break

    print("OK ->", out_dir)
    print(f"  CSTs: {len(csts)} | cClassTrib: {len(classificacoes)}")
    print(f"  NCMs com regra: {len(ncm_regras)} | vinculos: {total_vinculos}")
    print(f"  variantes: {len(pool)}")
    for nome in ("cst-cclasstrib.json", "ncm-regras.json", "ncm-descricoes.json"):
        caminho = os.path.join(out_dir, nome)
        if os.path.exists(caminho):
            print(f"  {nome}: {os.path.getsize(caminho) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
