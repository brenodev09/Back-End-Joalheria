import express from "express"
import bcrypt from "bcrypt"
import pool from "../database.js"
import jwt from "jsonwebtoken"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { apenasAdmin } from "../middlewares/autorizacao.js"
import upload from "../../config/multer.js"
import { buscarConfiguracao } from "../services/configuracoes.js"
 
const router = express.Router()

router.get("/", autenticarToken, async (req, res) => {
    try {
        const sql = `select id, nome, email, tipo, ativo, criado_em, atualizado_em, foto_perfil
         from usuarios order by id desc`

        const [usuarios] = await pool.query(sql)

        return res.json(usuarios)
    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao listar os usuários! Por favor, tente novamente."
        })
    }
})

router.get("/:id", autenticarToken, async (req, res) => {
    try {

        const { id } = req.params

        const sql = `select id, nome, email, tipo, ativo, criado_em, atualizado_em, foto_perfil from usuarios where id = ?`

        const [resultado] = await pool.query(sql, [id])

        if (resultado.length === 0) {
            return res.status(400).json({
                mensagem: "Usuário não encontrado"
            })
        }


        return res.json(resultado[0])

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao buscar usuário"
        })
    }
})


// cadastro de usuario
router.post("/", async (req, res) => {

    try {
        const { nome, email, senha } = req.body


        if (!nome || !email || !senha) {
            return res.status(400).json({
                erro: "Preencha todos os campos"
            })
        }


        const [usuarioExiste] = await pool.query(
            `select id from usuarios where email = ?`, [email]
        )

        if (usuarioExiste.length > 0) {
            return res.status(400).json({
                erro: "Este email já esta cadastro!"
            })
        }

        const senhaCriptografada = await bcrypt.hash(senha, 15)

        const sql = `insert into usuarios (nome, email, senha) values (?,?,?)`


        const [resultado] = await pool.query(sql, [nome, email, senhaCriptografada])

        const [usuarioCriado] = await pool.query(`
        select id, nome, email, tipo, ativo, criado_em, atualizado_em from usuarios where id = ?
    `, [resultado.insertId])

        return res.status(201).json(usuarioCriado[0])
    } catch (error) {
        return res.status(500).json({
            erro: "Erro ao cadastrar usuário"
        })
    }


})

// login de usuario

router.post("/login", async (req, res) =>{
    try{
        const { email, senha} = req.body

        if(!email || !senha) {
            return res.status(400).json({
                erro:"Email e senha são obrigatórios"
            })
        }

        const emailNormalizado = String(email).trim().toLowerCase()
        const ip = req.ip?.slice(0, 45) || null
        const identificadores = [emailNormalizado]
        if (ip) identificadores.push(`ip:${ip}`)
        const maxLoginAttempts = Number(await buscarConfiguracao("max_login_attempts"))
        const temporaryLockMinutes = Number(await buscarConfiguracao("temporary_lock_minutes"))

        const [bloqueios] = await pool.query(
            `SELECT identificador, tentativas, bloqueado_ate
             FROM login_bloqueios
             WHERE identificador IN (?)`,
            [identificadores]
        )

        const agora = Date.now()
        for (const bloqueio of bloqueios) {
            if (bloqueio.bloqueado_ate && new Date(bloqueio.bloqueado_ate).getTime() > agora) {
                const retryAfter = Math.max(1, Math.ceil((new Date(bloqueio.bloqueado_ate).getTime() - agora) / 1000))
                return res.status(429).json({
                    erro: "Muitas tentativas. Aguarde antes de tentar novamente.",
                    bloqueado: true,
                    bloqueadoAte: bloqueio.bloqueado_ate,
                    retryAfter
                })
            }
            if (bloqueio.bloqueado_ate) {
                await pool.query(
                    `UPDATE login_bloqueios SET tentativas = 0, bloqueado_ate = NULL WHERE identificador = ?`,
                    [bloqueio.identificador]
                )
            }
        }

        const [resultado] = await pool.query(
            `select * from usuarios where lower(email) = ? limit 1`,
            [emailNormalizado]
        )

        const usuario = resultado[0]

        if(!usuario){
            const bloqueio = await registrarTentativaFalha(
                identificadores,
                ip,
                maxLoginAttempts,
                temporaryLockMinutes
            )
            if (bloqueio) {
                return res.status(429).json(bloqueio)
            }
            return res.status(401).json({
                erro:"Email ou senha inválidos"
            })
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha)

        if(!senhaValida) {
            const bloqueio = await registrarTentativaFalha(
                identificadores,
                ip,
                maxLoginAttempts,
                temporaryLockMinutes
            )
            if (bloqueio) {
                return res.status(429).json(bloqueio)
            }
            return res.status(401).json({
                erro:"Email ou senha inválidos"
            })
        }

        await pool.query(
            `UPDATE login_bloqueios
             SET tentativas = 0, bloqueado_ate = NULL
             WHERE identificador IN (?)`,
            [identificadores]
        )

        const { id, nome, tipo, criado_em, atualizado_em, foto_perfil} = usuario;
        const token = jwt.sign({id,nome, email: usuario.email, tipo}, process.env.JWT_SECRET, {expiresIn: "1d"}) 

        return res.json({
            mensagem:"Login realizado com sucesso!",
            token, 
            usuario:{
                id,nome, email: usuario.email, tipo, criado_em, atualizado_em, foto_perfil
            }
        })


    } catch(error) {
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao fazer login. Por favor, tente novamente!"
        })
    }
})

