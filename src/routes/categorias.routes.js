import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { apenasAdmin } from "../middlewares/autorizacao.js"

const router = express.Router()

router.get("/", async (req, res) => {
    try {

        const sql = `
            SELECT
                c.id,
                c.nome,
                c.descricao,
                c.imagem,
                c.ativo,
                c.criado_em,
                c.atualizado_em,
                COUNT(p.id) AS total_produtos
            FROM categorias c
            LEFT JOIN produtos p
                ON p.categoria_id = c.id
            GROUP BY c.id
            ORDER BY c.id DESC
        `

        const [categorias] = await db.query(sql)

        return res.json(categorias)

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar as categorias"
        })
    }
})


// método de adicionar uma categoria
router.post("/", autenticarToken, apenasAdmin, upload.single("imagem"), async (req, res) => {

    try {

        console.log(req.file)
        console.log(req.body)

        const { nome, descricao, ativo } = req.body
        const imagem = `/uploads/${req.file.filename}`


        if (!nome || !descricao) {
            return res.status(400).json({
                erro: "Nome e descrição são obrigatórios"
            })
        }

        const sql = `insert into categorias (nome, descricao, imagem, ativo)
            values(?,?,?,?) `


        const ativoConvertido = ativo === "true" || ativo === true ? 1 : 0

        const [resultado] = await db.query(sql, [
            nome, descricao || null, imagem, ativoConvertido
        ])

        const idCategoria = resultado.insertId

        const [categoriaCriada] = await db.query(`select id, nome, descricao, imagem, ativo, criado_em, atualizado_em 
            from categorias where id = ?`, [idCategoria])

        return res.status(201).json(categoriaCriada[0])
    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao criar categoria, por favor tente novamente! "
        })
    }

})



// metodo de deletar as categorias
router.delete("/:id", autenticarToken, apenasAdmin, async (req, res) => {
    try {
        const { id } = req.params

        const sql = `delete from categorias where id = ?`

        const [resultadoDelete] = await db.query(sql, [id])

        if (resultadoDelete.affectedRows === 0) {
            return res.status(404).json({
                erro: "Item não encontrado.",
            });
        }

        return res.status(200).json({
            mensagem: "Categoria excluida com sucesso"
        })
    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao deleter o item! Tente novamente."
        })
    }
})



// metodo de editar a categoria
router.put("/:id", autenticarToken, apenasAdmin, upload.single("imagem"), async (req, res) => {
    try {
        const { id } = req.params
        const { nome, descricao, ativo } = req.body

        if (!nome || !descricao || ativo === undefined) {
            return res.status(400).json({
                erro: "Nome, descrição e status são obrigatórios"
            })
        }

        const ativoConvertido = ativo === "true" || ativo === true ? 1 : 0

        let sql
        let parametros

        // só atualiza a imagem se o usuário enviou um arquivo novo
        if (req.file) {
            const imagem = `/uploads/${req.file.filename}`

            sql = `update categorias set nome = ?, descricao = ?, ativo = ?, imagem = ?,
                atualizado_em = CURRENT_TIMESTAMP where id = ?`
            parametros = [nome, descricao, ativoConvertido, imagem, id]
        } else {
            sql = `update categorias set nome = ?, descricao = ?, ativo = ?,
                atualizado_em = CURRENT_TIMESTAMP where id = ?`
            parametros = [nome, descricao, ativoConvertido, id]
        }

        const [resultado] = await db.query(sql, parametros)

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Item não encontrado.",
            });
        }

        const [categoriaAtualizada] = await db.query(
            `select id, nome, descricao, imagem, ativo, criado_em, atualizado_em
             from categorias where id = ?`,
            [id]
        )

        return res.json(categoriaAtualizada[0])

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao atualizar categoria."
        })
    }
})

export default router