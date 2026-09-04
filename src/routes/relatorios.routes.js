// ================================================================
// RELATÓRIOS GERENCIAIS - CENTRAL DE RELATÓRIOS DO PAINEL ADMIN
// ================================================================
// Depende da biblioteca "pdfkit" para geração de PDF.
// Caso ainda não esteja instalada: npm install pdfkit
// ================================================================

import express from "express"
import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import db from "../database.js"
import upload, { pastaRelatorios } from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { apenasAdmin } from "../middlewares/autorizacao.js"

const router = express.Router()
router.use(autenticarToken, apenasAdmin)


// ================================
// HELPERS - PERÍODO
// ================================

function obterPeriodo(req) {

    const corpo = req.body || {}

    const hoje = new Date()
    const padraoFim = hoje.toISOString().slice(0, 10)
    const padraoInicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 29)
        .toISOString()
        .slice(0, 10)

    const dataInicio = req.query.data_inicio || corpo.data_inicio || padraoInicio
    const dataFim = req.query.data_fim || corpo.data_fim || padraoFim

    const inicio = new Date(`${dataInicio}T00:00:00`)
    const fim = new Date(`${dataFim}T00:00:00`)

    const diffDias = Math.max(
        Math.round((fim - inicio) / (1000 * 60 * 60 * 24)) + 1,
        1
    )

    const inicioAnterior = new Date(inicio)
    inicioAnterior.setDate(inicioAnterior.getDate() - diffDias)

    const fimAnterior = new Date(inicio)
    fimAnterior.setDate(fimAnterior.getDate() - 1)

    return {
        dataInicio,
        dataFim,
        dataInicioAnterior: inicioAnterior.toISOString().slice(0, 10),
        dataFimAnterior: fimAnterior.toISOString().slice(0, 10)
    }
}

function calcularVariacao(atual, anterior) {
    if (!anterior) return atual > 0 ? 100 : 0
    return Number((((atual - anterior) / anterior) * 100).toFixed(1))
}

function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    })
}

function formatarDataBR(data) {
    if (!data) return "-"
    const d = new Date(data)
    return d.toLocaleDateString("pt-BR", { timeZone: "UTC" })
}


// ================================
// HELPERS - CONSULTAS REUTILIZÁVEIS
// (reaproveitadas pelas rotas JSON e pela geração de PDF)
// ================================

async function buscarResumoFinanceiro(dataInicio, dataFim) {

    const [[resumo]] = await db.query(`
        SELECT
            COUNT(*) AS quantidadePedidos,
            COALESCE(SUM(total), 0) AS faturamento,
            COALESCE(AVG(total), 0) AS ticketMedio
        FROM pedidos
        WHERE status_pedido IN ('entregue')
        AND DATE(criado_em) BETWEEN ? AND ?
    `, [dataInicio, dataFim])

    return {
        quantidadePedidos: Number(resumo.quantidadePedidos),
        faturamento: Number(resumo.faturamento),
        ticketMedio: Number(resumo.ticketMedio)
    }
}

async function buscarVendasPorPeriodo(dataInicio, dataFim) {

    const [vendas] = await db.query(`
        SELECT
            DATE(criado_em) AS data,
            COUNT(*) AS quantidadePedidos,
            COALESCE(SUM(total), 0) AS faturamento
        FROM pedidos
        WHERE status_pedido IN ('entregue')
        AND DATE(criado_em) BETWEEN ? AND ?
        GROUP BY DATE(criado_em)
        ORDER BY data ASC
    `, [dataInicio, dataFim])

    return vendas.map(venda => ({
        data: venda.data,
        quantidadePedidos: Number(venda.quantidadePedidos),
        faturamento: Number(venda.faturamento)
    }))
}

async function buscarProdutosMaisVendidos(dataInicio, dataFim, limite = 10) {

    const [produtos] = await db.query(`
        SELECT
            p.id,
            p.nome,
            p.imagem,
            c.nome AS categoria,
            SUM(pi.quantidade) AS totalVendas,
            SUM(pi.quantidade * pi.preco_unitario) AS faturamento
        FROM pedidos_itens pi
        INNER JOIN produtos p
            ON p.id = pi.produto_id
        LEFT JOIN categorias c
            ON c.id = p.categoria_id
        INNER JOIN pedidos ped
            ON ped.id = pi.pedido_id
        WHERE ped.status_pedido IN ('entregue')
        AND DATE(ped.criado_em) BETWEEN ? AND ?
        GROUP BY p.id, p.nome, p.imagem, c.nome
        ORDER BY totalVendas DESC
        LIMIT ?
    `, [dataInicio, dataFim, limite])

    return produtos.map(produto => ({
        id: produto.id,
        nome: produto.nome,
        imagem: produto.imagem,
        categoria: produto.categoria,
        totalVendas: Number(produto.totalVendas),
        faturamento: Number(produto.faturamento)
    }))
}

