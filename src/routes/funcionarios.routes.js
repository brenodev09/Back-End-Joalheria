import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"

const router = express.Router()

// metodo de leitura dos funcionarios cadastrados

router.get("/funcionarios-cadastrados", async (req, res) =>{
    try{

        const [funcionarios] = await db.query(`select * from funcionarios ORDER BY nome ASC ` )


        res.json(funcionarios)

    } catch(error){
        console.error(error)
        return res.status(500).json({
            erro:"Erro ao buscar os funcionários cadastrados no sistema."
        })
    }
})

// metodo de adicionar o funcionario ao sistema
router.post("/adicionar-funcionario", upload.single("foto"), async (req, res) => {

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



export default router