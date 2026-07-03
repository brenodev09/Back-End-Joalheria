import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"

const router = express.Router()

// LISTAR MATERIAIS
router.get("/", async (req, res) => {
    try {

        const sql = `
            SELECT
                id,
                nome,
                descricao,
                imagem,
                estoque,
                unidade,
                valor_medio,
                fornecedor,
                ativo,
                criado_em,
                atualizado_em
            FROM materiais
            ORDER BY id DESC
        `

        const [materiais] = await db.query(sql)

        return res.json(materiais)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar materiais"
        })

    }
})

// ADICIONAR MATERIAL
router.post("/", upload.single("imagem"), async (req, res) => {

    try {

        const {
            nome,
            descricao,
            estoque,
            unidade,
            valor_medio,
            fornecedor,
            ativo
        } = req.body

        if (!nome || !unidade) {
            return res.status(400).json({
                erro: "Nome e unidade são obrigatórios"
            })
        }

        const imagem = req.file
            ? `/uploads/${req.file.filename}`
            : null

        const ativoConvertido =
            ativo === "true" || ativo === true ? 1 : 0

        const sql = `
            INSERT INTO materiais
            (
                nome,
                descricao,
                imagem,
                estoque,
                unidade,
                valor_medio,
                fornecedor,
                ativo
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `

        const [resultado] = await db.query(sql, [
            nome,
            descricao || null,
            imagem,
            estoque || 0,
            unidade,
            valor_medio || 0,
            fornecedor || null,
            ativoConvertido
        ])

        const idMaterial = resultado.insertId

        const [materialCriado] = await db.query(
            `
            SELECT *
            FROM materiais
            WHERE id = ?
            `,
            [idMaterial]
        )

        return res.status(201).json(materialCriado[0])

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao criar material"
        })

    }
})

// DELETAR MATERIAL
router.delete("/:id", async (req, res) => {

    try {

        const { id } = req.params

        const sql = `
            DELETE FROM materiais
            WHERE id = ?
        `

        const [resultado] = await db.query(sql, [id])

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Material não encontrado"
            })
        }

        return res.status(200).json({
            mensagem: "Material excluído com sucesso"
        })

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao excluir material"
        })

    }
})

// EDITAR MATERIAL
router.put("/:id", upload.single("imagem"), async (req, res) => {

    try {

        const { id } = req.params

        const {
            nome,
            descricao,
            estoque,
            unidade,
            valor_medio,
            fornecedor,
            ativo
        } = req.body

        if (!nome || !unidade || ativo === undefined) {
            return res.status(400).json({
                erro: "Nome, unidade e status são obrigatórios"
            })
        }

        const ativoConvertido =
            ativo === "true" || ativo === true ? 1 : 0

        let sql
        let parametros

        if (req.file) {

            const imagem = `/uploads/${req.file.filename}`

            sql = `
                UPDATE materiais
                SET
                    nome = ?,
                    descricao = ?,
                    imagem = ?,
                    estoque = ?,
                    unidade = ?,
                    valor_medio = ?,
                    fornecedor = ?,
                    ativo = ?,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ?
            `

            parametros = [
                nome,
                descricao,
                imagem,
                estoque,
                unidade,
                valor_medio,
                fornecedor,
                ativoConvertido,
                id
            ]

        } else {

            sql = `
                UPDATE materiais
                SET
                    nome = ?,
                    descricao = ?,
                    estoque = ?,
                    unidade = ?,
                    valor_medio = ?,
                    fornecedor = ?,
                    ativo = ?,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ?
            `

            parametros = [
                nome,
                descricao,
                estoque,
                unidade,
                valor_medio,
                fornecedor,
                ativoConvertido,
                id
            ]
        }

        const [resultado] = await db.query(sql, parametros)

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Material não encontrado"
            })
        }

        const [materialAtualizado] = await db.query(
            `
            SELECT *
            FROM materiais
            WHERE id = ?
            `,
            [id]
        )

        return res.json(materialAtualizado[0])

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao atualizar material"
        })

    }
})

export default router;