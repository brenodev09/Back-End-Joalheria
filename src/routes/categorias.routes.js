import express from "express"
import db from "../database.js"

const router = express.Router()

router.get("/", async (req,res) =>{
    try{
        const sql  = `select id, nome, descricao, imagem, ativo, criado_em, atualizado_em from categorias order by id desc`

        const [categorias] = await db.query(sql)

        return res.json(categorias)

    } catch (error){
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao listar os itens"
        })
    }
})

export default router