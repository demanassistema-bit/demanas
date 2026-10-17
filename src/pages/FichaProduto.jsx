import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { supabase } from '../lib/supabase'
import { formatarMoeda, formatarPercentual, paraCampoMoeda } from '../lib/moeda'
import { formatarDataHora } from '../lib/datas'
import { percentual } from '../demo/regras'
import { CAMPOS_VARIACAO, descreverVariacao, erroCodigoBarras, TIPOS_PRODUTO } from '../lib/catalogo'
import { filtroDinheiro, filtroInteiro, lerInteiro, lerValor, limparTexto, LIMITE, TAMANHO } from '../lib/limites'
import Modal, { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, Selo, SeletorVariacao } from '../components/ui'

const NOMES_CAMPO = { modelo: 'Modelo', cor: 'Cor', tamanho: 'Tamanho', tonalidade: 'Tonalidade', volume: 'Volume' }

export default function FichaProduto() {
  const { produtoId } = useParams()
  const { permissoes } = useAuth()
  const cat = useCatalogo()
  const { produtoPorId, empresas, linhas, kitItens, podeVerCustos, carregando } = cat
  const navegar = useNavigate()
  const [editando, setEditando] = useState(false)
  const [variacaoAberta, setVariacaoAberta] = useState(null) // id, ou 'nova'
  const [erro, setErro] = useState('')
  const produto = produtoPorId.get(produtoId)

  if (carregando) return <div className="pagina"><p className="texto-suave">Carregando…</p></div>
  if (!produto) return <Navigate to="/produtos" replace />

  const admin = permissoes.admin
  const variacoes = linhas.filter((l) => l.produto_id === produto.id)
  const daLinha = variacoes[0]?.produto
  const ehKit = produto.tipo === 'kit'
  const executar = async (promessa) => { setErro(''); const r = await promessa; if (r?.erro) setErro(r.erro); return r }

  return (
    <div className="pagina">
      <Link to="/produtos" className="botao-link voltar"><Icone nome="voltar" tamanho={18} /> Produtos</Link>
      <header className="pagina-topo">
        <div>
          <h1>{produto.nome} {!produto.ativo && <Selo>Arquivado</Selo>}</h1>
          <p className="texto-suave">{[TIPOS_PRODUTO[produto.tipo], daLinha?.categoria, daLinha?.marca].filter(Boolean).join(' · ')}</p>
        </div>
        {admin && <button className="botao botao-secundario" onClick={() => setEditando(true)}><Icone nome="configuracoes" /> Editar dados</button>}
      </header>

      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Vende por qual CNPJ</h2>
          <span className="texto-suave pequeno">{empresas[produto.empresa_id]?.tipo === 'me' ? 'sai com nota fiscal' : 'MEI: sai sem nota'}</span>
        </header>
        <div className="segmentado">
          {Object.values(empresas).map((e) => (
            <button key={e.id} disabled={!admin} className={produto.empresa_id === e.id ? 'ativo' : ''} onClick={() => executar(cat.atualizarProduto(produto.id, { empresa_id: e.id }))}>{e.apelido}</button>
          ))}
        </div>
        <p className="texto-suave pequeno">O estoque é um só. O CNPJ define em qual maquininha a peça é cobrada e se a venda sai com nota.</p>
      </section>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>{ehKit ? 'Kit' : 'Variações'}</h2>
          {admin && !ehKit && variacoes.length < LIMITE.variacoes && <button className="botao-link" onClick={() => setVariacaoAberta('nova')}><Icone nome="somar" tamanho={16} /> Nova variação</button>}
        </header>
        <ul className="lista variacoes">
          {variacoes.map((v) => (
            <li key={v.id} className={`variacao ${v.variacao_ativa ? '' : 'inativo'}`}>
              <div className="variacao-nome">
                <strong>{v.nomeVariacao} {!v.variacao_ativa && <Selo>Fora de linha</Selo>}</strong>
                <small>{v.codigo_barras ? `Código ${v.codigo_barras}${v.codigo_proprio ? ' (próprio)' : ''}` : 'Sem código de barras'}</small>
              </div>
              <div className="variacao-numeros">
                <span><small>Preço</small><strong>{formatarMoeda(v.preco)}</strong></span>
                {podeVerCustos && <span><small>Custo</small>{formatarMoeda(v.custo ?? 0)}</span>}
                {podeVerCustos && <span><small>Margem</small>{v.custo != null && v.preco > 0 ? formatarPercentual(percentual(v.preco - v.custo, v.preco)) : '—'}</span>}
                <span><small>Mínimo</small>{v.estoque_minimo}</span>
                {admin && <button className="botao-link" onClick={() => setVariacaoAberta(v.id)}>Editar</button>}
              </div>
            </li>
          ))}
        </ul>
        <p className="texto-suave pequeno">O estoque de cada variação aparece aqui quando o Estoque passar a usar o banco (Etapa 3).</p>
      </section>

      {ehKit && variacoes[0] && <ItensDoKit kit={variacoes[0]} itens={kitItens.filter((k) => k.kit_variacao_id === variacoes[0].id)} admin={admin} executar={executar} />}

      {admin && (
        <section className="cartao secao">
          {produto.ativo ? (
            <>
              <h2>Arquivar ou apagar</h2>
              <p className="texto-suave pequeno">
                <strong>Arquivar</strong> tira o produto das listas e da venda, mas guarda tudo. Dá para reativar depois.
                <strong> Apagar</strong> só funciona para cadastro feito por engano: se o produto já tiver venda ou estoque, o sistema arquiva no lugar.
              </p>
              <div className="linha-campos">
                <button className="botao botao-secundario" onClick={() => executar(cat.arquivarProduto(produto.id))}>Arquivar produto</button>
                <BotaoPerigo texto="Apagar produto" aoConfirmar={async () => {
                  const r = await executar(cat.excluirProduto(produto.id))
                  if (r?.resultado === 'apagado') navegar('/produtos')
                }} />
              </div>
            </>
          ) : (
            <>
              <h2>Produto arquivado</h2>
              <p className="texto-suave pequeno">Não aparece nas listas nem na venda. O histórico continua guardado.</p>
              <button className="botao botao-secundario" onClick={() => executar(cat.reativarProduto(produto.id))}>Reativar produto</button>
            </>
          )}
        </section>
      )}

      {editando && <EditarProduto produto={produto} aoFechar={() => setEditando(false)} />}
      {variacaoAberta && (
        <EditarVariacao
          produto={produto}
          variacao={variacaoAberta === 'nova' ? null : variacoes.find((v) => v.id === variacaoAberta)}
          aoFechar={() => setVariacaoAberta(null)}
        />
      )}
    </div>
  )
}

