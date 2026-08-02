import express from "express"
import db from "../database.js"

const router = express.Router()

// ================================
// MÉTRICAS GERAIS
// ================================

router.get("/metricas", async (req, res) => {

    try {

        const [[totalProdutos]] = await db.query(`
            SELECT COUNT(*) AS total
            FROM produtos
        `)

        const [[produtosAtivos]] = await db.query(`
            SELECT COUNT(*) AS total
            FROM produtos
            WHERE ativo = 1
        `)

        const [[valorEstoque]] = await db.query(`
            SELECT
                COALESCE(SUM(preco * estoque), 0) AS total
            FROM produtos
        `)

        const [[itensEstoque]] = await db.query(`
            SELECT
                COALESCE(SUM(estoque), 0) AS total
            FROM produtos
        `)

        return res.json({
            totalProdutos: totalProdutos.total,
            produtosAtivos: produtosAtivos.total,
            valorEstoque: valorEstoque.total,
            itensEstoque: itensEstoque.total
        })

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar métricas"
        })

    }

})


// ================================
// ESTOQUE POR CATEGORIA
// ================================

router.get("/estoque-categorias", async (req, res) => {

    try {

        const [dados] = await db.query(`
            SELECT
                c.nome AS categoria,
                COALESCE(SUM(p.estoque), 0) AS estoque
            FROM categorias c
            LEFT JOIN produtos p
                ON p.categoria_id = c.id
            GROUP BY c.id, c.nome
            ORDER BY estoque DESC
        `)

        return res.json(dados)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar estoque por categoria"
        })

    }

})


// ================================
// ALERTAS DE ESTOQUE
// ================================

router.get("/alertas-estoque", async (req, res) => {

    try {

        const [produtos] = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.estoque,
                p.estoque_minimo,
                c.nome AS categoria
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            WHERE p.estoque <= p.estoque_minimo
            ORDER BY p.estoque ASC
        `)

        return res.json(produtos)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar alertas"
        })

    }

})


// ================================
// PRODUTOS RECENTES
// ================================

router.get("/produtos-recentes", async (req, res) => {

    try {

        const [produtosRecentes] = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.preco,
                p.estoque,
                p.created_at,
                c.nome AS categoria
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            ORDER BY p.created_at DESC
            LIMIT 5
        `)

        return res.json(produtosRecentes)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar produtos recentes"
        })

    }

})


router.get("/resumo-vendas", async (req, res) =>{

    try{

        const [[vendasHoje]] = await db.query(`SELECT COUNT(*) AS total FROM pedidos WHERE DATE(criado_em) = CURDATE() `)

        const [[vendasMensal]] = await db.query(`  SELECT COUNT(*) AS total
            FROM pedidos
            WHERE MONTH(criado_em) = MONTH(CURDATE())
            AND YEAR(criado_em) = YEAR(CURDATE())` )


        return res.json({
            vendasHoje:vendasHoje.total,
            vendasMensal:vendasMensal.total 
        })    

    } catch(error){
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao carregar as vendas de hoje"
        })
    }
})

export default router