async function registrarTentativaFalha(identificadores, ip, maxLoginAttempts, temporaryLockMinutes) {
    for (const identificador of identificadores) {
        await pool.query(
            `INSERT INTO login_bloqueios (identificador, tentativas, ultimo_ip)
             VALUES (?, 1, ?)
             ON DUPLICATE KEY UPDATE tentativas = tentativas + 1, ultimo_ip = ?`,
            [identificador, ip, ip]
        )
    }

    const [bloqueios] = await pool.query(
        `SELECT identificador, tentativas
         FROM login_bloqueios
         WHERE identificador IN (?)`,
        [identificadores]
    )
    const atingiuLimite = bloqueios.some((bloqueio) => bloqueio.tentativas >= maxLoginAttempts)
    if (!atingiuLimite) return null

    const bloqueadoAte = new Date(Date.now() + temporaryLockMinutes * 60 * 1000)
    await pool.query(
        `UPDATE login_bloqueios SET bloqueado_ate = ? WHERE identificador IN (?)`,
        [bloqueadoAte, identificadores]
    )

    return {
        erro: "Muitas tentativas. Aguarde antes de tentar novamente.",
        bloqueado: true,
        bloqueadoAte,
        retryAfter: Math.max(1, Math.ceil(temporaryLockMinutes * 60))
    }
}


// editar usuario
router.put("/:id", autenticarToken, async (req, res) =>{
    try{
        const {id} = req.params
        if (Number(id) !== Number(req.usuario.id) && req.usuario.tipo !== "admin") {
            return res.status(403).json({ erro: "Você não pode alterar este usuário" })
        }
        const {nome, email, senha} = req.body

        if(!nome || !email ) {
            return res.status(400).json({
                mensagem:"Nome ou email são obrigatórios para atualizar o usuário"
             })
        }

        let sql
        let parametros

        if(senha) {
            const senhaCriptografada = await bcrypt.hash(senha, 15)

             sql = `update usuarios set nome = ?, email = ?, senha = ?, atualizado_em = CURRENT_TIMESTAMP where id = ?`
             parametros = [nome,email,senhaCriptografada,id]
        } else{
             sql = `update usuarios set nome = ?, email = ?, atualizado_em = CURRENT_TIMESTAMP where id = ?`
             parametros = [nome,email,id]
        }


        const [resultadoUser] = await pool.query(sql,parametros)

        if(resultadoUser.affectedRows === 0 ){
            return res.status(400).json({
                erro:"Usuário não encontrado, por favor tente novamente!"
            })
        }

        const [usuarioEditado] = await pool.query(`select nome, email, criado_em, atualizado_em from usuarios where id =?`, [id]) 

        return res.json(usuarioEditado[0])

    } catch (error){
        console.error(error)

        return res.status(500).json({
            erro:"Erro ao atualizar usuário."
        })
    }
})


router.put( "/:id/foto", autenticarToken, upload.single("foto"), async (req, res) => {
        try {
            const { id } = req.params

            if (Number(id) !== Number(req.usuario.id) && req.usuario.tipo !== "admin") {
                return res.status(403).json({ erro: "Você não pode alterar este usuário" })
            }

            if (!req.file) {
                return res.status(400).json({
                    erro: "Nenhuma imagem enviada"
                })
            }

            const caminhoFoto = `/uploads/${req.file.filename}`

            await pool.query(
                `UPDATE usuarios
                 SET foto_perfil = ?
                 WHERE id = ?`,
                [caminhoFoto, id]
            )

            return res.json({
                mensagem: "Foto atualizada com sucesso",
                foto_perfil: caminhoFoto
            })

        } catch (error) {
            console.error(error)

            return res.status(500).json({
                erro: "Erro ao atualizar foto"
            })
        }
    }
)


export default router