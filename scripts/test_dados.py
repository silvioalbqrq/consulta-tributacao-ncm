# -*- coding: utf-8 -*-
"""Regressao dos dados gerados. Rode depois de gerar_dados.py / atualizar_base.py.

Uso: python scripts/test_dados.py
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")

falhas = []


def checar(cond, msg):
    if cond:
        print(f"  ok  {msg}")
    else:
        falhas.append(msg)
        print(f"  FALHA  {msg}")


def carregar(nome):
    with open(os.path.join(DATA, nome), encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    cat = carregar("cst-cclasstrib.json")
    regras = carregar("ncm-regras.json")

    print("Estrutura")
    checar(isinstance(cat.get("csts"), list) and len(cat["csts"]) >= 18, "catalogo com 18 CSTs")
    checar(len(cat["classificacoes"]) >= 150, f"cClassTrib no catalogo: {len(cat['classificacoes'])}")
    checar(len(regras["ncm"]) >= 1500, f"NCMs com regra: {len(regras['ncm'])}")
    checar(len(regras["variantes"]) >= 100, f"variantes de anexo: {len(regras['variantes'])}")

    print("Caso de referencia (tapioca)")
    ref = regras["ncm"].get("19030000")
    checar(ref is not None, "NCM 19030000 presente na base")
    if ref:
        permitidos = [r for r in ref if r[1] != "VEDADO"]
        checar(len(permitidos) == 1, "19030000 tem exatamente 1 cClassTrib permitido")
        cc = permitidos[0][0]
        checar(cc == "200003", f"19030000 -> cClassTrib 200003 (obtido {cc})")
        checar(cat["classificacoes"][cc]["Cst"] == "200", "200003 pertence ao CST 200")
        checar(cat["classificacoes"][cc]["PercRedIbs"] == 100.0, "200003 reduz 100% do IBS")

    print("Multiplas possibilidades (arroz)")
    arroz = {r[0] for r in regras["ncm"].get("10062010", []) if r[1] != "VEDADO"}
    checar("200003" in arroz, "10062010 inclui 200003 (cesta basica)")
    checar("200034" not in arroz, "200034 esta vedado para 10062010")

    print("Integridade dos vinculos")
    orfaos = 0
    cst_divergente = 0
    for ncm, refs in regras["ncm"].items():
        for cc, perm, vid in refs:
            item = cat["classificacoes"].get(cc)
            if not item:
                orfaos += 1
                continue
            if item.get("Cst") not in {c["Cst"] for c in cat["csts"]}:
                cst_divergente += 1
    checar(orfaos == 0, f"referencias sem catalogo: {orfaos}")
    checar(cst_divergente == 0, f"CST invalido em cClassTrib: {cst_divergente}")
    checar(all(len(n) == 8 and n.isdigit() for n in regras["ncm"]), "todos os NCMs com 8 digitos")

    print("Descricoes NCM")
    desc = carregar("ncm-descricoes.json")
    checar(bool(desc.get("i")), "ncm-descricoes.json com itens")
    checar("19030000" in desc.get("i", {}), "descricao do 19030000 presente")

    if falhas:
        print(f"\n{len(falhas)} falha(s).")
        return 1
    print("\nTudo certo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
