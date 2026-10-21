# -*- coding: utf-8 -*-
"""Atualiza a base local (data/*.json) a partir do portal oficial ou de um JSON.

Formas de uso:
  python scripts/atualizar_base.py
      Usa o snapshot do site irmao ../cst-cclasstrib-site/data/classificacao-tributaria.json

  python scripts/atualizar_base.py portal.html
      Extrai o dataset embutido (var dadosOriginais) da pagina oficial salva.

  python scripts/atualizar_base.py classificacao-tributaria.json
      Usa um snapshot JSON ja extraido.

  python scripts/atualizar_base.py https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria
      Baixa a pagina oficial e extrai o dataset.

Depois de atualizar, confira `python scripts/test_dados.py` e suba os arquivos.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
SNAPSHOT_IRMAO = os.path.join(
    os.path.dirname(REPO), "cst-cclasstrib-site", "data", "classificacao-tributaria.json"
)


def extrair_dataset(html: str):
    marcador = "var dadosOriginais = "
    idx = html.find(marcador)
    if idx < 0:
        raise SystemExit("dataset 'var dadosOriginais' nao encontrado no HTML")
    inicio = idx + len(marcador)
    if html[inicio] != "[":
        raise SystemExit("inicio do dataset inesperado")
    profundidade, em_string, escape, fim = 0, False, False, None
    for i in range(inicio, len(html)):
        ch = html[i]
        if em_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                em_string = False
        elif ch == '"':
            em_string = True
        elif ch == "[":
            profundidade += 1
        elif ch == "]":
            profundidade -= 1
            if profundidade == 0:
                fim = i + 1
                break
    if not fim:
        raise SystemExit("nao foi possivel encontrar o fim do dataset")
    return json.loads(html[inicio:fim])


def carregar(origem: str):
    if origem.startswith("http://") or origem.startswith("https://"):
        req = urllib.request.Request(origem, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        return extrair_dataset(html)

    with open(origem, encoding="utf-8") as fh:
        texto = fh.read()

    if origem.lower().endswith(".json"):
        return json.loads(texto)
    return extrair_dataset(texto)


def main() -> int:
    origem = sys.argv[1] if len(sys.argv) > 1 else SNAPSHOT_IRMAO
    if not origem.startswith("http") and not os.path.exists(origem):
        print(f"ERRO: arquivo nao encontrado: {origem}")
        print("Informe o portal.html, o JSON do snapshot ou uma URL.")
        return 1

    print(f"Lendo {origem} ...")
    dados = carregar(origem)
    if not isinstance(dados, list) or not dados:
        print("ERRO: dataset vazio ou em formato inesperado.")
        return 1

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(dados, tmp, ensure_ascii=False)
        caminho_tmp = tmp.name

    try:
        os.makedirs(DATA, exist_ok=True)
        # O site usa apenas os arquivos derivados; o snapshot completo nao vai para o repositorio.
        return subprocess.call([sys.executable, os.path.join(REPO, "scripts", "gerar_dados.py"), caminho_tmp])
    finally:
        os.unlink(caminho_tmp)


if __name__ == "__main__":
    raise SystemExit(main())
