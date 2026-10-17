import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { formatarMoeda } from '../lib/moeda'
import { COLUNAS_PLANILHA, descreverVariacao, lerCSV, planilhaParaProdutos, textoModeloPlanilha, TIPOS_PRODUTO } from '../lib/catalogo'
import Icone from '../components/Icone'
import { Aviso } from '../components/ui'

const TAMANHO_MAXIMO = 2 * 1024 * 1024 // 2 MB: dá para milhares de linhas
const LOTE = 300 // produtos por envio

const normal = (t) => t.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

// O Excel salva CSV em UTF-8 ou no formato antigo do Windows: tenta os dois para os acentos saírem certos
async function lerArquivo(arquivo) {
  const bytes = await arquivo.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return new TextDecoder('windows-1252').decode(bytes) }
}

export default function ImportarProdutos() {
  const { permissoes } = useAuth()
  const { produtos, linhas, empresas, salvarProdutos } = useCatalogo()
  const [resultado, setResultado] = useState(null) // { produtos, erros, linhasLidas, arquivo }
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(null) // { feitos, total }
  const [concluido, setConcluido] = useState(null)

  if (!permissoes.admin) return <Navigate to="/produtos" replace />

  function baixarModelo() {
    const url = URL.createObjectURL(new Blob([textoModeloPlanilha()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-produtos-demanas.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function escolher(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    setErro(''); setResultado(null); setConcluido(null)
    if (!arquivo) return
    if (/\.xlsx?$/i.test(arquivo.name)) return setErro('Esse arquivo é do Excel. Salve como CSV: Arquivo → Salvar como → "CSV UTF-8 (separado por vírgulas)".')
    if (arquivo.size > TAMANHO_MAXIMO) return setErro('O arquivo passa de 2 MB. Divida a planilha em partes.')
    const texto = await lerArquivo(arquivo)
    const existentes = {
      nomes: new Set(produtos.filter((p) => p.ativo).map((p) => normal(p.nome))),
      codigos: new Set(linhas.map((l) => l.codigo_barras).filter(Boolean)),
    }
    setResultado({ ...planilhaParaProdutos(lerCSV(texto), { empresas, existentes }), arquivo: arquivo.name })
  }

  async function importar() {
    const lista = resultado.produtos
    setErro('')
    setEnviando({ feitos: 0, total: lista.length })
    for (let i = 0; i < lista.length; i += LOTE) {
      const r = await salvarProdutos(lista.slice(i, i + LOTE))
      if (r.erro) {
        setEnviando(null)
        return setErro(i > 0
          ? `${i} produtos entraram, mas o resto parou: ${r.erro} Corrija a planilha, tire os que já entraram e envie de novo.`
          : `Nada foi importado: ${r.erro}`)
      }
      setEnviando({ feitos: Math.min(i + LOTE, lista.length), total: lista.length })
    }
    setEnviando(null)
    setConcluido({ produtos: lista.length, variacoes: lista.reduce((s, p) => s + p.variacoes.length, 0) })
    setResultado(null)
  }

  const variacoes = resultado?.produtos.reduce((s, p) => s + p.variacoes.length, 0) || 0

  return (
    <div className="pagina pagina-estreita">
      <Link to="/produtos" className="botao-link voltar"><Icone nome="voltar" tamanho={18} /> Produtos</Link>
      <header className="pagina-topo"><h1>Importar planilha de produtos</h1></header>

      <section className="cartao secao">
        <h2>1. Preencha o modelo</h2>
        <p className="texto-suave pequeno">Uma linha para cada variação (cor, tamanho, tonalidade). Repita o nome do produto nas linhas da mesma peça: o sistema junta tudo num produto só.</p>
        <button className="botao botao-secundario" onClick={baixarModelo}><Icone nome="relatorios" /> Baixar o modelo</button>
        <details className="perfil-fiscal">
          <summary><strong>O que vai em cada coluna</strong></summary>
          <ul className="lista-simples">
            {COLUNAS_PLANILHA.map(([c, ajuda]) => <li key={c}><strong>{c}</strong>: {ajuda}</li>)}
          </ul>
          <p className="texto-suave pequeno">Só <strong>produto</strong> e <strong>preco</strong> são obrigatórios. No Google Planilhas: Arquivo → Fazer download → CSV. No Excel: Salvar como → CSV UTF-8.</p>
        </details>
      </section>

      <section className="cartao secao">
        <h2>2. Envie o arquivo</h2>
        <label className="botao botao-principal botao-arquivo">
          <Icone nome="somar" /> Escolher arquivo CSV
          <input type="file" accept=".csv,.txt,text/csv" onChange={escolher} hidden />
        </label>
        <p className="texto-suave pequeno">Antes de salvar, o sistema confere tudo e mostra os erros linha por linha. Nada entra enquanto houver erro.</p>
      </section>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}
      {concluido && <Aviso tom="oliva">Pronto! Entraram {concluido.produtos} produtos com {concluido.variacoes} variações. <Link to="/produtos">Ver os produtos</Link></Aviso>}

      {resultado && (
        <section className="cartao secao">
          <h2>3. Confira</h2>
          <p className="pequeno">{resultado.arquivo}: {resultado.linhasLidas} linhas lidas · <strong>{resultado.produtos.length} produtos</strong> com {variacoes} variações prontos.</p>
          {resultado.erros.length > 0 && (
            <>
              <Aviso tom="vinho">{resultado.erros.length} {resultado.erros.length === 1 ? 'linha tem erro' : 'linhas têm erro'}. Corrija na planilha e envie de novo.</Aviso>
              <ul className="lista lista-compacta">
                {resultado.erros.slice(0, 50).map((e, i) => (
                  <li key={i} className="linha-lista"><span><strong>Linha {e.linha}</strong><small>{e.mensagem}</small></span></li>
                ))}
              </ul>
              {resultado.erros.length > 50 && <p className="texto-suave pequeno">… e mais {resultado.erros.length - 50}.</p>}
            </>
          )}
          {resultado.produtos.length > 0 && (
            <details className="perfil-fiscal" open={resultado.erros.length === 0}>
              <summary><strong>Prévia dos produtos</strong></summary>
              <ul className="lista lista-compacta">
                {resultado.produtos.slice(0, 30).map((p) => (
                  <li key={p.nome} className="linha-lista">
                    <span>
                      <strong>{p.nome}</strong>
                      <small>{[TIPOS_PRODUTO[p.tipo], p.categoria, p.marca, empresas[p.empresa_id]?.apelido].filter(Boolean).join(' · ')}</small>
                      <small>{p.variacoes.map((v) => descreverVariacao(v)).join(', ')}</small>
                    </span>
                    <strong>{formatarMoeda(Math.min(...p.variacoes.map((v) => v.preco_venda)))}</strong>
                  </li>
                ))}
              </ul>
              {resultado.produtos.length > 30 && <p className="texto-suave pequeno">… e mais {resultado.produtos.length - 30} produtos.</p>}
            </details>
          )}
          <button className="botao botao-principal botao-grande" disabled={resultado.erros.length > 0 || !resultado.produtos.length || enviando} onClick={importar}>
            {enviando ? `Importando… ${enviando.feitos} de ${enviando.total}` : `Importar ${resultado.produtos.length} produtos`}
          </button>
        </section>
      )}
    </div>
  )
}
