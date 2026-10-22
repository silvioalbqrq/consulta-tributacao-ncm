# Conferência IBS/CBS — NCM × CST × cClassTrib

Site estático para **conferir a tributação de IBS e CBS** de itens de NF-e/NFC-e ou de
uma planilha. Para cada item, o NCM é cruzado com a base oficial de classificação
tributária e o site mostra:

- o **CST** e o **cClassTrib** esperados para o NCM;
- se o par informado no arquivo está **conforme**, **divergente** ou precisa de **revisão**;
- o **código do produto** (`cProd`) de cada item, quando o arquivo informa, também na busca;
- todas as possibilidades **permitidas** e as **vedadas** para o NCM, com a condição de uso;
- **alertas de valor** quando o IBS/CBS informado não reflete a redução do cClassTrib;
- **paginação** (10, 25, 50 ou 100 itens por página) com as visões *todos os itens* e
  *por código do produto*, e **impressão** da lista filtrada completa (não só da página atual).

Tudo roda no navegador: nenhum arquivo é enviado a servidor.

## Uso online (GitHub Pages)

Publicação pelo próprio GitHub Pages, direto da branch `main` (sem workflow de deploy):

1. Em **Settings → Pages**, escolha **Source: Deploy from a branch**.
2. **Branch:** `main` · **Folder:** `/ (root)` → **Save**.
3. Acesse `https://<seu-usuario>.github.io/<repositório>/`.

Cada `push` na `main` republica o site automaticamente (o `.nojekyll` mantém os
`data/*.json` servidos sem processamento do Jekyll).

O cache do navegador é contornado por um parâmetro de versão nos assets: os links de CSS/JS
em `index.html` usam `?v=AAAAMMDD` (aceita sufixo, ex. `2026.10.21b`, quando houver mais de
uma publicação no mesmo dia) e `assets/app.js` repete o valor na constante `VERSAO`
(usada também nos `data/*.json` e no `unrar`). Ao publicar uma alteração, atualize os dois
com o mesmo valor — ou use o hash curto do commit.

## Uso local

O site precisa de HTTP (o navegador bloqueia `fetch` de JSON em `file://`):

```bash
python -m http.server 8000
# abra http://localhost:8000
```

## Como usar

1. **Enviar arquivos** — arraste um ou vários XML de NF-e/NFC-e, uma planilha
   `.xlsx`, `.xls` ou `.csv`, ou:
   - **uma pasta inteira** (botão **Escolher uma pasta** ou arrastando a pasta) — todos os
     XML e planilhas da pasta e das subpastas entram na conferência;
   - **um arquivo compactado** `.zip` ou `.rar` com os XML/planilhas dentro (as pastas
     internas são lidas e arquivos de sistema, como `__MACOSX` e `~$…`, são ignorados).
   Depois, clique em **Conferir tributação**.
2. **Conferir um NCM** — digite o código (4 a 8 dígitos) para consultar sem arquivo.
3. **Filtrar** por divergentes, revisar, conformes, integral (sem regra), alertas de valor
   ou ajustados (itens com tributação escolhida manualmente). A busca aceita **código do
   produto** (`cProd`), NCM, descrição, **emitente**, nota e nome do arquivo, sem
   diferenciar maiúsculas nem acentos.
4. **Percorrer o resultado** — a lista é paginada e os controles ficam **no fim da lista**:
   escolha **10, 25, 50 ou 100 itens por página** e navegue com **‹ Anterior**, **Próxima ›**
   e **Última página »** (vai direto para o fim da lista).
   Ao lado aparece a página atual e a faixa exibida (ex.: *Página 1 de 4 · 1–25 de 87 itens*).
   Trocar o filtro, a busca, a visão ou o tamanho da página volta para a primeira página.
5. **Alternar a visão** — **Todos os itens** mostra um item por linha; **Por código do
   produto** usa **a mesma tabela**, com as mesmas colunas, mas ordenada por `cProd`
   (código do produto do XML, ou a coluna de código da planilha) **e pelo emitente** — o
   mesmo código em fornecedores diferentes não se mistura, e a linha separadora mostra o
   emitente quando o lote tem mais de uma empresa. Cada produto tem uma **linha
   separadora**: código, NCM, descrição, situação e quantidade de itens. Se o mesmo
   produto vier com CST/cClassTrib declarados diferentes em notas diferentes, a
   quantidade aparece em âmbar (*2 tributações declaradas*). Arquivos sem a coluna de
   código são agrupados pelo NCM.
6. **Escolher a tributação** — quando o NCM tem mais de uma possibilidade permitida, a
   coluna `Correto` mostra um seletor com todas as opções; no detalhe do item há o botão
   **Usar esta tributação** em cada possibilidade (e **Voltar à sugestão automática**).
   A escolha vale para a coluna `Correto`, para os contadores e para a aba `Corrigida`.
7. **Imprimir** — o botão **Imprimir** (ou `Ctrl+P`) monta um relatório com **todos os itens
   filtrados**, não só os da página atual, na visão escolhida (item a item ou por código do
   produto). A tela continua paginada; só a impressão sai completa.
