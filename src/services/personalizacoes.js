import db from "../database.js"

function numeroInteiro(valor, campo) {
    const numero = Number(valor)
    if (!Number.isSafeInteger(numero) || numero <= 0) {
        const erro = new Error(`${campo} inválido`)
        erro.statusCode = 400
        throw erro
    }
    return numero
}

export function normalizarBoolean(valor) {
    if (valor === true || valor === 1 || valor === "1") return true
    if (valor === false || valor === 0 || valor === "0") return false
    if (typeof valor === "string") {
        const texto = valor.trim().toLowerCase()
        if (["true", "1", "yes", "y"].includes(texto)) return true
        if (["false", "0", "no", "n", ""].includes(texto)) return false
    }
    return Boolean(valor)
}

function objeto(valor, campo) {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
        const erro = new Error(`${campo} deve ser um objeto`)
        erro.statusCode = 400
        throw erro
    }
    return valor
}

function selecionadoComoLista(valor) {
    return Array.isArray(valor) ? valor : [valor]
}

function condicaoAtendida(condicao, selecionados) {
    const opcoes = new Set(selecionados.flatMap(item => item.opcoes.map(opcao => opcao.id)))
    const personalizacoes = new Map(selecionados.map(item => [item.personalizacao.id, item]))
    const verificar = item => {
        if (item.opcao_id != null) return opcoes.has(Number(item.opcao_id))
        if (item.personalizacao_id != null) return personalizacoes.has(Number(item.personalizacao_id))
        return false
    }
    const condicoes = condicao.todas || condicao.all || []
    const alguma = condicao.alguma || condicao.any || []
    return (!condicoes.length || condicoes.every(verificar)) && (!alguma.length || alguma.some(verificar))
}

function validarRegras(regras, selecionados) {
    for (const regra of regras) {
        let definicao = regra.regra
        if (typeof definicao === "string") {
            try { definicao = JSON.parse(definicao) } catch { definicao = {} }
        }
        if (!definicao || !condicaoAtendida(definicao.quando || definicao.when || {}, selecionados)) continue

        const acao = definicao.acao || definicao.action
        const opcoes = new Set(selecionados.flatMap(item => item.opcoes.map(opcao => opcao.id)))
        const personalizacoes = new Set(selecionados.map(item => item.personalizacao.id))
        const alvoOpcoes = (definicao.opcao_ids || definicao.option_ids || []).map(Number)
        const alvoPersonalizacoes = (definicao.personalizacao_ids || definicao.customization_ids || []).map(Number)

        if (acao === "proibir" || acao === "forbid") {
            if (alvoOpcoes.some(id => opcoes.has(id)) || alvoPersonalizacoes.some(id => personalizacoes.has(id))) {
                const erro = new Error(regra.mensagem || "A combinação de personalizações não é permitida")
                erro.statusCode = 422
                throw erro
            }
        }
        if (acao === "obrigar" || acao === "require") {
            if (alvoPersonalizacoes.some(id => !personalizacoes.has(id))) {
                const erro = new Error(regra.mensagem || "A combinação exige outra personalização")
                erro.statusCode = 422
                throw erro
            }
        }
    }
}

