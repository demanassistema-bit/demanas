import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { formatarMoeda } from '../lib/moeda'
import { normalizar } from '../demo/regras'
import { combinarVariacoes, erroCodigoBarras, TIPOS_PRODUTO } from '../lib/catalogo'
import { filtroDinheiro, filtroInteiro, lerInteiro, lerValor, limparTexto, LIMITE, separarLista, TAMANHO } from '../lib/limites'
import Modal from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, CampoBusca, Selo, Vazio } from '../components/ui'

const FILTRO_TIPOS = { todos: 'Todos', lingerie: 'Lingerie', cosmetico: 'Cosméticos', kit: 'Kits', outro: 'Outros' }

export default function Produtos() {
  const { permissoes } = useAuth()
  const { produtos, empresas, linhas, carregando, erro } = useCatalogo()
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos')
  const [empresa, setEmpresa] = useState('todas')
  const [arquivados, setArquivados] = useState(false)
  const [novo, setNovo] = useState(false)

  const lista = useMemo(() => produtos
    .filter((p) => (arquivados ? !p.ativo : p.ativo) && (tipo === 'todos' || p.tipo === tipo) && (empresa === 'todas' || p.empresa_id === empresa))
    .map((p) => {
      const vs = linhas.filter((l) => l.produto_id === p.id && l.ativo !== false)
      const precos = vs.map((v) => v.preco)
      const daLinha = linhas.find((l) => l.produto_id === p.id)?.produto
      return { ...p, vs, marca: daLinha?.marca || '', categoria: daLinha?.categoria || '', min: Math.min(...precos), max: Math.max(...precos) }
    })
    .filter((p) => !busca.trim() || normalizar(`${p.nome} ${p.categoria} ${p.marca} ${p.vs.map((v) => `${v.nomeVariacao} ${v.codigo_interno} ${v.codigo_barras || ''}`).join(' ')}`).includes(normalizar(busca))),
  [produtos, linhas, tipo, empresa, busca, arquivados])
  const qtdArquivados = produtos.filter((p) => !p.ativo).length

  return (
    <div className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>Produtos</h1>
          <p className="texto-suave">{lista.length} produtos · {lista.reduce((s, p) => s + p.vs.length, 0)} variações</p>
        </div>
        {permissoes.admin && (
          <div className="acoes-topo">
            <Link to="/produtos/importar" className="botao botao-secundario"><Icone nome="relatorios" /> Importar planilha</Link>
            <button className="botao botao-principal" onClick={() => setNovo(true)}><Icone nome="somar" /> Novo produto</button>
          </div>
        )}
      </header>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <div className="filtros">
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, cor, tamanho ou código" />
        <div className="fichas">
          {Object.entries(FILTRO_TIPOS).map(([chave, nome]) => (
            <button key={chave} className={`ficha ${tipo === chave ? 'ativo' : ''}`} onClick={() => setTipo(chave)}>{nome}</button>
          ))}
          <span className="separador-fichas" aria-hidden="true" />
          <button className={`ficha ${empresa === 'todas' ? 'ativo' : ''}`} onClick={() => setEmpresa('todas')}>Os dois CNPJs</button>
          {Object.values(empresas).map((e) => (
            <button key={e.id} className={`ficha ${empresa === e.id ? 'ativo' : ''}`} onClick={() => setEmpresa(e.id)}>{e.apelido}</button>
          ))}
          {(qtdArquivados > 0 || arquivados) && (
            <>
              <span className="separador-fichas" aria-hidden="true" />
              <button className={`ficha ${arquivados ? 'ativo' : ''}`} onClick={() => setArquivados(!arquivados)}>Arquivados ({qtdArquivados})</button>
            </>
          )}
        </div>
      </div>

      {carregando ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? (
        <Vazio icone="produtos" titulo={produtos.length ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado ainda'}>
          {produtos.length ? 'Tente outra palavra.' : permissoes.admin ? 'Cadastre o primeiro produto, ou importe a planilha com o catálogo inteiro.' : 'As proprietárias ainda vão cadastrar o catálogo.'}
        </Vazio>
      ) : (
        <div className="grade-produtos">
          {lista.map((p) => (
            <Link key={p.id} to={`/produtos/${p.id}`} className="cartao produto">
              <span className={`produto-marca tipo-${p.tipo}`}>{p.nome.charAt(0)}</span>
              <div className="produto-info">
                <strong>{p.nome}</strong>
                <small>{[p.categoria, p.marca, empresas[p.empresa_id]?.apelido].filter(Boolean).join(' · ')}</small>
                <small>{p.vs.length} {p.vs.length === 1 ? 'variação' : 'variações'}</small>
              </div>
              <div className="produto-direita">
                <strong>{p.vs.length === 0 ? '—' : p.min === p.max ? formatarMoeda(p.min) : `${formatarMoeda(p.min)}+`}</strong>
                {p.tipo === 'kit' && <Selo tom="oliva">Kit</Selo>}
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
  const { produtos, categorias, marcas, empresas, podeVerCustos, salvarProdutos } = useCatalogo()
  const navegar = useNavigate()
  const [f, setF] = useState({
    nome: '', tipo: 'lingerie', categoria: '', marca: '', empresa_id: 'day', preco: '', custo: '', minimo: '1',
    modelos: '', cores: '', tamanhos: 'P, M, G', tonalidades: '', volumes: '', codigo: '', codigoProprio: false, controla_validade: true,
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const mudar = (campos) => setF({ ...f, ...campos })

  const listas = {
    modelo: separarLista(f.modelos), cor: separarLista(f.cores), tamanho: separarLista(f.tamanhos),
    tonalidade: separarLista(f.tonalidades), volume: separarLista(f.volumes),
  }
  const combinacoes = combinarVariacoes(f.tipo, listas)
  const qtd = combinacoes.length
  const kit = f.tipo === 'kit'

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const nome = limparTexto(f.nome)
    if (nome.length < 2) return setErro('Dê um nome ao produto.')
    if (produtos.some((p) => p.ativo && limparTexto(p.nome).toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) {
      return setErro(`Já existe um produto chamado "${nome}". Use outro nome, ou abra o que já existe.`)
    }
    const preco = lerValor(f.preco, { rotulo: 'o preço de venda', max: LIMITE.preco })
    if (preco.erro) return setErro(preco.erro)
    const custo = lerValor(f.custo, { rotulo: 'o custo', min: 0, max: LIMITE.preco, obrigatorio: false })
    if (custo.erro) return setErro(custo.erro)
    if (custo.valor > preco.valor) return setErro('O custo está maior que o preço de venda. Confira os dois valores.')
    const minimo = lerInteiro(f.minimo, { rotulo: 'o estoque mínimo', min: 0, max: LIMITE.estoqueMinimo, obrigatorio: false })
    if (minimo.erro) return setErro(minimo.erro)
    const grande = Object.values(listas).flat().find((x) => x.length > TAMANHO.variacao)
    if (grande) return setErro(`"${grande}" é longo demais (até ${TAMANHO.variacao} letras). Separe com vírgula.`)
    if (qtd > LIMITE.variacoes) return setErro(`São ${qtd} variações: o limite é ${LIMITE.variacoes} por produto. Divida em mais de um produto.`)
    const codigo = qtd === 1 ? f.codigo.trim() : ''
    const erroCodigo = erroCodigoBarras(codigo)
    if (erroCodigo) return setErro(erroCodigo)

    setSalvando(true)
    const r = await salvarProdutos([{
      nome, tipo: f.tipo, categoria: limparTexto(f.categoria), marca: limparTexto(f.marca), empresa_id: f.empresa_id,
      controla_validade: f.tipo === 'cosmetico' && f.controla_validade,
      variacoes: combinacoes.map((c) => ({
        ...c, codigo_barras: codigo || null, codigo_proprio: !codigo && (kit || f.codigoProprio),
        preco_venda: preco.valor, custo: podeVerCustos ? custo.valor : 0, estoque_minimo: minimo.valor,
      })),
    }])
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    navegar(`/produtos/${r.data[0]}`)
  }

  return (
    <Modal
      titulo="Novo produto"
      aoFechar={aoFechar}
      rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-produto" disabled={salvando}>{salvando ? 'Salvando…' : `Criar ${qtd} ${qtd === 1 ? 'variação' : 'variações'}`}</button></>}
    >
      <form id="form-produto" className="formulario" onSubmit={salvar}>
        <div className="segmentado quebra">
          {Object.entries(TIPOS_PRODUTO).map(([k, n]) => (
            <button type="button" key={k} className={f.tipo === k ? 'ativo' : ''} onClick={() => mudar({ tipo: k, codigoProprio: k === 'kit' })}>{n}</button>
          ))}
        </div>
        <div className="campo">
          <span>Vende por qual CNPJ</span>
          <div className="segmentado">
            {Object.values(empresas).map((e) => (
              <button type="button" key={e.id} className={f.empresa_id === e.id ? 'ativo' : ''} onClick={() => mudar({ empresa_id: e.id })}>{e.apelido}</button>
            ))}
          </div>
        </div>
        <label className="campo"><span>Nome do produto</span><input value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={TAMANHO.nome} placeholder={kit ? 'Ex.: Kit dia das mães · Pague 1 leve 2' : f.tipo === 'lingerie' ? 'Ex.: Sutiã renda Aurora' : 'Ex.: Batom matte Veludo'} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>Categoria</span><input list="categorias" value={f.categoria} onChange={(e) => mudar({ categoria: e.target.value })} maxLength={TAMANHO.categoria} /></label>
          <label className="campo"><span>Marca</span><input list="marcas" value={f.marca} onChange={(e) => mudar({ marca: e.target.value })} maxLength={TAMANHO.marca} /></label>
          <label className="campo"><span>Preço de venda</span><input inputMode="decimal" value={f.preco} onChange={(e) => mudar({ preco: filtroDinheiro(e.target.value) })} placeholder="0,00" /></label>
          {podeVerCustos && <label className="campo"><span>Custo</span><input inputMode="decimal" value={f.custo} onChange={(e) => mudar({ custo: filtroDinheiro(e.target.value) })} placeholder="0,00" /></label>}
          <label className="campo"><span>Estoque mínimo</span><input inputMode="numeric" value={f.minimo} onChange={(e) => mudar({ minimo: filtroInteiro(e.target.value, 3) })} /></label>
        </div>
        <datalist id="categorias">{categorias.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
        <datalist id="marcas">{marcas.map((m) => <option key={m.id} value={m.nome} />)}</datalist>

        {f.tipo === 'lingerie' && (
          <>
            <label className="campo"><span>Modelos, separados por vírgula (opcional)</span><input value={f.modelos} onChange={(e) => mudar({ modelos: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="Balconete, Meia taça" /></label>
            <label className="campo"><span>Cores, separadas por vírgula</span><input value={f.cores} onChange={(e) => mudar({ cores: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="Preto, Nude, Vinho" /></label>
            <label className="campo"><span>Tamanhos, separados por vírgula</span><input value={f.tamanhos} onChange={(e) => mudar({ tamanhos: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="P, M, G ou 40, 42, 44" /></label>
          </>
        )}
        {f.tipo === 'cosmetico' && (
          <>
            <label className="campo"><span>Tonalidades ou fragrâncias (opcional)</span><input value={f.tonalidades} onChange={(e) => mudar({ tonalidades: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="Nude, Marsala" /></label>
            <label className="campo"><span>Volumes ou pesos (opcional)</span><input value={f.volumes} onChange={(e) => mudar({ volumes: e.target.value })} maxLength={TAMANHO.variacoes} placeholder="200 ml, 400 ml" /></label>
            <label className="campo-check"><input type="checkbox" checked={f.controla_validade} onChange={(e) => mudar({ controla_validade: e.target.checked })} /> Anotar lote e validade na entrada (não é obrigatório)</label>
          </>
        )}

        {qtd === 1 && (
          <label className="campo"><span>Código de barras (opcional)</span><input value={f.codigo} onChange={(e) => mudar({ codigo: e.target.value.replace(/\s/g, '') })} maxLength={30} inputMode="numeric" placeholder="Leia com o leitor ou digite" disabled={f.codigoProprio} /></label>
        )}
        <label className="campo-check">
          <input type="checkbox" checked={f.codigoProprio} onChange={(e) => mudar({ codigoProprio: e.target.checked, codigo: '' })} />
          Não tem código de barras: o sistema cria um próprio{qtd > 1 ? ' para cada variação' : ''}
        </label>
        {qtd > 1 && !f.codigoProprio && <p className="texto-suave pequeno">Os códigos do fabricante de cada variação entram depois, na ficha do produto.</p>}
        {kit && <p className="texto-suave pequeno">Depois de criar, diga na ficha quais peças formam o kit. A baixa dessas peças no estoque chega com a Nova venda.</p>}

        <Aviso tom={qtd > LIMITE.variacoes ? 'vinho' : 'oliva'}>
          Vai criar <strong>{qtd} {qtd === 1 ? 'variação' : 'variações'}</strong>, todas com o mesmo preço. Dá para mudar o preço de cada uma depois.
        </Aviso>
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
