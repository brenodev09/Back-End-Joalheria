import express from "express"
import db from "../database.js"

const router = express.Router()

router.post("/validar-cupom", async (req, res) =>{

    const {codigo, subTotal} = req.body
     console.log("Código recebido:", codigo);
    console.log("Subtotal recebido:", subTotal);

    try{

        const [cupom] = await db.query(
         "SELECT * from cupons where codigo = ? and ativo = true ", [codigo])

          console.log("Resultado da consulta:", cupom);

        if(cupom.length === 0 ){
            return res.status(400).json({
                erro: "Não há cupons válidos no momento"
            })
        }

        const dadosCupom = cupom[0]

        // conferindo data de validade do cupom

        if(dadosCupom.data_fim && new Date(dadosCupom.data_fim) < new Date()) {
            return res.status(400).json({
                erro:"Cupom expirado"
            })
        }


        // valor minímo

        if ( subTotal < dadosCupom.valor_minimo ) {
            return res.status(400).json({
                erro:`Compra mínima no valor de ${dadosCupom.valor_minimo}`
            })
        }

        let desconto = 0

        if (dadosCupom.tipo === "percentual") {
            desconto = subTotal * (dadosCupom.valor / 100)
        } else {
            desconto = (dadosCupom.valor)
        }

        
        const totalFinal = subTotal - desconto

        res.json({
            codigo: dadosCupom.codigo,
            desconto,
            totalFinal
        })

    } catch(error){
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao validar cupom"
        })
    }
}) 


export default router