export async function carregarConfigurador(produtoId, connection = db) {
    const id = numeroInteiro(produtoId, "Produto")
    const [produtos] = await connection.query("SELECT id, nome, preco, ativo, imagem, personalizavel FROM produtos WHERE id = ?", [id])
    if (!produtos.length) {
        const erro = new Error("Produto não encontrado")
        erro.statusCode = 404
        throw erro
    }
    if (!produtos[0].ativo) {
        const erro = new Error("Produto não está disponível")
        erro.statusCode = 404
        throw erro
    }
    if (!normalizarBoolean(produtos[0].personalizavel)) {
        const erro = new Error("Este produto não aceita personalização")
        erro.statusCode = 422
        throw erro
    }
    const [configuradores] = await connection.query("SELECT ativo, quantidade_angulos FROM produto_configuradores WHERE produto_id = ?", [id])
    const [imagens] = await connection.query(`
        SELECT id, tipo, angulo, url, ordem, ativo
        FROM produto_configurador_imagens WHERE produto_id = ? AND ativo = 1 ORDER BY tipo, angulo, ordem, id`, [id])
    const [personalizacoes] = await connection.query(`
        SELECT id, produto_id, nome, slug, tipo, obrigatoria, permite_valor_livre, valor_livre_maximo, ativo, ordem
        FROM produto_personalizacoes WHERE produto_id = ? ORDER BY ordem, id`, [id])
    const [opcoes] = await connection.query(`
        SELECT id, personalizacao_id, nome, descricao, valor_adicional, ativo, ordem, codigo_interno, estoque, visual
        FROM produto_personalizacao_opcoes WHERE personalizacao_id IN
        (SELECT id FROM produto_personalizacoes WHERE produto_id = ?) ORDER BY ordem, id`, [id])
    const [imagensOpcoes] = await connection.query(`
        SELECT id, opcao_id, modo, angulo, url, ordem, ativo
        FROM produto_personalizacao_imagens WHERE opcao_id IN
        (SELECT ppo.id FROM produto_personalizacao_opcoes ppo INNER JOIN produto_personalizacoes pp ON pp.id = ppo.personalizacao_id WHERE pp.produto_id = ?)
        AND ativo = 1 ORDER BY opcao_id, modo, angulo, ordem, id`, [id])
    const [regras] = await connection.query("SELECT id, regra, mensagem FROM produto_personalizacao_regras WHERE produto_id = ? AND ativo = 1", [id])
    const porPersonalizacao = new Map()
    for (const personalizacao of personalizacoes) {
        personalizacao.opcoes = []
        porPersonalizacao.set(personalizacao.id, personalizacao)
    }
    for (const opcao of opcoes) {
        if (opcao.visual && typeof opcao.visual === "string") {
            try { opcao.visual = JSON.parse(opcao.visual) } catch { opcao.visual = null }
        }
        opcao.imagens = imagensOpcoes.filter(imagem => imagem.opcao_id === opcao.id)
        porPersonalizacao.get(opcao.personalizacao_id)?.opcoes.push(opcao)
    }
    return {
        produto: produtos[0],
        configurador: configuradores[0] || { ativo: 0, quantidade_angulos: 1 },
        imagens,
        personalizacoes,
        regras
    }
}

export function configuracaoVazia(configuracao) {
    if (configuracao == null) return true
    if (typeof configuracao === "string") {
        const texto = configuracao.trim()
        if (!texto) return true
        try {
            return configuracaoVazia(JSON.parse(texto))
        } catch {
            return false
        }
    }
    if (Array.isArray(configuracao)) return configuracao.length === 0
    if (typeof configuracao === "object") {
        return Object.values(configuracao).every(item => {
            if (item == null) return true
            if (typeof item === "string") return item.trim() === ""
            if (Array.isArray(item)) return item.length === 0
            if (typeof item === "object") return configuracaoVazia(item)
            return false
        })
    }
    return false
}