function EditarProduto({ produto, aoFechar }) {
  const { produtos, categorias, marcas, categoriaPorId, marcaPorId, atualizarProduto, garantirCategoria, garantirMarca } = useCatalogo()
  const [f, setF] = useState({
    nome: produto.nome, categoria: categoriaPorId.get(produto.categoria_id)?.nome || '', marca: marcaPorId.get(produto.marca_id)?.nome || '',
    controla_validade: produto.controla_validade,
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    const nome = limparTexto(f.nome)
    if (nome.length < 2) return setErro('Dê um nome ao produto.')
    if (produtos.some((p) => p.id !== produto.id && p.ativo && limparTexto(p.nome).toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) {
      return setErro(`Já existe outro produto chamado "${nome}".`)
    }
    setSalvando(true)
    const categoria = limparTexto(f.categoria) ? await garantirCategoria(limparTexto(f.categoria)) : { data: null }
    const marca = limparTexto(f.marca) ? await garantirMarca(limparTexto(f.marca)) : { data: null }
    const falha = categoria.erro || marca.erro
    const r = falha ? { erro: falha } : await atualizarProduto(produto.id, {
      nome, categoria_id: categoria.data?.id || null, marca_id: marca.data?.id || null, controla_validade: f.controla_validade,
    })
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    aoFechar()
  }

  return (
    <Modal titulo="Editar produto" aoFechar={aoFechar} rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-editar" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-editar" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Nome</span><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={TAMANHO.nome} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>Categoria</span><input list="categorias-ed" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} maxLength={TAMANHO.categoria} /></label>
          <label className="campo"><span>Marca</span><input list="marcas-ed" value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} maxLength={TAMANHO.marca} /></label>
        </div>
        <datalist id="categorias-ed">{categorias.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
        <datalist id="marcas-ed">{marcas.map((m) => <option key={m.id} value={m.nome} />)}</datalist>
        {produto.tipo === 'cosmetico' && (
          <label className="campo-check"><input type="checkbox" checked={f.controla_validade} onChange={(e) => setF({ ...f, controla_validade: e.target.checked })} /> Anotar lote e validade na entrada (não é obrigatório)</label>
        )}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}

// Editar uma variação (ou criar uma nova): preço com histórico, custo, mínimo, código de barras
function EditarVariacao({ produto, variacao, aoFechar }) {
  const { podeVerCustos, linhas, atualizarVariacao, atualizarCusto, adicionarVariacoes } = useCatalogo()
  const nova = !variacao
  const camposDoTipo = produto.tipo === 'lingerie' ? ['modelo', 'cor', 'tamanho'] : produto.tipo === 'cosmetico' ? ['tonalidade', 'volume'] : CAMPOS_VARIACAO
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(CAMPOS_VARIACAO.map((c) => [c, variacao?.[c] || ''])),
    preco: variacao ? paraCampoMoeda(variacao.preco) : '',
    custo: variacao?.custo != null ? paraCampoMoeda(variacao.custo) : '',
    minimo: String(variacao?.estoque_minimo ?? 1),
    codigo: variacao?.codigo_barras || '',
    gerar: false,
    ativo: variacao?.variacao_ativa ?? true,
  }))
  const [historico, setHistorico] = useState([])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!variacao) return
    supabase.from('historico_precos').select('preco_anterior, preco_novo, criado_em, perfis(nome)').eq('variacao_id', variacao.id)
      .order('criado_em', { ascending: false }).limit(10)
      .then(({ data }) => setHistorico(data || []))
  }, [variacao])

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const preco = lerValor(f.preco, { rotulo: 'o preço de venda', max: LIMITE.preco })
    if (preco.erro) return setErro(preco.erro)
    const custo = lerValor(f.custo, { rotulo: 'o custo', min: 0, max: LIMITE.preco, obrigatorio: false })
    if (custo.erro) return setErro(custo.erro)
    if (podeVerCustos && custo.valor > preco.valor) return setErro('O custo está maior que o preço de venda. Confira os dois valores.')
    const minimo = lerInteiro(f.minimo, { rotulo: 'o estoque mínimo', min: 0, max: LIMITE.estoqueMinimo, obrigatorio: false })
    if (minimo.erro) return setErro(minimo.erro)
    const codigo = f.gerar ? '' : f.codigo.trim()
    const erroCodigo = erroCodigoBarras(codigo)
    if (erroCodigo) return setErro(erroCodigo)
    const repetido = codigo && linhas.find((l) => l.codigo_barras === codigo && l.id !== variacao?.id)
    if (repetido) return setErro(`Esse código já é de ${repetido.produto.nome} (${repetido.nomeVariacao}).`)
    const campos = Object.fromEntries(camposDoTipo.map((c) => [c, limparTexto(f[c]) || null]))
    if (Object.values(campos).some((v) => v && v.length > TAMANHO.variacao)) return setErro(`Cada campo vai até ${TAMANHO.variacao} letras.`)
    if (nova && !Object.values(campos).some(Boolean) && produto.tipo !== 'outro') return setErro('Preencha pelo menos um campo (cor, tamanho, tonalidade...).')

    setSalvando(true)
    const dados = {
      ...campos, preco_venda: preco.valor, estoque_minimo: minimo.valor,
      codigo_barras: codigo || null, codigo_proprio: f.gerar || Boolean(variacao?.codigo_proprio && codigo === variacao.codigo_barras), ativo: f.ativo,
    }
    let r
    if (nova) r = await adicionarVariacoes(produto.id, [{ ...dados, custo: custo.valor }])
    else {
      r = await atualizarVariacao(variacao.id, dados)
      if (!r.erro && podeVerCustos && custo.valor !== (variacao.custo ?? 0)) r = await atualizarCusto(variacao.id, custo.valor)
    }
    setSalvando(false)
    if (r.erro) return setErro(r.erro.includes('já está cadastrado') ? 'Essa variação já existe neste produto, ou o código de barras já é de outra peça.' : r.erro)
    aoFechar()
  }

  return (
    <Modal titulo={nova ? 'Nova variação' : `${produto.nome} · ${descreverVariacao(variacao)}`} aoFechar={aoFechar}
      rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-variacao" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-variacao" className="formulario" onSubmit={salvar}>
        {produto.tipo !== 'kit' && (
          <div className="grade-campos">
            {camposDoTipo.map((c) => (
              <label key={c} className="campo"><span>{NOMES_CAMPO[c]}</span><input value={f[c]} onChange={(e) => setF({ ...f, [c]: e.target.value })} maxLength={TAMANHO.variacao} /></label>
            ))}
          </div>
        )}
        <div className="grade-campos">
          <label className="campo"><span>Preço de venda</span><input inputMode="decimal" value={f.preco} onChange={(e) => setF({ ...f, preco: filtroDinheiro(e.target.value) })} /></label>
          {podeVerCustos && <label className="campo"><span>Custo</span><input inputMode="decimal" value={f.custo} onChange={(e) => setF({ ...f, custo: filtroDinheiro(e.target.value) })} /></label>}
          <label className="campo"><span>Estoque mínimo</span><input inputMode="numeric" value={f.minimo} onChange={(e) => setF({ ...f, minimo: filtroInteiro(e.target.value, 3) })} /></label>
        </div>
        <label className="campo"><span>Código de barras</span><input value={f.gerar ? '' : f.codigo} disabled={f.gerar} onChange={(e) => setF({ ...f, codigo: e.target.value.replace(/\s/g, '') })} maxLength={30} inputMode="numeric" placeholder="Leia com o leitor ou digite" /></label>
        {!f.codigo && <label className="campo-check"><input type="checkbox" checked={f.gerar} onChange={(e) => setF({ ...f, gerar: e.target.checked })} /> Não tem código: o sistema cria um próprio</label>}
        {!nova && (
          <label className="campo-check"><input type="checkbox" checked={!f.ativo} onChange={(e) => setF({ ...f, ativo: !e.target.checked })} /> Fora de linha (não aparece mais na venda)</label>
        )}
        {historico.length > 0 && (
          <details className="perfil-fiscal">
            <summary><strong>Histórico de preço</strong></summary>
            <ul className="lista lista-compacta">
              {historico.map((h, i) => (
                <li key={i} className="linha-lista">
                  <span><strong>{h.preco_anterior == null ? `Cadastro: ${formatarMoeda(h.preco_novo)}` : `${formatarMoeda(h.preco_anterior)} → ${formatarMoeda(h.preco_novo)}`}</strong><small>{formatarDataHora(h.criado_em)}{h.perfis?.nome && ` · ${h.perfis.nome}`}</small></span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}

// Peças que formam o kit (ou a promoção "pague 1 leve 2": a mesma peça, quantidade 2)
function ItensDoKit({ kit, itens, admin, executar }) {
  const { linhas, salvarKitItem, removerKitItem } = useCatalogo()
  const opcoes = linhas.filter((l) => l.ativo && l.produto.tipo !== 'kit')
  const porId = new Map(linhas.map((l) => [l.id, l]))
  const somaPecas = itens.reduce((s, i) => s + (porId.get(i.componente_variacao_id)?.preco || 0) * i.quantidade, 0)

  return (
    <section className="cartao secao">
      <h2>Peças do kit</h2>
      {itens.length === 0 ? <p className="texto-suave pequeno">Nenhuma peça ainda. Escolha abaixo as peças que formam o kit.</p> : (
        <ul className="lista lista-compacta">
          {itens.map((i) => {
            const l = porId.get(i.componente_variacao_id)
            return (
              <li key={i.componente_variacao_id} className="linha-lista">
                <span><strong>{l ? `${l.produto.nome} (${l.nomeVariacao})` : 'Peça'}</strong><small>{l && formatarMoeda(l.preco)} cada</small></span>
                <span className="quantidade">
                  {admin && <button className="botao-icone" aria-label="Diminuir" onClick={() => executar(i.quantidade === 1 ? removerKitItem(kit.id, i.componente_variacao_id) : salvarKitItem(kit.id, i.componente_variacao_id, i.quantidade - 1))}><Icone nome={i.quantidade === 1 ? 'lixo' : 'subtrair'} tamanho={16} /></button>}
                  <span>{i.quantidade}</span>
                  {admin && <button className="botao-icone" aria-label="Aumentar" disabled={i.quantidade >= 99} onClick={() => executar(salvarKitItem(kit.id, i.componente_variacao_id, i.quantidade + 1))}><Icone nome="somar" tamanho={16} /></button>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {itens.length > 0 && (
        <p className="texto-suave pequeno">Separadas, as peças custariam {formatarMoeda(somaPecas)}. O kit sai por {formatarMoeda(kit.preco)}{somaPecas > kit.preco ? ` (desconto de ${formatarMoeda(somaPecas - kit.preco)})` : ''}.</p>
      )}
      {admin && itens.length < 20 && (
        <SeletorVariacao escolhida={null} opcoes={opcoes} aoEscolher={(l) => {
          if (!l) return
          const atual = itens.find((i) => i.componente_variacao_id === l.id)
          executar(salvarKitItem(kit.id, l.id, Math.min((atual?.quantidade || 0) + 1, 99)))
        }} />
      )}
    </section>
  )
}
