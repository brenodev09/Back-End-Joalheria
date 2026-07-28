import express from "express";
import pool from "../database.js";
import { autenticarToken } from "../middlewares/autenticacao.js";

const router = express.Router();



// =========================================================
// LISTAR CARRINHO DO USUÁRIO
// GET /carrinho
// =========================================================

router.get("/", autenticarToken, async (req, res) => {

    try {


        const usuarioId = req.usuario.id;



        const [carrinho] = await pool.query(

            `
SELECT id
FROM carrinhos
WHERE usuario_id = ?

`,
            [usuarioId]

        );



        if (carrinho.length === 0) {

            return res.json([]);

        }



        const carrinhoId = carrinho[0].id;




        const [itens] = await pool.query(

            `

SELECT

ci.id,

ci.quantidade,


p.id AS produto_id,

p.nome,

p.descricao,

p.imagem,


m.nome AS material,


pv.id AS variacao_id,

pv.tipo AS tipo_variacao,

pv.valor AS variacao,


COALESCE(
pv.preco,
p.preco
) AS preco



FROM carrinho_itens ci



INNER JOIN produtos p

ON p.id = ci.produto_id




LEFT JOIN materiais m

ON m.id = p.material_id





LEFT JOIN produto_variacoes pv

ON pv.id = ci.variacao_id





WHERE ci.carrinho_id = ?



ORDER BY ci.id DESC


`,

            [carrinhoId]

        );



        res.json(itens);



    } catch (error) {


        console.error(error);


        res.status(500).json({

            erro: "Erro ao carregar carrinho."

        });


    }



});







// =========================================================
// ADICIONAR PRODUTO AO CARRINHO
// POST /carrinho
// =========================================================


router.post("/", autenticarToken, async (req, res) => {


    try {


        const usuarioId = req.usuario.id;



        const {

            produto_id,

            quantidade = 1,

            variacao_id = null


        } = req.body;





        if (!produto_id) {

            return res.status(400).json({

                erro: "Produto não informado."

            });

        }





        // busca produto

        const [produto] = await pool.query(

            `

SELECT

id,

estoque

FROM produtos

WHERE id = ?

`,

            [produto_id]

        );





        if (produto.length === 0) {

            return res.status(404).json({

                erro: "Produto não encontrado."

            });

        }






        let estoqueDisponivel = produto[0].estoque;




        // caso tenha variação

        if (variacao_id) {


            const [variacao] = await pool.query(

                `

SELECT

id,

estoque

FROM produto_variacoes

WHERE id = ?

AND produto_id = ?

`,

                [
                    variacao_id,
                    produto_id
                ]


            );





            if (variacao.length === 0) {

                return res.status(404).json({

                    erro: "Variação inválida para este produto."

                });


            }



            estoqueDisponivel = variacao[0].estoque;



        }






        if (quantidade > estoqueDisponivel) {

            return res.status(400).json({

                erro: "Quantidade maior que estoque disponível."

            });


        }







        // procura carrinho

        const [carrinho] = await pool.query(

            `

SELECT id

FROM carrinhos

WHERE usuario_id = ?

`,

            [usuarioId]

        );




        let carrinhoId;





        if (carrinho.length === 0) {


            const [novoCarrinho] = await pool.query(

                `

INSERT INTO carrinhos(usuario_id)

VALUES(?)

`,

                [usuarioId]

            );



            carrinhoId = novoCarrinho.insertId;



        } else {


            carrinhoId = carrinho[0].id;


        }








        // verifica item existente


        const [itemExistente] = await pool.query(

            `

SELECT

id,

quantidade

FROM carrinho_itens


WHERE carrinho_id = ?

AND produto_id = ?


AND (

variacao_id = ?

OR

(
variacao_id IS NULL
AND ? IS NULL
)

)


`,

            [

                carrinhoId,

                produto_id,

                variacao_id,

                variacao_id

            ]


        );






        if (itemExistente.length > 0) {



            const novaQuantidade =
                itemExistente[0].quantidade + quantidade;



            if (novaQuantidade > estoqueDisponivel) {

                return res.status(400).json({

                    erro: "Quantidade ultrapassa estoque."

                });

            }





            await pool.query(

                `

UPDATE carrinho_itens

SET quantidade = ?

WHERE id = ?

`,

                [

                    novaQuantidade,

                    itemExistente[0].id

                ]


            );



            return res.json({

                mensagem: "Quantidade atualizada."

            });


        }







        // cria item novo


        await pool.query(

            `

INSERT INTO carrinho_itens

(

carrinho_id,

produto_id,

variacao_id,

quantidade

)


VALUES(?,?,?,?)

`,

            [

                carrinhoId,

                produto_id,

                variacao_id,

                quantidade

            ]

        );




        res.status(201).json({

            mensagem: "Produto adicionado."

        });




    } catch (error) {


        console.error(error);


        res.status(500).json({

            erro: "Erro ao adicionar produto."

        });


    }



});









