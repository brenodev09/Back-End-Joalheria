import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()

// metodo de fazer o pedido
router.post("/", autenticarToken, async (req, res) => {

    const connection = await db.getConnection()
    const { codigo } = req.body

    try {

        await connection.beginTransaction()
        const usuarioId = req.usuario.id

        const { formaPagamento, tipoEntrega, cupom } = req.body

        const [carrinho] = await connection.query(`select * from carrinhos where usuario_id = ? `, [usuarioId])

        if (carrinho.length === 0) {
            await connection.rollback()

            return res.status(400).json({
                mensagem: "Seu carrinho está vazio"
            })
        }

        const carrinhoId = carrinho[0].id
        const [itensCarrinho] = await connection.query(`select ci.produto_id, ci.quantidade, p.nome, p.preco, p.estoque 
        FROM carrinho_itens ci INNER JOIN produtos p ON p.id = ci.produto_id WHERE ci.carrinho_id = ?`, [carrinhoId])

        for (const item of itensCarrinho) {
            if (item.quantidade > item.estoque) {
                throw new Error(`Produto ${item.nome} está sem estoque`)
            }
        }

        const subtotal = itensCarrinho.reduce((acc, item) => {
            return acc + (item.preco * item.quantidade)
        }, 0)

        let frete = 0
        let prazoEntrega = ""
        let cupomId = null
        let desconto = 0


        if (codigo) {
            // const cupomId = dadosCupom.id

            const [cupomEncontrado] = await connection.query(
                "SELECT * from cupons where codigo = ? and ativo = true ", [codigo])

            console.log("Resultado da consulta:", cupomEncontrado);

            if (cupomEncontrado.length === 0) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Não há cupons válidos no momento"
                })
            }

            // conferindo data de validade do cupom
            const dadosCupom = cupomEncontrado[0]

            if (dadosCupom.data_fim && new Date(dadosCupom.data_fim) < new Date()) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Cupom expirado"
                })
            }

            // valor minímo

            if (subtotal < dadosCupom.valor_minimo) {
                await connection.rollback()

                return res.status(400).json({
                    erro: `Compra mínima no valor de ${dadosCupom.valor_minimo}`
                })
            }


            if (dadosCupom.tipo === "percentual") {
                desconto = subtotal * (dadosCupom.valor / 100)
            } else {
                desconto = dadosCupom.valor
            }

            cupomId = dadosCupom.id

        }

        switch (tipoEntrega) {

            case "padrão": frete = 0, prazoEntrega = "5 a 7 dias úteis"; break
            case "expressa": frete = 25, prazoEntrega = "3 a 5 dias úteis"; break
            case "retirada": frete = 0, prazoEntrega = "Disponível em 24h para retirada na loja"; break


        }



        // const totalFinal = subTotal - desconto

        // res.json({
        //     codigo: dadosCupom.codigo,
        //     desconto,
        //     totalFinal
        // })


        const total = subtotal - desconto + frete


        const [pedido] = await connection.query(`
          insert into pedidos (usuario_id, subtotal, desconto, frete, total, forma_pagamento, tipo_entrega,
           prazo_entrega, cupom_id) values (?,?,?,?,?,?,?,?,?) `, [usuarioId, subtotal, desconto, frete, total, formaPagamento, tipoEntrega,
            prazoEntrega, cupomId])


        for (const item of itensCarrinho) {
            await connection.query(
                `insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal) values (?,?,?,?,?)`,
                [pedido.insertId, item.produto_id, item.quantidade, item.preco, item.preco * item.quantidade])
        }


        for (const item of itensCarrinho) {
            await connection.query(
                `update produtos set estoque = estoque - ? where id  = ?`, [item.quantidade, item.produto_id])
        }

        await connection.query(`delete from carrinho_itens where carrinho_id = ?`, [carrinhoId])


        await connection.commit()

        return res.status(201).json({
            mensagem: "Pedido realizado com sucesso!",
            pedidoId: pedido.insertId,
            total
        })

    } catch (error) {
        await connection.rollback()

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao finalizar o pedido, por favor tente novamente"
        })
    } finally {
        connection.release()
    }


})


// metodo de leitura dos pedidos do usuario

router.get("/meus-pedidos", autenticarToken, async (req, res) => {

    try {
        const usuarioId = req.usuario.id
        const [pedidos] = await db.query(`select * from pedidos where usuario_id = ? order by criado_em desc`, [usuarioId])

        if (pedidos.length === 0) {
            return res.json([])
        }

        const pedidoIds = pedidos.map((pedido) => pedido.id)

        // busca os itens de todos os pedidos de uma vez só (evita fazer 1 query por pedido)
        const [itens] = await db.query(
            `SELECT pi.pedido_id, pi.produto_id, pi.quantidade, pi.preco_unitario, pi.subtotal,
                    p.nome, p.imagem
               FROM pedidos_itens pi
               INNER JOIN produtos p ON p.id = pi.produto_id
              WHERE pi.pedido_id IN (?)`,
            [pedidoIds]
        )

        const pedidosComItens = pedidos.map((pedido) => ({
            ...pedido,
            itens: itens.filter((item) => item.pedido_id === pedido.id)
        }))

        res.json(pedidosComItens)

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar os seus pedidos"
        })
    }

})


router.get("/:id", autenticarToken, async (req, res) => {
    try {
        const usuarioId = req.usuario.id
        const pedidoId = req.params.id

        const [pedido] = await db.query(`select * from pedidos where id = ? AND usuario_id = ?`, [pedidoId,usuarioId ])

        if (pedido.length === 0) {
            return res.status(404).json({
                erro: "Pedido não encontrado"
            })
        }


        const [itens] = await db.query(`SELECT pi.*, p.nome, p.imagem FROM pedidos_itens pi INNER JOIN produtos p
             ON p.id = pi.produto_id WHERE pi.pedido_id = ?`, [pedidoId])

        res.json({
            pedido:pedido[0],
            itens
        })     

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao buscar pedido"
        })
    }
})

export default router