async function buscarCategoriasMaisVendidas(dataInicio, dataFim, limite = 10) {

    const [categorias] = await db.query(`
        SELECT
            c.id,
            c.nome AS categoria,
            SUM(pi.quantidade) AS produtosVendidos,
            SUM(pi.quantidade * pi.preco_unitario) AS faturamento
        FROM pedidos_itens pi
        INNER JOIN produtos p
            ON p.id = pi.produto_id
        INNER JOIN categorias c
            ON c.id = p.categoria_id
        INNER JOIN pedidos ped
            ON ped.id = pi.pedido_id
        WHERE ped.status_pedido IN ('entregue')
        AND DATE(ped.criado_em) BETWEEN ? AND ?
        GROUP BY c.id, c.nome
        ORDER BY faturamento DESC
        LIMIT ?
    `, [dataInicio, dataFim, limite])

    return categorias.map(categoria => ({
        id: categoria.id,
        categoria: categoria.categoria,
        produtosVendidos: Number(categoria.produtosVendidos),
        faturamento: Number(categoria.faturamento)
    }))
}

async function buscarClientesQueMaisCompraram(dataInicio, dataFim, limite = 10) {

    const [clientes] = await db.query(`
        SELECT
            u.id,
            u.nome,
            u.email,
            COUNT(p.id) AS quantidadePedidos,
            COALESCE(SUM(p.total), 0) AS totalGasto
        FROM pedidos p
        INNER JOIN usuarios u
            ON u.id = p.usuario_id
        WHERE p.status_pedido IN ('entregue')
        AND DATE(p.criado_em) BETWEEN ? AND ?
        GROUP BY u.id, u.nome, u.email
        ORDER BY totalGasto DESC
        LIMIT ?
    `, [dataInicio, dataFim, limite])

    return clientes.map(cliente => ({
        id: cliente.id,
        nome: cliente.nome,
        email: cliente.email,
        quantidadePedidos: Number(cliente.quantidadePedidos),
        totalGasto: Number(cliente.totalGasto)
    }))
}

async function buscarProdutosEstoqueBaixo() {

    const [produtos] = await db.query(`
        SELECT
            p.id,
            p.nome,
            p.estoque,
            p.estoque_minimo,
            p.imagem,
            c.nome AS categoria
        FROM produtos p
        LEFT JOIN categorias c
            ON c.id = p.categoria_id
        WHERE p.estoque <= p.estoque_minimo
        ORDER BY p.estoque ASC
    `)

    return produtos
}

async function buscarProdutosSemMovimentacao(dataInicio, dataFim) {

    const [produtos] = await db.query(`
        SELECT
            p.id,
            p.nome,
            p.estoque,
            p.preco,
            p.imagem,
            p.created_at,
            c.nome AS categoria
        FROM produtos p
        LEFT JOIN categorias c
            ON c.id = p.categoria_id
        WHERE p.ativo = 1
        AND NOT EXISTS (
            SELECT 1
            FROM pedidos_itens pi
            INNER JOIN pedidos ped
                ON ped.id = pi.pedido_id
            WHERE pi.produto_id = p.id
            AND ped.status_pedido IN ('entregue')
            AND DATE(ped.criado_em) BETWEEN ? AND ?
        )
        ORDER BY p.created_at DESC
    `, [dataInicio, dataFim])

    return produtos
}

async function buscarEvolucaoMensal(meses = 12) {

    const [evolucao] = await db.query(`
        SELECT
            YEAR(criado_em) AS ano,
            MONTH(criado_em) AS mes,
            COUNT(*) AS quantidadePedidos,
            COALESCE(SUM(total), 0) AS faturamento
        FROM pedidos
        WHERE status_pedido IN ('entregue')
        AND criado_em >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        GROUP BY YEAR(criado_em), MONTH(criado_em)
        ORDER BY ano ASC, mes ASC
    `, [meses])

    return evolucao.map(item => ({
        ano: item.ano,
        mes: item.mes,
        quantidadePedidos: Number(item.quantidadePedidos),
        faturamento: Number(item.faturamento)
    }))
}


