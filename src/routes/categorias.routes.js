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

router.post("/", async (req, res) =>{

    try{
        const {nome, descricao, imagem, ativo} = req.body

        if(!nome || !descricao) {
            return res.status(400).json({
                erro:"Nome e descrição são obrigatórios"
            })
        }

        const sql = `insert into categorias (nome, descricao, imagem, ativo)
            values(?,?,?,?) `

        const resultado = await db.run(sql, [
            nome, descricao || null, imagem, ativo
        ])

        const categoriaCriada =  await db.get( `select id, nome, descricao, imagem, ativo, criado_em, atualizado_em 
            from itens where id = ?`, [resultado.lastID]),
            
          return res.status(201).json(categoriaCriada)  
    } catch (error){
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao criar categoria, por favor tente novamente! "
        })
    }

} )

export default router