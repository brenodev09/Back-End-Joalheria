import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()


// método de listar as avaliações de um produto (com fotos e média de notas)
router.get("/produto/:produto_id", async (req, res) => {
    try {

        const { produto_id } = req.params

        const sql = `
            SELECT
                ap.id,
                ap.produto_id,
                ap.usuario_id,
                u.nome AS usuario_nome,
                ap.nota,
                ap.comentario,
                ap.data_criacao,
                ap.data_atualizacao
            FROM avaliacoes_produtos ap
            JOIN usuarios u
                ON u.id = ap.usuario_id
            WHERE ap.produto_id = ?
            ORDER BY ap.data_criacao DESC
        `

        const [avaliacoes] = await db.query(sql, [produto_id])

        if (avaliacoes.length === 0) {
            return res.json({ avaliacoes: [], media_notas: 0, total: 0 })
        }

        const idsAvaliacoes = avaliacoes.map((avaliacao) => avaliacao.id)

        const [fotos] = await db.query(
            `select id, avaliacao_id, foto from avaliacoes_fotos where avaliacao_id in (?)`,
            [idsAvaliacoes]
        )

        const avaliacoesComFotos = avaliacoes.map((avaliacao) => ({
            ...avaliacao,
            fotos: fotos
                .filter((foto) => foto.avaliacao_id === avaliacao.id)
                .map((foto) => ({ id: foto.id, foto: foto.foto }))
        }))

        const mediaNotas =
            avaliacoes.reduce((soma, avaliacao) => soma + avaliacao.nota, 0) / avaliacoes.length

        return res.json({
            avaliacoes: avaliacoesComFotos,
            media_notas: Number(mediaNotas.toFixed(2)),
            total: avaliacoes.length
        })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar as avaliações do produto"
        })
    }
})


// método de verificar se o usuário logado já avaliou um produto
router.get("/minha/:produto_id", autenticarToken, async (req, res) => {
    try {

        const { produto_id } = req.params
        const usuario_id = req.usuario.id

        const sql = `select id, produto_id, usuario_id, nota, comentario, data_criacao, data_atualizacao
            from avaliacoes_produtos where produto_id = ? and usuario_id = ?`

        const [avaliacoes] = await db.query(sql, [produto_id, usuario_id])

        if (avaliacoes.length === 0) {
            return res.json({ avaliacao: null })
        }

        const [fotos] = await db.query(
            `select id, foto from avaliacoes_fotos where avaliacao_id = ?`,
            [avaliacoes[0].id]
        )

        return res.json({ avaliacao: { ...avaliacoes[0], fotos } })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao buscar sua avaliação"
        })
    }
})


// método de adicionar uma avaliação
router.post("/", autenticarToken, upload.array("fotos", 5), async (req, res) => {

    try {

        console.log(req.files)
        console.log(req.body)

        const { produto_id, nota, comentario } = req.body
        const usuario_id = req.usuario.id

        if (!produto_id || !nota) {
            return res.status(400).json({
                erro: "Produto e nota são obrigatórios"
            })
        }

        const notaConvertida = Number(nota)

        if (!Number.isInteger(notaConvertida) || notaConvertida < 1 || notaConvertida > 5) {
            return res.status(400).json({
                erro: "A nota deve ser um número inteiro entre 1 e 5"
            })
        }

        const [avaliacaoExistente] = await db.query(
            `select id from avaliacoes_produtos where produto_id = ? and usuario_id = ?`,
            [produto_id, usuario_id]
        )

        if (avaliacaoExistente.length > 0) {
            return res.status(409).json({
                erro: "Você já avaliou este produto. Edite sua avaliação existente.",
                avaliacao_id: avaliacaoExistente[0].id
            })
        }

        const sql = `insert into avaliacoes_produtos (produto_id, usuario_id, nota, comentario)
            values (?,?,?,?)`

        const [resultado] = await db.query(sql, [
            produto_id, usuario_id, notaConvertida, comentario || null
        ])

        const idAvaliacao = resultado.insertId

        if (req.files && req.files.length > 0) {
            for (const arquivo of req.files) {
                const foto = `/uploads/${arquivo.filename}`

                await db.query(
                    `insert into avaliacoes_fotos (avaliacao_id, foto) values (?,?)`,
                    [idAvaliacao, foto]
                )
            }
        }

        const [avaliacaoCriada] = await db.query(
            `select id, produto_id, usuario_id, nota, comentario, data_criacao, data_atualizacao
             from avaliacoes_produtos where id = ?`,
            [idAvaliacao]
        )

        return res.status(201).json(avaliacaoCriada[0])

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao criar avaliação, por favor tente novamente!"
        })
    }

})


