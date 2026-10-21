# Conferência IBS/CBS — NCM × CST × cClassTrib

Site estático para **conferir a tributação de IBS e CBS** de itens de NF-e/NFC-e ou de
uma planilha. Para cada item, o NCM é cruzado com a base oficial de classificação
tributária e o site mostra:

- o **CST** e o **cClassTrib** esperados para o NCM;
- se o par informado no arquivo está **conforme**, **divergente** ou precisa de **revisão**;
- todas as possibilidades **permitidas** e as **vedadas** para o NCM, com a condição de uso;
- **alertas de valor** quando o IBS/CBS informado não reflete a redução do cClassTrib.

Tudo roda no navegador: nenhum arquivo é enviado a servidor.

## Uso online (GitHub Pages)

1. Crie um repositório, por exemplo `consulta-tributacao-ncm`, e envie o conteúdo desta pasta.
2. Em **Settings → Pages**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Acesse `https://<seu-usuario>.github.io/consulta-tributacao-ncm/`.

## Uso local

O site precisa de HTTP (o navegador bloqueia `fetch` de JSON em `file://`):

```bash
python -m http.server 8000
# abra http://localhost:8000
```

## Como usar

1. **Enviar arquivos** — arraste um ou vários XML de NF-e/NFC-e, ou uma planilha
   `.xlsx`, `.xls` ou `.csv`. Clique em **Conferir tributação**.
2. **Conferir um NCM** — digite o código (4 a 8 dígitos) para consultar sem arquivo.
3. **Filtrar** por divergentes, revisar, conformes, integral (sem regra) ou alertas de valor.
4. **Exportar** em CSV ou planilha Excel (duas abas: `Conferência` e `Corrigida`).
   A exportação sempre inclui **todos os itens conferidos**, mesmo com um filtro aplicado na tela.

### Colunas reconhecidas na planilha

A primeira linha com um cabeçalho de NCM é usada. São aceitos nomes como:

| Campo | Exemplos de cabeçalho |
| --- | --- |
| NCM | `NCM` |
| CST IBS/CBS | `CST IBS/CBS`, `CST IBS`, `CST CBS` |
| cClassTrib | `cClassTrib`, `Classificação Tributária` |
| Produto | `Descrição Produto`, `Produto` |
| Nota / item | `Número NF`, `Nota`, `Item` |
| Valores (opcional) | `vBC`, `pIBSUF`, `vIBSUF`, `pCBS`, `vCBS` |
| Contexto | `CST/CSOSN ICMS`, `CST PIS`, `CST COFINS`, `CFOP`, `Chave`, `Data Emissão` |

Planilhas com apenas a coluna NCM também funcionam: o site devolve a tributação
correta de cada código.

## Como a conferência é feita

1. **Sem vínculo nos anexos** → tributação integral: `CST 000 / cClassTrib 000001`.
2. **Um vínculo permitido** → o par informado precisa ser exatamente esse; se não for, é divergência.
3. **Vários vínculos permitidos** → o item é **conforme** se o cClassTrib informado for um deles;
   se não for, fica em **revisar**, pois a escolha depende da condição de uso
   (cesta básica, insumo agropecuário, dispositivo médico, etc.).
4. **cClassTrib vedado para o NCM** → divergência, com a indicação da restrição.
5. **CST incompatível com o cClassTrib** → divergência, mesmo que o cClassTrib exista.
6. **Valores** → quando o arquivo traz `vBC`, alíquotas e valores de IBS/CBS, o site aplica
   o percentual de redução do cClassTrib e sinaliza valores fora da faixa esperada.
   Redução de 100% com valor informado maior que zero sempre gera alerta.

O NCM é sempre o ponto de partida. A base relaciona **apenas parte dos itens de um mesmo
NCM** a benefícios; por isso a condição de uso mostrada em cada possibilidade é parte da
resposta — o site não substitui a análise do produto.

## Estrutura

```
consulta-tributacao-ncm-site/
├── index.html                     # página única
├── assets/
│   ├── styles.css                 # visual
│   ├── app.js                     # leitura de XML/planilha, regras, telas, exportação
│   └── vendor/xlsx.full.min.js    # SheetJS (leitura/escrita de XLSX/CSV)
├── data/
│   ├── cst-cclasstrib.json        # catálogo de CST e cClassTrib (enxuto)
│   ├── ncm-regras.json            # índice NCM → cClassTrib (permitido/vedado + condição)
│   └── ncm-descricoes.json        # descrições NCM (busca e detalhe)
└── scripts/
    ├── gerar_dados.py             # gera data/*.json a partir do snapshot
    ├── atualizar_base.py          # extrai o snapshot do portal e regenera a base
    └── test_dados.py              # regressão dos dados
```

## Atualizar a base

Fonte oficial: <https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria>
(IT 2025.002). O site irmão <https://silvioalbqrq.github.io/cst-cclasstrib/> mantém um
espelho da base; esta pasta aproveita o snapshot dele.

```bash
# opção 1: usar o snapshot do espelho local
python scripts/atualizar_base.py

# opção 2: página oficial salva no navegador (Ctrl+S, HTML completo)
python scripts/atualizar_base.py portal.html

# opção 3: baixar direto da URL oficial
python scripts/atualizar_base.py https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria

# sempre ao final
python scripts/test_dados.py
```

Depois, confira o rodapé do site (data de geração e nº de NCMs) e faça o commit dos
arquivos de `data/`.

## Testes

```bash
python scripts/test_dados.py   # integridade da base e casos de referência
node --check assets/app.js     # sintaxe do front-end
```

Casos de referência verificados:

- `19030000` (tapioca) → `CST 200 / cClassTrib 200003`, redução de 100% de IBS e CBS;
- `10062010` (arroz) → `200003` permitido e `200034` vedado, entre outras opções;
- NCM sem vínculo → `000001`.

## Limitações

- A conferência usa o snapshot carregado em `data/`; notas de períodos anteriores a
  mudanças de tabela devem ser analisadas com o snapshot da época.
- O site **não altera o XML assinado** nem recalcula totais. A exportação gera uma
  planilha de conferência e uma aba `Corrigida` apenas para os casos inequívocos.
- A análise é de apoio e não substitui a validação no portal oficial, no validador
  da SEFAZ ou a análise da condição de uso do produto.

## Privacidade

Os arquivos são lidos com `FileReader`/`arrayBuffer` no próprio navegador. Nenhum
conteúdo é transmitido, armazenado ou compartilhado.