// =========================================================
// ALTERAR QUANTIDADE
// PUT /carrinho/item/:id
// =========================================================


router.put("/item/:id", autenticarToken, async (req, res) => {


    try {


        const usuarioId = req.usuario.id;

        const { id } = req.params;

        const { quantidade } = req.body;





        if (!quantidade || quantidade < 1) {

            return res.status(400).json({

                erro: "Quantidade inválida."

            });


        }





        const [item] = await pool.query(

            `

SELECT

ci.id,

ci.variacao_id,


p.estoque,


pv.estoque AS estoque_variacao



FROM carrinho_itens ci



INNER JOIN carrinhos c

ON c.id = ci.carrinho_id



INNER JOIN produtos p

ON p.id = ci.produto_id



LEFT JOIN produto_variacoes pv

ON pv.id = ci.variacao_id




WHERE ci.id = ?

AND c.usuario_id = ?

`,

            [
                id,
                usuarioId
            ]

        );





        if (item.length === 0) {

            return res.status(404).json({

                erro: "Item não encontrado."

            });


        }




        const estoque =
            item[0].estoque_variacao ??
            item[0].estoque;





        if (quantidade > estoque) {

            return res.status(400).json({

                erro: "Quantidade maior que estoque."

            });

        }





        await pool.query(

            `

UPDATE carrinho_itens

SET quantidade = ?

WHERE id = ?

`,

            [

                quantidade,

                id

            ]


        );





        res.json({

            mensagem: "Quantidade alterada."

        });





    } catch (error) {


        console.error(error);


        res.status(500).json({

            erro: "Erro ao alterar quantidade."

        });


    }



});









// =========================================================
// REMOVER ITEM
// DELETE /carrinho/item/:id
// =========================================================


router.delete("/item/:id", autenticarToken, async (req, res) => {


    try {


        const usuarioId = req.usuario.id;

        const { id } = req.params;





        const [item] = await pool.query(

            `

SELECT ci.id

FROM carrinho_itens ci


INNER JOIN carrinhos c

ON c.id = ci.carrinho_id



WHERE ci.id = ?

AND c.usuario_id = ?

`,

            [

                id,

                usuarioId

            ]

        );






        if (item.length === 0) {

            return res.status(404).json({

                erro: "Item não encontrado."

            });

        }





        await pool.query(

            `

DELETE FROM carrinho_itens

WHERE id = ?

`,

            [id]

        );





        res.json({

            mensagem: "Produto removido."

        });





    } catch (error) {


        console.error(error);


        res.status(500).json({

            erro: "Erro ao remover item."

        });


    }



});









// =========================================================
// LIMPAR CARRINHO
// DELETE /carrinho/limpar
// =========================================================


router.delete("/limpar", autenticarToken, async (req, res) => {


    try {


        const usuarioId = req.usuario.id;



        const [carrinho] = await pool.query(

            `

SELECT id

FROM carrinhos

WHERE usuario_id = ?

`,

            [usuarioId]

        );





        if (carrinho.length === 0) {

            return res.json({

                mensagem: "Carrinho vazio."

            });

        }




        await pool.query(

            `

DELETE FROM carrinho_itens

WHERE carrinho_id = ?

`,

            [carrinho[0].id]

        );





        res.json({

            mensagem: "Carrinho limpo."

        });





    } catch (error) {


        console.error(error);


        res.status(500).json({

            erro: "Erro ao limpar carrinho."

        });


    }



});




export default router;