import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"

const router = express.Router()

router.get("/", async (req, res) => {
    try {
        const sql = `select id, nome, descricao, imagem, ativo, criado_em, atualizado_em from categorias order by id desc`

        const [categorias] = await db.query(sql)

        return res.json(categorias)

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar as categorias"
        })
    }
})

router.post("/", upload.single("imagem"), async (req, res) => {

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

export default router