// ================================
// RELATÓRIO FINANCEIRO
// ================================

router.get("/financeiro", async (req, res) => {
    try {

        const { dataInicio, dataFim, dataInicioAnterior, dataFimAnterior } = obterPeriodo(req)

        const [atual, anterior] = await Promise.all([
            buscarResumoFinanceiro(dataInicio, dataFim),
            buscarResumoFinanceiro(dataInicioAnterior, dataFimAnterior)
        ])

        return res.json({
            periodo: { dataInicio, dataFim },
            periodoAnterior: { dataInicio: dataInicioAnterior, dataFim: dataFimAnterior },
            atual,
            anterior,
            variacao: {
                faturamento: calcularVariacao(atual.faturamento, anterior.faturamento),
                quantidadePedidos: calcularVariacao(atual.quantidadePedidos, anterior.quantidadePedidos),
                ticketMedio: calcularVariacao(atual.ticketMedio, anterior.ticketMedio)
            }
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar relatório financeiro"
        })
    }
})


// ================================
// VENDAS POR PERÍODO
// ================================

router.get("/vendas-periodo", async (req, res) => {
    try {

        const { dataInicio, dataFim } = obterPeriodo(req)
        const vendas = await buscarVendasPorPeriodo(dataInicio, dataFim)

        return res.json({
            periodo: { dataInicio, dataFim },
            vendas
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar vendas por período"
        })
    }
})


// ================================
// PRODUTOS MAIS VENDIDOS
// ================================

router.get("/produtos-mais-vendidos", async (req, res) => {
    try {

        const { dataInicio, dataFim } = obterPeriodo(req)
        const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 100)

        const produtos = await buscarProdutosMaisVendidos(dataInicio, dataFim, limite)

        return res.json({
            periodo: { dataInicio, dataFim },
            produtos
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar produtos mais vendidos"
        })
    }
})


// ================================
// CATEGORIAS MAIS VENDIDAS
// ================================

router.get("/categorias-mais-vendidas", async (req, res) => {
    try {

        const { dataInicio, dataFim } = obterPeriodo(req)
        const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 100)

        const categorias = await buscarCategoriasMaisVendidas(dataInicio, dataFim, limite)

        return res.json({
            periodo: { dataInicio, dataFim },
            categorias
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar categorias mais vendidas"
        })
    }
})


// ================================
// CLIENTES QUE MAIS COMPRARAM
// ================================

router.get("/clientes-top", async (req, res) => {
    try {

        const { dataInicio, dataFim } = obterPeriodo(req)
        const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 100)

        const clientes = await buscarClientesQueMaisCompraram(dataInicio, dataFim, limite)

        return res.json({
            periodo: { dataInicio, dataFim },
            clientes
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar clientes que mais compraram"
        })
    }
})


// ================================
// PRODUTOS COM ESTOQUE BAIXO
// ================================

router.get("/estoque-baixo", async (req, res) => {
    try {

        const produtos = await buscarProdutosEstoqueBaixo()

        return res.json({ produtos })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar produtos com estoque baixo"
        })
    }
})


// ================================
// PRODUTOS SEM MOVIMENTAÇÃO / VENDAS
// ================================

router.get("/produtos-sem-movimentacao", async (req, res) => {
    try {

        const { dataInicio, dataFim } = obterPeriodo(req)
        const produtos = await buscarProdutosSemMovimentacao(dataInicio, dataFim)

        return res.json({
            periodo: { dataInicio, dataFim },
            produtos
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar produtos sem movimentação"
        })
    }
})


// ================================
// EVOLUÇÃO MENSAL DE FATURAMENTO
// ================================

router.get("/evolucao-mensal", async (req, res) => {
    try {

        const meses = Math.min(Math.max(Number(req.query.meses) || 12, 1), 36)
        const evolucao = await buscarEvolucaoMensal(meses)

        return res.json({ meses, evolucao })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar evolução mensal de faturamento"
        })
    }
})


// ================================
// RESUMO EXECUTIVO CONSOLIDADO
// ================================

