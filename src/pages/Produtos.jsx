import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { formatarMoeda } from '../lib/moeda'
import { filtroDinheiro, filtroInteiro, lerInteiro, lerValor, limparTexto, LIMITE, separarLista, TAMANHO } from '../lib/limites'
import { normalizar } from '../demo/regras'
import Modal from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, Vazio } from '../components/ui'

const TIPOS = { todos: 'Todos', lingerie: 'Lingerie', cosmetico: 'Cosméticos' }

export default function Produtos() {
  const { dados, linhas, ehProprietaria } = useDemo()
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos')
  const [empresa, setEmpresa] = useState('todas')
  const [arquivados, setArquivados] = useState(false)
  const [novo, setNovo] = useState(false)
  const empresas = dados.config.empresas

  const lista = useMemo(() => dados.produtos
    .filter((p) => (arquivados ? !p.ativo : p.ativo) && (tipo === 'todos' || p.tipo === tipo) && (empresa === 'todas' || p.empresa_id === empresa))
    .map((p) => {
      const vs = linhas.filter((l) => l.produto_id === p.id)
      const precos = vs.map((v) => v.preco)
      return {
        ...p, variacoes: vs,
        estoque: vs.reduce((s, v) => s + Math.max(v.saldo, 0), 0),
        acabando: vs.filter((v) => v.saldo <= v.estoque_minimo).length,
        min: Math.min(...precos), max: Math.max(...precos),
      }
    })
    .filter((p) => !busca.trim() || normalizar(`${p.nome} ${p.categoria} ${p.marca} ${p.variacoes.map((v) => `${v.nomeVariacao} ${v.sku} ${v.codigo_barras}`).join(' ')}`).includes(normalizar(busca)))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [dados.produtos, linhas, tipo, empresa, busca, arquivados])
  const qtdArquivados = dados.produtos.filter((p) => !p.ativo).length

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Produtos</h1>
          <p className="texto-suave">{lista.length} produtos · {lista.reduce((s, p) => s + p.variacoes.length, 0)} variações</p>
        </div>
        {ehProprietaria && <button className="botao botao-principal" onClick={() => setNovo(true)}><Icone nome="somar" /> Novo produto</button>}
      </header>

      <div className="filtros">
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, cor, tamanho ou código" />
        <div className="fichas">
          {Object.entries(TIPOS).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${tipo === chave ? 'ativo' : ''}`} onClick={() => setTipo(chave)}>{nome}</button>
          ))}
          <span className="separador-fichas" aria-hidden="true" />
          <button className={`ficha ${empresa === 'todas' ? 'ativo' : ''}`} onClick={() => setEmpresa('todas')}>Os dois CNPJs</button>
          {Object.entries(empresas).map(([id, e]) => (
            <button key={id} className={`ficha ${empresa === id ? 'ativo' : ''}`} onClick={() => setEmpresa(id)}>{e.apelido}</button>
          ))}
          {(qtdArquivados > 0 || arquivados) && (
            <>
              <span className="separador-fichas" aria-hidden="true" />
              <button className={`ficha ${arquivados ? 'ativo' : ''}`} onClick={() => setArquivados(!arquivados)}>Arquivados ({qtdArquivados})</button>
            </>
          )}
        </div>
      </div>

      {lista.length === 0 ? (
        <Vazio icone="produtos" titulo="Nenhum produto encontrado">Tente outra palavra, ou cadastre um produto novo.</Vazio>
      ) : (
        <div className="grade-produtos">
          {lista.map((p) => (
            <Link key={p.id} to={`/produtos/${p.id}`} className="cartao produto">
              <span className={`produto-marca tipo-${p.tipo}`}>{p.nome.charAt(0)}</span>
              <div className="produto-info">
                <strong>{p.nome}</strong>
                <small>{p.categoria} · {p.marca} · <span className="texto-cnpj">{empresas[p.empresa_id]?.apelido || 'sem CNPJ'}</span></small>
                <small>{p.variacoes.length} {p.variacoes.length === 1 ? 'variação' : 'variações'} · {p.estoque} em estoque</small>
              </div>
              <div className="produto-direita">
                <strong>{p.min === p.max ? formatarMoeda(p.min) : `${formatarMoeda(p.min)}+`}</strong>
                {p.acabando > 0 && <Selo tom="ambar">{p.acabando} acabando</Selo>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {novo && <NovoProduto aoFechar={() => setNovo(false)} />}
    </div>
  )
}

function NovoProduto({ aoFechar }) {
  const { dados, criarProduto } = useDemo()
  const navegar = useNavigate()
  const [f, setF] = useState({
    nome: '', tipo: 'lingerie', categoria: '', marca: '', empresa_id: 'day', preco: '', custo: '', minimo: '1',
    cores: '', tamanhos: 'P, M, G', tonalidades: '', volume: '', controla_validade: true,
  })
  const [erro, setErro] = useState('')
  const mudar = (campos) => setF({ ...f, ...campos })
  const categorias = [...new Set(dados.produtos.map((p) => p.categoria))]
  const marcas = [...new Set(dados.produtos.map((p) => p.marca))]

  const cores = separarLista(f.cores)
  const tamanhos = separarLista(f.tamanhos)
  const tonalidades = separarLista(f.tonalidades)
  const qtdVariacoes = f.tipo === 'lingerie' ? Math.max(cores.length, 1) * Math.max(tamanhos.length, 1) : Math.max(tonalidades.length, 1)

  function salvar(e) {
    e.preventDefault()
    const nome = limparTexto(f.nome)
    if (nome.length < 2) return setErro('Dê um nome ao produto.')
    const repetido = dados.produtos.find((p) => p.ativo && limparTexto(p.nome).toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))
    if (repetido) return setErro(`Já existe um produto chamado "${repetido.nome}". Use outro nome, ou abra o que já existe.`)
    const preco = lerValor(f.preco, { rotulo: 'o preço de venda', max: LIMITE.preco })
    if (preco.erro) return setErro(preco.erro)
    const custo = lerValor(f.custo, { rotulo: 'o custo', min: 0, max: LIMITE.preco, obrigatorio: false })
    if (custo.erro) return setErro(custo.erro)
    if (custo.valor > preco.valor) return setErro('O custo está maior que o preço de venda. Confira os dois valores.')
    const minimo = lerInteiro(f.minimo, { rotulo: 'o estoque mínimo', min: 0, max: LIMITE.estoqueMinimo, obrigatorio: false })
    if (minimo.erro) return setErro(minimo.erro)
    const grande = [...cores, ...tamanhos, ...tonalidades].find((x) => x.length > TAMANHO.variacao)
    if (grande) return setErro(`"${grande}" é longo demais para uma cor, tamanho ou tonalidade (até ${TAMANHO.variacao} letras). Separe com vírgula.`)
    if (qtdVariacoes > LIMITE.variacoes) return setErro(`São ${qtdVariacoes} variações: o limite é ${LIMITE.variacoes} por produto. Divida em mais de um produto.`)
    const id = criarProduto({
      nome, tipo: f.tipo, categoria: limparTexto(f.categoria) || 'Sem categoria', marca: limparTexto(f.marca) || 'Sem marca', empresa_id: f.empresa_id,
      preco: preco.valor, custo: custo.valor, estoque_minimo: minimo.valor, cores, tamanhos, tonalidades,
      volume: limparTexto(f.volume), controla_validade: f.tipo === 'cosmetico' && f.controla_validade,
    })
    navegar(`/produtos/${id}`)
  }

  return (
    <Modal
      titulo="Novo produto"
      aoFechar={aoFechar}
      rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-produto">Criar {qtdVariacoes} {qtdVariacoes === 1 ? 'variação' : 'variações'}</button></>}
    >
      <form id="form-produto" className="formulario" onSubmit={salvar}>
        <div className="segmentado">
          <button type="button" className={f.tipo === 'lingerie' ? 'ativo' : ''} onClick={() => mudar({ tipo: 'lingerie' })}>Lingerie</button>
          <button type="button" className={f.tipo === 'cosmetico' ? 'ativo' : ''} onClick={() => mudar({ tipo: 'cosmetico' })}>Cosmético</button>
          <button type="button" className={f.tipo === 'outro' ? 'ativo' : ''} onClick={() => mudar({ tipo: 'outro' })}>Outro</button>
        </div>
        <div className="campo">
          <span>Vende por qual CNPJ</span>
          <div className="segmentado">
            {Object.entries(dados.config.empresas).map(([id, e]) => (
              <button type="button" key={id} className={f.empresa_id === id ? 'ativo' : ''} onClick={() => mudar({ empresa_id: id })}>{e.apelido}</button>
            ))}
          </div>
        </div>
        <label className="campo"><span>Nome do produto</span><input value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={TAMANHO.nome} placeholder={f.tipo === 'lingerie' ? 'Ex.: Sutiã renda Aurora' : 'Ex.: Batom matte Veludo'} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>Categoria</span><input list="categorias" value={f.categoria} onChange={(e) => mudar({ categoria: e.target.value })} maxLength={TAMANHO.categoria} /></label>
          <label className="campo"><span>Marca</span><input list="marcas" value={f.marca} onChange={(e) => mudar({ marca: e.target.value })} maxLength={TAMANHO.marca} /></label>
          <label className="campo"><span>Preço de venda</span><input inputMode="decimal" value={f.preco} onChange={(e) => mudar({ preco: filtroDinheiro(e.target.value) })} placeholder="0,00" /></label>
          <label className="campo"><span>Custo</span><input inputMode="decimal" value={f.custo} onChange={(e) => mudar({ custo: filtroDinheiro(e.target.value) })} placeholder="0,00" /></label>
          <label className="campo"><span>Estoque mínimo</span><input inputMode="numeric" value={f.minimo} onChange={(e) => mudar({ minimo: filtroInteiro(e.target.value, 3) })} /></label>
        </div>
        <datalist id="categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="marcas">{marcas.map((m) => <option key={m} value={m} />)}</datalist>

        {f.tipo === 'lingerie' ? (
          <>
            <label className="campo"><span>Cores, separadas por vírgula</span><input value={f.cores} onChange={(e) => mudar({ cores: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="Preto, Nude, Vinho" /></label>
            <label className="campo"><span>Tamanhos, separados por vírgula</span><input value={f.tamanhos} onChange={(e) => mudar({ tamanhos: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="P, M, G ou 40, 42, 44" /></label>
          </>
        ) : (
          <>
            <label className="campo"><span>Tonalidades ou fragrâncias (opcional)</span><input value={f.tonalidades} onChange={(e) => mudar({ tonalidades: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="Nude, Marsala" /></label>
            <label className="campo"><span>Volume ou peso</span><input value={f.volume} onChange={(e) => mudar({ volume: e.target.value })} maxLength={TAMANHO.volume} placeholder="200 ml" /></label>
            {f.tipo === 'cosmetico' && (
              <label className="campo-check"><input type="checkbox" checked={f.controla_validade} onChange={(e) => mudar({ controla_validade: e.target.checked })} /> Controlar lote e validade</label>
            )}
          </>
        )}
        <Aviso tom={qtdVariacoes > LIMITE.variacoes ? 'vinho' : 'oliva'}>
          Vai criar <strong>{qtdVariacoes} {qtdVariacoes === 1 ? 'variação' : 'variações'}</strong>
          {f.tipo === 'lingerie' && cores.length > 0 && tamanhos.length > 0 && <> ({cores.length} cores × {tamanhos.length} tamanhos)</>}, todas com estoque zero.
          A quantidade entra depois, pela Entrada de estoque.
        </Aviso>
        <p className="texto-suave pequeno">Na versão real, aqui também ficam foto e dados fiscais (NCM, CEST), herdados da categoria.</p>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
