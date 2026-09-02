import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()
router.use(autenticarToken)


router.post("/:produtoId", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id
    const produtoId = req.params.produtoId

    if (req.usuario.tipo !== "cliente") {
        return res.status(403).json({
            erro: "Apenas clientes podem favoritar produtos."
        })
    }

    try {
        await db.query(
            `
            INSERT INTO favoritos (usuario_id, produto_id)
            VALUES (?, ?)
            `,
            [usuarioId, produtoId]
        )

        res.json({
            mensagem: "Produto favoritado"
        })

    } catch {
        res.status(400).json({
            erro: "Produto já está nos favoritos"
        })
    }
})


router.delete("/:produtoId", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id
    const produtoId = req.params.produtoId

       if (req.usuario.tipo !== "cliente") {
        return res.status(403).json({
            erro: "Apenas clientes podem deletar os produtos favoritos."
        })
    }

    await db.query(
        `
        DELETE FROM favoritos
        WHERE usuario_id = ?
        AND produto_id = ?
        `,
        [usuarioId, produtoId]
    )

    res.json({ mensagem: "Favorito removido" })
})


router.get("/", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id

     if (req.usuario.tipo !== "cliente") {
        return res.status(403).json({
            erro: "Apenas clientes podem ver os produtos favoritos."
        })
    }

    const [favoritos] = await db.query(
        `
        SELECT
            p.*
        FROM favoritos f
        INNER JOIN produtos p
            ON p.id = f.produto_id
        WHERE f.usuario_id = ?
        `,
        [usuarioId]
    )

    res.json(favoritos)
})



router.get("/verificar/:produtoId", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id
    const produtoId = req.params.produtoId


     if (req.usuario.tipo !== "cliente") {
        return res.status(403).json({
            erro: "Apenas clientes podem verificar produtos favoritos."
        })
    }

    const [resultado] = await db.query(
        `
        SELECT id
        FROM favoritos
        WHERE usuario_id = ?
        AND produto_id = ?
        `,
        [usuarioId, produtoId]
    )

    res.json({
        favoritado: resultado.length > 0
    })
})


export default router