router.get("/resumo-executivo", async (req, res) => {
    try {

        const { dataInicio, dataFim, dataInicioAnterior, dataFimAnterior } = obterPeriodo(req)

        const [
            financeiroAtual,
            financeiroAnterior,
            produtosMaisVendidos,
            categoriasMaisVendidas,
            clientesTop,
            estoqueBaixo,
            semMovimentacao,
            evolucaoMensal
        ] = await Promise.all([
            buscarResumoFinanceiro(dataInicio, dataFim),
            buscarResumoFinanceiro(dataInicioAnterior, dataFimAnterior),
            buscarProdutosMaisVendidos(dataInicio, dataFim, 5),
            buscarCategoriasMaisVendidas(dataInicio, dataFim, 5),
            buscarClientesQueMaisCompraram(dataInicio, dataFim, 5),
            buscarProdutosEstoqueBaixo(),
            buscarProdutosSemMovimentacao(dataInicio, dataFim),
            buscarEvolucaoMensal(6)
        ])

        return res.json({
            periodo: { dataInicio, dataFim },
            periodoAnterior: { dataInicio: dataInicioAnterior, dataFim: dataFimAnterior },

            financeiro: {
                ...financeiroAtual,
                variacao: {
                    faturamento: calcularVariacao(financeiroAtual.faturamento, financeiroAnterior.faturamento),
                    quantidadePedidos: calcularVariacao(financeiroAtual.quantidadePedidos, financeiroAnterior.quantidadePedidos),
                    ticketMedio: calcularVariacao(financeiroAtual.ticketMedio, financeiroAnterior.ticketMedio)
                }
            },

            produtosMaisVendidos,
            categoriasMaisVendidas,
            clientesTop,

            alertas: {
                estoqueBaixo: estoqueBaixo.length,
                semMovimentacao: semMovimentacao.length
            },

            estoqueBaixo: estoqueBaixo.slice(0, 5),
            produtosSemMovimentacao: semMovimentacao.slice(0, 5),
            evolucaoMensal
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar resumo executivo"
        })
    }
})


// ================================
// GERAÇÃO DE PDF
// ================================

const TIPOS_RELATORIO = {

    financeiro: {
        titulo: "Relatório Financeiro",
        async gerar(dataInicio, dataFim, dataInicioAnterior, dataFimAnterior) {
            const [atual, anterior] = await Promise.all([
                buscarResumoFinanceiro(dataInicio, dataFim),
                buscarResumoFinanceiro(dataInicioAnterior, dataFimAnterior)
            ])
            return { atual, anterior }
        }
    },

    "vendas-periodo": {
        titulo: "Vendas por Período",
        async gerar(dataInicio, dataFim) {
            return { vendas: await buscarVendasPorPeriodo(dataInicio, dataFim) }
        }
    },

    "produtos-mais-vendidos": {
        titulo: "Produtos Mais Vendidos",
        async gerar(dataInicio, dataFim) {
            return { produtos: await buscarProdutosMaisVendidos(dataInicio, dataFim, 30) }
        }
    },

    "categorias-mais-vendidas": {
        titulo: "Categorias Mais Vendidas",
        async gerar(dataInicio, dataFim) {
            return { categorias: await buscarCategoriasMaisVendidas(dataInicio, dataFim, 30) }
        }
    },

    "clientes-top": {
        titulo: "Clientes que Mais Compraram",
        async gerar(dataInicio, dataFim) {
            return { clientes: await buscarClientesQueMaisCompraram(dataInicio, dataFim, 30) }
        }
    },

    "estoque-baixo": {
        titulo: "Produtos com Estoque Baixo",
        async gerar() {
            return { produtos: await buscarProdutosEstoqueBaixo() }
        }
    },

    "produtos-sem-movimentacao": {
        titulo: "Produtos sem Movimentação",
        async gerar(dataInicio, dataFim) {
            return { produtos: await buscarProdutosSemMovimentacao(dataInicio, dataFim) }
        }
    },

    "evolucao-mensal": {
        titulo: "Evolução Mensal de Faturamento",
        async gerar() {
            return { evolucao: await buscarEvolucaoMensal(12) }
        }
    },

    "resumo-executivo": {
        titulo: "Resumo Executivo",
        async gerar(dataInicio, dataFim, dataInicioAnterior, dataFimAnterior) {
            const [financeiroAtual, financeiroAnterior, produtos, categorias, clientes, estoqueBaixo, semMovimentacao] = await Promise.all([
                buscarResumoFinanceiro(dataInicio, dataFim),
                buscarResumoFinanceiro(dataInicioAnterior, dataFimAnterior),
                buscarProdutosMaisVendidos(dataInicio, dataFim, 5),
                buscarCategoriasMaisVendidas(dataInicio, dataFim, 5),
                buscarClientesQueMaisCompraram(dataInicio, dataFim, 5),
                buscarProdutosEstoqueBaixo(),
                buscarProdutosSemMovimentacao(dataInicio, dataFim)
            ])
            return { financeiroAtual, financeiroAnterior, produtos, categorias, clientes, estoqueBaixo, semMovimentacao }
        }
    }
}

