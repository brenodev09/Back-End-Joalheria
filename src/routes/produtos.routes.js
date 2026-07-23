import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"

const router = express.Router()

// LISTAR PRODUTOS
router.get("/", async (req, res) => {
    try {

        const sql = `
            SELECT
                p.*,
                c.nome AS categoria,
                m.nome AS material
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            LEFT JOIN materiais m
                ON p.material_id = m.id
            ORDER BY p.id DESC
        `

        const [produtos] = await db.query(sql)

        return res.json(produtos)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar produtos"
        })

    }
})

// produtos em destaque 

router.get("/destaques", async (req, res) =>{
    try{
        const [produtos] = await db.query(`
            SELECT p.*, c.nome as categoria from produtos p 
            LEFT JOIN categorias c ON p.categoria_id = c.id
            where p.destaque = true and p.ativo = true 
            LIMIT 8 `)

        res.json(produtos)

    } catch(error){
        console.log(error)
        res.status(500).json({
            erro:"Erro ao exibir os produtos em destaque"
        })
    }
})


router.get("/:id", async (req,res) => {
    try{
        const {id} = req.params

        const [produto] = await db.query("SELECT * from produtos where id = ? ", [id])

           if (produto.length === 0) {
            return res.status(404).json({
                erro: "Produto não encontrado."
            });
        }


        res.json(produto[0])
    } catch(error) {
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao buscar o produto, por favor tente novamente!"
        })
    }
})

// CADASTRAR PRODUTO
router.post("/", upload.single("imagem"), async (req, res) => {

    console.log(req.body)
    console.log(req.file)

    try {

        const {
            nome,
            descricao,
            preco,
            estoque,
            estoque_minimo,
            localizacao,
            categoria_id,
            material_id,
            ativo,
            destaque
        } = req.body

        if (!nome || !preco) {
            return res.status(400).json({
                erro: "Nome e preço são obrigatórios"
            })
        }

        const imagem = req.file
            ? `/uploads/${req.file.filename}`
            : null

        const ativoConvertido =
            ativo === "true" || ativo === true ? 1 : 0
            const destaqueConvertido = destaque === "true" || destaque === true ? 1 : 0

        const sql = `
            INSERT INTO produtos
            (
                nome,
                descricao,
                preco,
                estoque,
                estoque_minimo,
                localizacao,
                categoria_id,
                material_id,
                ativo,
                imagem,
                destaque
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
        `

        const [resultado] = await db.query(sql, [
            nome,
            descricao || null,
            preco,
            estoque || 0,
            estoque_minimo || 5,
            localizacao || null,
            categoria_id || null,
            material_id || null,
            ativoConvertido,
            imagem,
            destaqueConvertido
        ])

        const [produtoCriado] = await db.query(
            `
            SELECT *
            FROM produtos
            WHERE id = ?
            `,
            [resultado.insertId]
        )

        return res.status(201).json(produtoCriado[0])

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao criar produto"
        })

    }

})

// EXCLUIR PRODUTO
router.delete("/:id", async (req, res) => {

    try {

        const { id } = req.params

        const [resultado] = await db.query(
            `
            DELETE FROM produtos
            WHERE id = ?
            `,
            [id]
        )

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Produto não encontrado"
            })
        }

        return res.json({
            mensagem: "Produto excluído com sucesso"
        })

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao excluir produto"
        })

    }

})

// EDITAR PRODUTO
router.put("/:id", upload.single("imagem"), async (req, res) => {

    try {

        const { id } = req.params

        const {
            nome,
            descricao,
            preco,
            estoque,
            estoque_minimo,
            localizacao,
            categoria_id,
            material_id,
            ativo,
            destaque
        } = req.body

        const ativoConvertido =
            ativo === "true" || ativo === true ? 1 : 0
        const destaqueConvertido = destaque === "true" || destaque === true ? 1 : 0


        let sql
        let parametros

        if (req.file) {

            const imagem = `/uploads/${req.file.filename}`

            sql = `
                UPDATE produtos
                SET
                    nome = ?,
                    descricao = ?,
                    preco = ?,
                    estoque = ?,
                    estoque_minimo = ?,
                    localizacao = ?,
                    categoria_id = ?,
                    material_id = ?,
                    ativo = ?,
                    destaque = ?,
                    imagem = ?
                    
                WHERE id = ?
            `

            parametros = [
                nome,
                descricao,
                preco,
                estoque,
                estoque_minimo,
                localizacao,
                categoria_id,
                material_id,
                ativoConvertido,
                destaqueConvertido,
                imagem,
                id
            ]

        } else {

            sql = `
                UPDATE produtos
                SET
                    nome = ?,
                    descricao = ?,
                    preco = ?,
                    estoque = ?,
                    estoque_minimo = ?,
                    localizacao = ?,
                    categoria_id = ?,
                    material_id = ?,
                    ativo = ?,
                    destaque = ?
                WHERE id = ?
            `

            parametros = [
                nome,
                descricao,
                preco,
                estoque,
                estoque_minimo,
                localizacao,
                categoria_id,
                material_id,
                ativoConvertido,
                destaqueConvertido,
                id
            ]

        }

        const [resultado] = await db.query(sql, parametros)

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Produto não encontrado"
            })
        }

        const [produtoAtualizado] = await db.query(
            `
            SELECT *
            FROM produtos
            WHERE id = ?
            `,
            [id]
        )

        return res.json(produtoAtualizado[0])

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao atualizar produto"
        })

    }

})



export default router