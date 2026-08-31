import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { apenasAdmin } from "../middlewares/autorizacao.js"

const router = express.Router()

// metodo de leitura dos funcionarios cadastrados

router.get("/funcionarios-cadastrados", autenticarToken, apenasAdmin, async (req, res) => {
    try {

        const [funcionarios] = await db.query(`select * from funcionarios ORDER BY nome ASC `)


        res.json(funcionarios)

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            erro: "Erro ao buscar os funcionários cadastrados no sistema."
        })
    }
})

// metodo de adicionar o funcionario ao sistema
router.post("/adicionar-funcionario", autenticarToken, apenasAdmin, upload.single("foto"), async (req, res) => {

    try {
        const { nome, email, cargo, telefone, ativo } = req.body

        // Aceita tanto "data_admissao" (snake_case) quanto "dataAdmissao" (camelCase),
        // caso o front envie em qualquer um dos dois formatos.
        const data_admissao = req.body.data_admissao ?? req.body.dataAdmissao

        const foto = req.file
            ? `/uploads/${req.file.filename}`
            : null;

        const ativoConvertido = ativo === undefined ? 1 : (ativo === "true" || ativo === true ? 1 : 0)

        if (!nome || !email || !cargo || !data_admissao) {
            return res.status(400).json({
                erro: "Preencha nome, e-mail, cargo e data de admissão"
            })
        }

        const [resultado] = await db.execute(
            `INSERT INTO funcionarios (nome, email, cargo, telefone, data_admissao, ativo, foto) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nome, email, cargo, telefone, data_admissao, ativoConvertido, foto]
        )

        return res.status(201).json({
            mensagem: "Funcionário adicionado com sucesso",
            funcionario: {
                id: resultado.insertId,
                nome,
                email,
                cargo,
                telefone,
                data_admissao,
                ativo: ativoConvertido,
                foto
            }
        })

    } catch (error) {
        console.error("Erro ao adicionar funcionário", error)

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                erro: "Já existe um funcionário cadastrado com esses dados"
            })
        }

        return res.status(500).json({
            erro: "Erro ao adicionar funcionário"
        })

    }
})



// metodo de editar o funionario cadastrado no sistema

router.put("/editar-funcionario/:id", autenticarToken, apenasAdmin, upload.single("foto"), async (req, res) => {

    try {

        const { id } = req.params
        const { nome, email, cargo, telefone, ativo } = req.body

        const data_admissao = req.body.data_admissao ?? req.body.dataAdmissao

        const ativoConvertido = ativo === undefined ? 1 : (ativo === "true" || ativo === true ? 1 : 0)

        if (!nome || !email || !cargo || !data_admissao) {
            return res.status(400).json({
                erro: "Preencha nome, e-mail, cargo e data de admissão"
            })
        }

        let sql
        let parametros

        if (req.file) {
            const foto = `/uploads/${req.file.filename}`;
            sql = `UPDATE funcionarios SET nome = ?, email = ?, ativo = ?, foto = ?, cargo = ?, telefone = ?, data_admissao = ?,
                atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
            parametros = [nome, email, ativoConvertido, foto, cargo, telefone, data_admissao, id]
        } else {
            sql = `UPDATE funcionarios SET nome = ?, email = ?, ativo = ?, cargo = ?, telefone = ?, data_admissao = ?,
                atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
            parametros = [nome, email, ativoConvertido, cargo, telefone, data_admissao, id]
        }

        const [resultado] = await db.query(sql, parametros)

        if(resultado.affectedRows === 0){
            return res.status(404).json({
                erro:"Funcionário não encontrado"
            })
        }

        const [funcionarioAtualizado] = await db.query(`
            select * from funcionarios where id = ?`, [id])

            
        return res.json(funcionarioAtualizado[0])

    } catch (error) {
        console.error(error)

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                erro: "Já existe um funcionário cadastrado com esses dados"
            })
        }

        return res.status(500).json({
            erro: "Erro ao editar o funcionário"
        })
    }
})


// método de excluir um funcionário do sistema

router.delete("/deletar-funcionario/:id", autenticarToken, apenasAdmin, async (req, res) =>{
    try{
        const {id} = req.params

        const [resultadoDelete] = await db.query(`delete from funcionarios where id = ?`, [id])

        if(resultadoDelete.affectedRows === 0 ) {
            return res.status(404).json({
                erro:"Funcionário não encontrado"
            })
        }

        return res.status(200).json({
            mensagem: "Funcionário deletado com sucesso"
        })

    } catch(error){
        console.error(error)
        return res.status(500).json({
            erro:"Erro ao deleter funcionário"
        })
    }
})



export default router