export async function validarConfiguracao(produtoId, configuracao, connection = db) {
    if (configuracaoVazia(configuracao)) {
        const [produtos] = await connection.query("SELECT id, nome, preco, ativo, personalizavel FROM produtos WHERE id = ?", [produtoId])
        if (!produtos.length) {
            const erro = new Error("Produto não encontrado")
            erro.statusCode = 404
            throw erro
        }
        if (!normalizarBoolean(produtos[0].personalizavel)) {
            return {
                produto: { id: produtos[0].id, nome: produtos[0].nome },
                configuracao: [],
                precoBase: Number(produtos[0].preco || 0),
                adicionais: [],
                precoFinal: Number(produtos[0].preco || 0)
            }
        }
        throw Object.assign(new Error("Informe a personalização do produto"), { statusCode: 422 })
    }

    const dados = await carregarConfigurador(produtoId, connection)
    if (!normalizarBoolean(dados.produto.personalizavel)) {
        throw Object.assign(new Error("Este produto não aceita personalização"), { statusCode: 422 })
    }
    let entrada = configuracao
    if (Array.isArray(configuracao)) {
        entrada = {}
        for (const item of configuracao) {
            const personalizacao = dados.personalizacoes.find(atual => atual.id === Number(item.personalizacaoId))
            if (!personalizacao) throw Object.assign(new Error("Snapshot de configuração inválido"), { statusCode: 422 })
            const valores = item.opcoes?.map(opcao => opcao.id) || []
            if (item.valorLivre != null) valores.push(item.valorLivre)
            entrada[personalizacao.slug] = valores.length === 1 ? valores[0] : valores
        }
    }
    entrada = objeto(entrada, "configuracao")
    const porChave = new Map(dados.personalizacoes.flatMap(item => [[String(item.id), item], [item.slug, item]]))
    const selecionados = []

    for (const [chave, valor] of Object.entries(entrada)) {
        const personalizacao = porChave.get(chave)
        if (!personalizacao) {
            const erro = new Error(`Personalização ${chave} não pertence ao produto`)
            erro.statusCode = 422
            throw erro
        }
        if (!personalizacao.ativo) continue
        const valores = selecionadoComoLista(valor)
        const opcoes = []
        let valorLivre = null
        for (const item of valores) {
            const id = Number(item)
            const opcao = Number.isSafeInteger(id) ? personalizacao.opcoes.find(opcaoAtual => opcaoAtual.id === id) : null
            if (opcao) {
                if (!opcao.ativo) throw Object.assign(new Error(`A opção ${opcao.nome} está inativa`), { statusCode: 422 })
                opcoes.push(opcao)
            } else if (personalizacao.permite_valor_livre && typeof item === "string") {
                if (item.length > Number(personalizacao.valor_livre_maximo || 255)) throw Object.assign(new Error(`Valor livre excede o limite de ${personalizacao.valor_livre_maximo} caracteres`), { statusCode: 422 })
                valorLivre = item
            } else {
                throw Object.assign(new Error(`Opção inválida para ${personalizacao.nome}`), { statusCode: 422 })
            }
        }
        selecionados.push({ personalizacao, opcoes, valorLivre })
    }

    for (const personalizacao of dados.personalizacoes) {
        if (personalizacao.ativo && personalizacao.obrigatoria && !selecionados.some(item => item.personalizacao.id === personalizacao.id)) {
            throw Object.assign(new Error(`A personalização ${personalizacao.nome} é obrigatória`), { statusCode: 422 })
        }
    }
    validarRegras(dados.regras, selecionados)
    const adicionais = selecionados.flatMap(item => item.opcoes).map(opcao => ({
        nome: opcao.nome,
        valor: Number(opcao.valor_adicional || 0)
    }))
    const totalAdicionais = adicionais.reduce((total, adicional) => total + adicional.valor, 0)
    const precoBase = Number(dados.produto.preco)
    return {
        produto: { id: dados.produto.id, nome: dados.produto.nome },
        configuracao: selecionados.map(item => ({ personalizacaoId: item.personalizacao.id, nome: item.personalizacao.nome, opcoes: item.opcoes.map(opcao => ({ id: opcao.id, nome: opcao.nome, valorAdicional: Number(opcao.valor_adicional || 0), visual: opcao.visual })), valorLivre: item.valorLivre })),
        precoBase,
        adicionais,
        precoFinal: Number((precoBase + totalAdicionais).toFixed(2))
    }
}

export function serializarProdutoPublico(produto, variacoes = [], dadosConfigurador = null) {
    const configurador = dadosConfigurador?.configurador || { ativo: 0, quantidade_angulos: 1 }
    const personalizacoes = Array.isArray(dadosConfigurador?.personalizacoes) ? dadosConfigurador.personalizacoes.filter(item => item.ativo).map(item => ({
        ...item,
        opcoes: (item.opcoes || []).filter(opcao => opcao.ativo).map(opcao => ({
            ...opcao,
            valorAdicional: Number(opcao.valor_adicional ?? 0),
            imagens: opcao.imagens || []
        }))
    })) : []
    const regras = Array.isArray(dadosConfigurador?.regras) ? dadosConfigurador.regras : []
    return {
        ...produto,
        personalizavel: normalizarBoolean(produto.personalizavel),
        configurador: {
            ...configurador,
            quantidadeAngulos: Number(configurador.quantidade_angulos ?? 1),
            imagens: Array.isArray(dadosConfigurador?.imagens) ? dadosConfigurador.imagens.filter(item => item.tipo === "base" || item.tipo === "angulo") : []
        },
        personalizacoes,
        regras,
        variacoes: Array.isArray(variacoes) ? variacoes : []
    }
}

export { numeroInteiro }