// método de editar a avaliação (somente o dono pode editar)
router.put("/:id", autenticarToken, upload.array("fotos", 5), async (req, res) => {
    try {

        const { id } = req.params
        const { nota, comentario, fotos_remover } = req.body
        const usuario_id = req.usuario.id

        const [avaliacoes] = await db.query(
            `select * from avaliacoes_produtos where id = ?`,
            [id]
        )

        if (avaliacoes.length === 0) {
            return res.status(404).json({
                erro: "Item não encontrado."
            })
        }

        const avaliacao = avaliacoes[0]

        if (avaliacao.usuario_id !== usuario_id) {
            return res.status(403).json({
                erro: "Você não tem permissão para editar esta avaliação"
            })
        }

        const notaConvertida = nota !== undefined ? Number(nota) : avaliacao.nota

        if (!Number.isInteger(notaConvertida) || notaConvertida < 1 || notaConvertida > 5) {
            return res.status(400).json({
                erro: "A nota deve ser um número inteiro entre 1 e 5"
            })
        }

        const sql = `update avaliacoes_produtos set nota = ?, comentario = ?,
            data_atualizacao = CURRENT_TIMESTAMP where id = ?`

        await db.query(sql, [
            notaConvertida,
            comentario !== undefined ? comentario : avaliacao.comentario,
            id
        ])

        // remove as fotos que o cliente marcou para excluir
        if (fotos_remover) {
            let idsRemover = fotos_remover

            if (typeof idsRemover === "string") {
                try {
                    idsRemover = JSON.parse(idsRemover)
                } catch {
                    idsRemover = [idsRemover]
                }
            }

            idsRemover = [].concat(idsRemover).filter(Boolean)

            if (idsRemover.length > 0) {
                await db.query(
                    `delete from avaliacoes_fotos where id in (?) and avaliacao_id = ?`,
                    [idsRemover, id]
                )
            }
        }

        // adiciona as novas fotos enviadas, se houver
        if (req.files && req.files.length > 0) {
            for (const arquivo of req.files) {
                const foto = `/uploads/${arquivo.filename}`

                await db.query(
                    `insert into avaliacoes_fotos (avaliacao_id, foto) values (?,?)`,
                    [id, foto]
                )
            }
        }

        const [avaliacaoAtualizada] = await db.query(
            `select id, produto_id, usuario_id, nota, comentario, data_criacao, data_atualizacao
             from avaliacoes_produtos where id = ?`,
            [id]
        )

        const [fotosAtuais] = await db.query(
            `select id, foto from avaliacoes_fotos where avaliacao_id = ?`,
            [id]
        )

        return res.json({ ...avaliacaoAtualizada[0], fotos: fotosAtuais })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao atualizar avaliação."
        })
    }
})


// método de deletar a avaliação (somente o dono pode excluir)
router.delete("/:id", autenticarToken, async (req, res) => {
    try {

        const { id } = req.params
        const usuario_id = req.usuario.id

        const [avaliacoes] = await db.query(
            `select * from avaliacoes_produtos where id = ?`,
            [id]
        )

        if (avaliacoes.length === 0) {
            return res.status(404).json({
                erro: "Item não encontrado."
            })
        }

        if (avaliacoes[0].usuario_id !== usuario_id) {
            return res.status(403).json({
                erro: "Você não tem permissão para excluir esta avaliação"
            })
        }

        const sql = `delete from avaliacoes_produtos where id = ?`

        const [resultadoDelete] = await db.query(sql, [id])

        if (resultadoDelete.affectedRows === 0) {
            return res.status(404).json({
                erro: "Item não encontrado.",
            })
        }

        return res.status(200).json({
            mensagem: "Avaliação excluida com sucesso"
        })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao deleter o item! Tente novamente."
        })
    }
})


// método de deletar uma única foto de uma avaliação (somente o dono pode excluir)
router.delete("/foto/:foto_id", autenticarToken, async (req, res) => {
    try {

        const { foto_id } = req.params
        const usuario_id = req.usuario.id

        const sql = `
            SELECT af.id, af.foto, ap.usuario_id
            FROM avaliacoes_fotos af
            JOIN avaliacoes_produtos ap
                ON ap.id = af.avaliacao_id
            WHERE af.id = ?
        `

        const [fotos] = await db.query(sql, [foto_id])

        if (fotos.length === 0) {
            return res.status(404).json({
                erro: "Item não encontrado."
            })
        }

        if (fotos[0].usuario_id !== usuario_id) {
            return res.status(403).json({
                erro: "Você não tem permissão para excluir esta foto"
            })
        }

        const [resultadoDelete] = await db.query(
            `delete from avaliacoes_fotos where id = ?`,
            [foto_id]
        )

        if (resultadoDelete.affectedRows === 0) {
            return res.status(404).json({
                erro: "Item não encontrado.",
            })
        }

        return res.status(200).json({
            mensagem: "Foto excluida com sucesso"
        })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao deleter o item! Tente novamente."
        })
    }
})

export default router