function desenharCabecalho(doc, titulo, periodo) {

    doc
        .fontSize(18)
        .fillColor("#1a1a1a")
        .text("Joalheria - Relatório Gerencial", { align: "center" })
        .moveDown(0.3)

    doc
        .fontSize(14)
        .fillColor("#333333")
        .text(titulo, { align: "center" })
        .moveDown(0.3)

    if (periodo) {
        doc
            .fontSize(10)
            .fillColor("#666666")
            .text(`Período: ${formatarDataBR(periodo.dataInicio)} a ${formatarDataBR(periodo.dataFim)}`, { align: "center" })
    }

    doc
        .fontSize(9)
        .fillColor("#999999")
        .text(`Gerado em: ${formatarDataBR(new Date())}`, { align: "center" })
        .moveDown(1)

    doc
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .strokeColor("#dddddd")
        .stroke()
        .moveDown(1)

    doc.fillColor("#000000")
}

function desenharTabela(doc, colunas, linhas, larguraTotal = 495) {

    const xInicial = 50
    const larguraColuna = larguraTotal / colunas.length

    let y = doc.y

    doc.rect(xInicial, y, larguraTotal, 20).fill("#8a6d3b")
    doc.fontSize(9).fillColor("#ffffff")
    colunas.forEach((coluna, i) => {
        doc.text(coluna.titulo, xInicial + i * larguraColuna + 4, y + 6, {
            width: larguraColuna - 8
        })
    })
    y += 22

    if (!linhas || linhas.length === 0) {
        doc.fontSize(9).fillColor("#666666").text("Nenhum registro encontrado para o período selecionado.", xInicial + 4, y + 4)
        doc.y = y + 22
        return
    }

    linhas.forEach((linha, index) => {

        if (y > 760) {
            doc.addPage()
            y = 50
        }

        if (index % 2 === 0) {
            doc.rect(xInicial, y, larguraTotal, 18).fill("#f5f5f5")
        }

        doc.fontSize(9).fillColor("#333333")
        colunas.forEach((coluna, i) => {
            const texto = String(coluna.valor(linha) ?? "-")
            doc.text(texto, xInicial + i * larguraColuna + 4, y + 4, {
                width: larguraColuna - 8
            })
        })

        y += 18
    })

    doc.y = y + 10
    doc.fillColor("#000000")
}