8. **Exportar** em CSV ou planilha Excel. Na visão **todos os itens** saem duas abas
   (`Conferência` e `Corrigida`), uma linha por item, com a coluna **Emitente** ao lado da
   origem. Na visão **por código do produto** sai uma aba (`Por código`) com **uma linha por
   código**, sem repetir o código, trazendo os itens, o valor total e a situação do grupo.
   A exportação sempre inclui **todos os itens conferidos**, mesmo com um filtro aplicado na tela.
   O arquivo baixado e o PDF da impressão terminam com **Todos os Itens** ou **Por Código**,
   conforme a visão escolhida.

### Colunas reconhecidas na planilha

A primeira linha com um cabeçalho de NCM é usada. São aceitos nomes como:

| Campo | Exemplos de cabeçalho |
| --- | --- |
| NCM | `NCM` |
| CST IBS/CBS | `CST IBS/CBS`, `CST IBS`, `CST CBS` |
| cClassTrib | `cClassTrib`, `Classificação Tributária` |
| Código do produto | `Código do produto`, `Cód. Produto`, `cProd`, `Código`, `Cód` |
| Produto | `Descrição Produto`, `Produto` |
| Nota / item | `Número NF`, `Nota`, `Item` |
| Valores (opcional) | `vBC`, `pIBSUF`, `vIBSUF`, `pCBS`, `vCBS` |
| Contexto | `CST/CSOSN ICMS`, `CST PIS`, `CST COFINS`, `CFOP`, `Chave`, `Data Emissão` |

Planilhas com apenas a coluna NCM também funcionam: o site devolve a tributação
correta de cada código.

### Pasta e arquivos compactados

- **Pasta**: usa o seletor de diretório do navegador (`webkitdirectory`) ou o arrastar-e-soltar
  de pastas (`webkitGetAsEntry`). O caminho relativo de cada arquivo é preservado na coluna
  `Origem`, inclusive as subpastas.
- **`.zip`**: descompactado no navegador com [fflate](https://github.com/101arrowz/fflate)
  (MIT, ~33 KB); só os arquivos XML/planilha são extraídos em memória.
- **`.rar`**: descompactado com `node-unrar-js` 2.0.2 (MIT, build wasm). O `unrar.wasm`
  (~200 KB) só é baixado na primeira vez que um `.rar` é enviado.
- **Limite de segurança**: até 300 MB descompactados por pacote (sem limite de quantidade —
  medido: 3.635 XMLs = 31 MB e ~75 MB de memória). RAR/ZIP protegido por senha não é suportado
  (o site avisa).

## Como a conferência é feita

1. **Sem vínculo nos anexos** → tributação integral: `CST 000 / cClassTrib 000001`.
2. **Um vínculo permitido** → o par informado precisa ser exatamente esse; se não for, é divergência.
3. **Vários vínculos permitidos** → o item é **conforme** se o cClassTrib informado for um deles;
   se não for, fica em **revisar**, pois a escolha depende da condição de uso
   (cesta básica, insumo agropecuário, dispositivo médico, etc.). Nesse caso o seletor da
   coluna `Correto` (ou os botões do detalhe) permite fixar a tributação do item; itens com
   escolha manual passam a contar como corrigidos e recebem a marca **ajustado**.
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
│   ├── app.js                     # leitura de XML/planilha/pasta/ZIP/RAR, regras, telas, exportação
│   └── vendor/
│       ├── xlsx.full.min.js       # SheetJS (leitura/escrita de XLSX/CSV)
│       ├── fflate.min.js          # ZIP (fflate, MIT)
│       └── unrar/                 # RAR (node-unrar-js ESM + unrar.wasm, MIT)
├── data/
│   ├── cst-cclasstrib.json        # catálogo de CST e cClassTrib (enxuto)
│   ├── ncm-regras.json            # índice NCM → cClassTrib (permitido/vedado + condição)
│   └── ncm-descricoes.json        # descrições NCM (busca e detalhe)
└── scripts/
    ├── gerar_dados.py             # gera data/*.json a partir do snapshot
    ├── atualizar_base.py          # extrai o snapshot do portal e regenera a base
    ├── test_dados.py              # regressão dos dados
    └── test_front.mjs             # regressão da lógica do front-end
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
python scripts/test_dados.py     # integridade da base e casos de referência
node --check assets/app.js       # sintaxe do front-end
node scripts/test_front.mjs      # regras, agrupamento, busca, CSV, exportação e limite de pacote
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

## Contato e doações

O rodapé tem o bloco **Contato** (e-mail, WhatsApp e GitHub) e o bloco **Ajuda**
(Pix e Lightning), iguais aos do Hub Fiscal (`https://silvioalbqrq.github.io/portal-fiscal/`).

- **Copiar**: `navigator.clipboard.writeText` grava a chave completa (atributo `data-full`,
  não o texto abreviado). Em contexto sem permissão de área de transferência, o site avisa
  e a chave completa continua disponível no link "ver chave completa".
- **Ver/ocultar**: o link troca entre o valor abreviado (`data-short`) e a chave completa.
- O rodapé não aparece na impressão (`@media print`).
