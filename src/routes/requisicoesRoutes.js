// src/routes/requisicoesRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// Gera um código público de 10 caracteres (letras + números)
function gerarCodigoPublico() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let codigo = "";
  for (let i = 0; i < 10; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

// Garante que o codigo_publico seja único na tabela `requisicoes`
function gerarCodigoPublicoUnico(callback) {
  const codigo = gerarCodigoPublico();

  const sql = "SELECT id FROM requisicoes WHERE codigo_publico = ? LIMIT 1";
  db.query(sql, [codigo], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar codigo_publico:", err);
      return callback(err);
    }

    if (rows.length > 0) {
      // já existe, tenta de novo recursivamente
      return gerarCodigoPublicoUnico(callback);
    }

    // código livre, pode usar
    callback(null, codigo);
  });
}

/**
 * POST /requisicoes
 * Cria uma nova requisição fluvial
 *
 * Espera algo assim no body:
 * {
 *   emissor_id: 7,
 *   setor_id: 1,
 *   passageiro_nome: "JOÃO",
 *   passageiro_cpf: "12345678901",
 *   passageiro_matricula: null,
 *   origem: "BORBA",
 *   destino: "MANAUS",
 *   data_ida: "2025-12-10",
 *   data_volta: null,
 *   horario_embarque: null,
 *   justificativa: "Motivo da viagem",
 *   observacoes: "{...json...}"
 * }
 */
router.post("/requisicoes", (req, res) => {
  const {
    emissor_id,
    setor_id,
    passageiro_nome,
    passageiro_cpf,
    passageiro_matricula,
    origem,
    destino,
    data_ida,
    data_volta,
    horario_embarque,
    justificativa,
    observacoes,
  } = req.body || {};

  // validações básicas
  if (!emissor_id) {
    return res
      .status(400)
      .json({ message: "Emissor não informado (emissor_id é obrigatório)." });
  }

  if (!passageiro_nome || !origem || !destino || !data_ida) {
    return res.status(400).json({
      message:
        "Preencha passageiro_nome, origem, destino e data_ida para criar a requisição.",
    });
  }

  // gera o código público único e depois grava
  gerarCodigoPublicoUnico((errCodigo, codigo_publico) => {
    if (errCodigo) {
      return res
        .status(500)
        .json({ message: "Erro ao gerar código público da requisição." });
    }

    const status = "PENDENTE";

    const sql = `
      INSERT INTO requisicoes (
        codigo_publico,
        emissor_id,
        passageiro_nome,
        passageiro_cpf,
        passageiro_matricula,
        setor_id,
        origem,
        destino,
        data_ida,
        data_volta,
        horario_embarque,
        justificativa,
        status,
        qr_hash,
        observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      codigo_publico,
      emissor_id,
      passageiro_nome,
      passageiro_cpf || null,
      passageiro_matricula || null,
      setor_id || null,
      origem,
      destino,
      data_ida, // "YYYY-MM-DD"
      data_volta || null,
      horario_embarque || null, // "HH:MM:SS" se algum dia vier
      justificativa || null,
      status,
      null, // qr_hash (podemos usar depois pra QR Code seguro)
      observacoes || null,
    ];

    db.query(sql, params, (errInsert, result) => {
      if (errInsert) {
        console.error("Erro ao criar requisição:", errInsert);
        return res
          .status(500)
          .json({ message: "Erro ao criar requisição." });
      }

      const requisicaoId = result.insertId;

      // tenta gravar o log de status (não impede o sucesso se der erro)
      const logSql = `
        INSERT INTO requisicao_status_log (
          requisicao_id,
          status_anterior,
          status_novo,
          usuario_id,
          observacao
        ) VALUES (?, ?, ?, ?, ?)
      `;
      const logParams = [
        requisicaoId,
        null,
        status,
        emissor_id,
        "Criação da requisição",
      ];

      db.query(logSql, logParams, (errLog) => {
        if (errLog) {
          console.error(
            "Erro ao gravar requisicao_status_log (criação):",
            errLog
          );
          // segue mesmo assim
        }

        // resposta final para o frontend
        return res.status(201).json({
          id: requisicaoId,
          codigo_publico,
          status,
        });
      });
    });
  });
});

/**
 * GET /requisicoes/:id
 * (pensando no canhoto / visualização detalhada)
 */
router.get("/requisicoes/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT 
      r.*,
      u.nome AS emissor_nome,
      u.cpf AS emissor_cpf,
      s.nome AS setor_nome
    FROM requisicoes r
    LEFT JOIN usuarios u ON u.id = r.emissor_id
    LEFT JOIN setores s ON s.id = r.setor_id
    WHERE r.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, rows) => {
    if (err) {
      console.error("Erro ao buscar requisição:", err);
      return res
        .status(500)
        .json({ message: "Erro ao buscar dados da requisição." });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: "Requisição não encontrada." });
    }

    const requisicao = rows[0];
    res.json(requisicao);
  });
});

module.exports = router;