function desenharConteudo(doc, tipo, dados) {

    switch (tipo) {

        case "financeiro": {
            doc.fontSize(12).text("Resumo do Período", { underline: true }).moveDown(0.5)
            doc.fontSize(10)
            doc.text(`Faturamento: ${formatarMoeda(dados.atual.faturamento)}`)
            doc.text(`Quantidade de pedidos: ${dados.atual.quantidadePedidos}`)
            doc.text(`Ticket médio: ${formatarMoeda(dados.atual.ticketMedio)}`)
            doc.moveDown(1)

            doc.fontSize(12).text("Comparação com o período anterior", { underline: true }).moveDown(0.5)
            doc.fontSize(10)
            doc.text(`Faturamento anterior: ${formatarMoeda(dados.anterior.faturamento)}`)
            doc.text(`Pedidos no período anterior: ${dados.anterior.quantidadePedidos}`)
            doc.text(`Variação de faturamento: ${calcularVariacao(dados.atual.faturamento, dados.anterior.faturamento)}%`)
            doc.text(`Variação de pedidos: ${calcularVariacao(dados.atual.quantidadePedidos, dados.anterior.quantidadePedidos)}%`)
            break
        }

        case "vendas-periodo":
            desenharTabela(doc, [
                { titulo: "Data", valor: l => formatarDataBR(l.data) },
                { titulo: "Pedidos", valor: l => l.quantidadePedidos },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.vendas)
            break

        case "produtos-mais-vendidos":
            desenharTabela(doc, [
                { titulo: "Produto", valor: l => l.nome },
                { titulo: "Categoria", valor: l => l.categoria },
                { titulo: "Qtd. vendida", valor: l => l.totalVendas },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.produtos)
            break

        case "categorias-mais-vendidas":
            desenharTabela(doc, [
                { titulo: "Categoria", valor: l => l.categoria },
                { titulo: "Qtd. vendida", valor: l => l.produtosVendidos },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.categorias)
            break

        case "clientes-top":
            desenharTabela(doc, [
                { titulo: "Cliente", valor: l => l.nome },
                { titulo: "E-mail", valor: l => l.email },
                { titulo: "Pedidos", valor: l => l.quantidadePedidos },
                { titulo: "Total gasto", valor: l => formatarMoeda(l.totalGasto) }
            ], dados.clientes)
            break

        case "estoque-baixo":
            desenharTabela(doc, [
                { titulo: "Produto", valor: l => l.nome },
                { titulo: "Categoria", valor: l => l.categoria },
                { titulo: "Estoque", valor: l => l.estoque },
                { titulo: "Estoque mínimo", valor: l => l.estoque_minimo }
            ], dados.produtos)
            break

        case "produtos-sem-movimentacao":
            desenharTabela(doc, [
                { titulo: "Produto", valor: l => l.nome },
                { titulo: "Categoria", valor: l => l.categoria },
                { titulo: "Estoque", valor: l => l.estoque },
                { titulo: "Preço", valor: l => formatarMoeda(l.preco) }
            ], dados.produtos)
            break

        case "evolucao-mensal":
            desenharTabela(doc, [
                { titulo: "Mês", valor: l => `${String(l.mes).padStart(2, "0")}/${l.ano}` },
                { titulo: "Pedidos", valor: l => l.quantidadePedidos },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.evolucao)
            break

        case "resumo-executivo": {
            doc.fontSize(12).text("Financeiro", { underline: true }).moveDown(0.3)
            doc.fontSize(10)
            doc.text(`Faturamento: ${formatarMoeda(dados.financeiroAtual.faturamento)}`)
            doc.text(`Pedidos: ${dados.financeiroAtual.quantidadePedidos}`)
            doc.text(`Ticket médio: ${formatarMoeda(dados.financeiroAtual.ticketMedio)}`)
            doc.text(`Variação de faturamento: ${calcularVariacao(dados.financeiroAtual.faturamento, dados.financeiroAnterior.faturamento)}%`)
            doc.moveDown(1)

            doc.fontSize(12).text("Produtos mais vendidos", { underline: true }).moveDown(0.3)
            desenharTabela(doc, [
                { titulo: "Produto", valor: l => l.nome },
                { titulo: "Qtd.", valor: l => l.totalVendas },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.produtos)
            doc.moveDown(0.5)

            doc.fontSize(12).text("Categorias mais vendidas", { underline: true }).moveDown(0.3)
            desenharTabela(doc, [
                { titulo: "Categoria", valor: l => l.categoria },
                { titulo: "Faturamento", valor: l => formatarMoeda(l.faturamento) }
            ], dados.categorias)
            doc.moveDown(0.5)

            doc.fontSize(12).text("Clientes que mais compraram", { underline: true }).moveDown(0.3)
            desenharTabela(doc, [
                { titulo: "Cliente", valor: l => l.nome },
                { titulo: "Total gasto", valor: l => formatarMoeda(l.totalGasto) }
            ], dados.clientes)
            doc.moveDown(0.5)

            doc.fontSize(12).text("Alertas de estoque", { underline: true }).moveDown(0.3)
            doc.fontSize(10)
            doc.text(`Produtos com estoque baixo: ${dados.estoqueBaixo.length}`)
            doc.text(`Produtos sem movimentação no período: ${dados.semMovimentacao.length}`)
            break
        }

        default:
            doc.fontSize(10).text("Tipo de relatório não suportado para exportação em PDF.")
    }
}

router.post("/gerar-pdf", async (req, res) => {
    try {

        const { tipo } = req.body

        if (!tipo || !TIPOS_RELATORIO[tipo]) {
            return res.status(400).json({
                erro: "Tipo de relatório inválido",
                tiposDisponiveis: Object.keys(TIPOS_RELATORIO)
            })
        }

        const { dataInicio, dataFim, dataInicioAnterior, dataFimAnterior } = obterPeriodo(req)

        const config = TIPOS_RELATORIO[tipo]
        const dados = await config.gerar(dataInicio, dataFim, dataInicioAnterior, dataFimAnterior)

        const nomeArquivo = `${tipo}_${dataInicio}_${dataFim}_${Date.now()}.pdf`
        const caminhoCompleto = path.join(pastaRelatorios, nomeArquivo)

        const doc = new PDFDocument({ size: "A4", margin: 50 })
        const stream = fs.createWriteStream(caminhoCompleto)
        doc.pipe(stream)

        desenharCabecalho(doc, config.titulo, { dataInicio, dataFim })
        desenharConteudo(doc, tipo, dados)

        doc.end()

        await new Promise((resolve, reject) => {
            stream.on("finish", resolve)
            stream.on("error", reject)
        })

        const geradoPor = req.usuario?.id || null

        const [resultado] = await db.query(
            `insert into relatorios_gerados (tipo, periodo_inicio, periodo_fim, arquivo_pdf, gerado_por)
             values (?, ?, ?, ?, ?)`,
            [tipo, dataInicio, dataFim, nomeArquivo, geradoPor]
        )

        const [[relatorio]] = await db.query(
            `select * from relatorios_gerados where id = ?`,
            [resultado.insertId]
        )

        return res.status(201).json({
            mensagem: "Relatório gerado com sucesso",
            relatorio,
            urlDownload: `/relatorios/historico/${relatorio.id}/download`
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao gerar o relatório em PDF"
        })
    }
})


// ================================
// HISTÓRICO DE RELATÓRIOS GERADOS
// ================================

router.get("/historico", async (req, res) => {
    try {

        const pagina = Math.max(Number(req.query.pagina) || 1, 1)
        const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 100)
        const offset = (pagina - 1) * limite

        const { tipo } = req.query

        const condicoes = []
        const parametros = []

        if (tipo) {
            condicoes.push("rg.tipo = ?")
            parametros.push(tipo)
        }

        const whereSql = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""

        const [relatorios] = await db.query(
            `
            SELECT
                rg.id,
                rg.tipo,
                rg.periodo_inicio,
                rg.periodo_fim,
                rg.arquivo_pdf,
                rg.gerado_por,
                u.nome AS gerado_por_nome,
                rg.data_geracao
            FROM relatorios_gerados rg
            LEFT JOIN usuarios u
                ON u.id = rg.gerado_por
            ${whereSql}
            ORDER BY rg.data_geracao DESC
            LIMIT ? OFFSET ?
            `,
            [...parametros, limite, offset]
        )

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM relatorios_gerados rg ${whereSql}`,
            parametros
        )

        return res.json({
            pagina,
            limite,
            total: Number(total),
            totalPaginas: Math.ceil(total / limite),
            relatorios
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao carregar o histórico de relatórios"
        })
    }
})

router.get("/historico/:id/download", async (req, res) => {
    try {

        const { id } = req.params

        const [[relatorio]] = await db.query(
            `select * from relatorios_gerados where id = ?`,
            [id]
        )

        if (!relatorio) {
            return res.status(404).json({
                erro: "Relatório não encontrado"
            })
        }

        const caminhoArquivo = path.join(pastaRelatorios, relatorio.arquivo_pdf)

        if (!fs.existsSync(caminhoArquivo)) {
            return res.status(404).json({
                erro: "Arquivo do relatório não foi encontrado no servidor"
            })
        }

        return res.download(caminhoArquivo, relatorio.arquivo_pdf)

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao baixar o relatório"
        })
    }
})

router.delete("/historico/:id", async (req, res) => {
    try {

        const { id } = req.params

        const [[relatorio]] = await db.query(
            `select * from relatorios_gerados where id = ?`,
            [id]
        )

        if (!relatorio) {
            return res.status(404).json({
                erro: "Relatório não encontrado"
            })
        }

        await db.query(`delete from relatorios_gerados where id = ?`, [id])

        const caminhoArquivo = path.join(pastaRelatorios, relatorio.arquivo_pdf)
        if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo)
        }

        return res.status(200).json({
            mensagem: "Relatório excluído com sucesso"
        })

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao excluir o relatório"
        })
    }
})

export default router