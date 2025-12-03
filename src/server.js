// src/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// ROTA DE SAÚDE
// ======================================================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API Prefeitura de Borba ON" });
});

// ======================================================
// LOGIN (aceita maiúscula / minúscula no login)
// ======================================================
app.post("/api/login", (req, res) => {
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ error: "Informe login e senha." });
  }

  const sql = `
    SELECT id, nome, login, perfil, setor_id, cpf, barco
    FROM usuarios
    WHERE LOWER(login) = LOWER(?) AND senha = ? AND ativo = 1
    LIMIT 1
  `;

  db.query(sql, [login, senha], (err, rows) => {
    if (err) {
      console.error("Erro no login:", err);
      return res.status(500).json({ error: "Erro interno no servidor." });
    }

    if (rows.length === 0) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const row = rows[0];

    const user = {
      id: row.id,
      nome: row.nome,
      login: row.login,
      tipo: (row.perfil || "").toLowerCase(), // emissor / representante / transportador / admin
      setor_id: row.setor_id,
      cpf: row.cpf || null,
      barco: row.barco || null,
    };

    res.json({
      user,
      token: "ok", // placeholder pra futuro JWT
    });
  });
});

// ======================================================
// ROTAS DE USUÁRIOS (CRUD) - /api/usuarios
// ======================================================
const router = express.Router();

/**
 * LISTAR usuários (apenas ativos)
 */
router.get("/usuarios", (req, res) => {
  const sql = `
    SELECT id, nome, login, perfil AS tipo, cpf, barco
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Erro ao listar usuários:", err);
      return res.status(500).json({ error: "Erro ao listar usuários." });
    }
    res.json(rows);
  });
});

/**
 * CRIAR novo usuário
 * - representante: CPF obrigatório
 * - transportador: CPF/CNPJ + barco obrigatórios
 */
router.post("/usuarios", (req, res) => {
  let { nome, login, senha, tipo, cpf, barco } = req.body;

  if (!nome || !login || !senha || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login, senha e tipo são obrigatórios." });
  }

  login = String(login).trim();
  tipo = String(tipo).toLowerCase();
  cpf = (cpf || "").trim();
  barco = (barco || "").trim();

  if (tipo === "representante" && !cpf) {
    return res
      .status(400)
      .json({ error: "CPF do representante é obrigatório." });
  }

  if (tipo === "transportador" && (!cpf || !barco)) {
    return res.status(400).json({
      error: "CPF/CNPJ e nome do barco são obrigatórios para transportador.",
    });
  }

  const checkSql =
    "SELECT id FROM usuarios WHERE LOWER(login) = LOWER(?) LIMIT 1";

  db.query(checkSql, [login], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar login:", err);
      return res
        .status(500)
        .json({ error: "Erro ao verificar existência do login." });
    }

    if (rows.length > 0) {
      return res.status(409).json({ error: "Já existe um usuário com esse login." });
    }

    const insertSql = `
      INSERT INTO usuarios (nome, login, senha, perfil, cpf, barco, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `;

    db.query(
      insertSql,
      [nome, login, senha, tipo, cpf || null, barco || null],
      (err, result) => {
        if (err) {
          console.error("Erro ao criar usuário:", err);
          return res.status(500).json({ error: "Erro ao criar usuário." });
        }

        res.status(201).json({
          id: result.insertId,
          nome,
          login,
          tipo,
          cpf: cpf || null,
          barco: barco || null,
        });
      }
    );
  });
});

/**
 * ATUALIZAR usuário
 * - mesma regra de CPF/barco
 */
router.put("/usuarios/:id", (req, res) => {
  const { id } = req.params;
  let { nome, login, senha, tipo, cpf, barco } = req.body;

  if (!nome || !login || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login e tipo são obrigatórios." });
  }

  login = String(login).trim();
  tipo = String(tipo).toLowerCase();
  cpf = (cpf || "").trim();
  barco = (barco || "").trim();

  if (tipo === "representante" && !cpf) {
    return res
      .status(400)
      .json({ error: "CPF do representante é obrigatório." });
  }

  if (tipo === "transportador" && (!cpf || !barco)) {
    return res.status(400).json({
      error: "CPF/CNPJ e nome do barco são obrigatórios para transportador.",
    });
  }

  const fields = ["nome = ?", "login = ?", "perfil = ?", "cpf = ?", "barco = ?"];
  const params = [nome, login, tipo, cpf || null, barco || null];

  if (senha && senha.trim() !== "") {
    fields.push("senha = ?");
    params.push(senha);
  }

  params.push(id);

  const sql = `
    UPDATE usuarios
    SET ${fields.join(", ")}
    WHERE id = ?
  `;

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error("Erro ao atualizar usuário:", err);
      return res.status(500).json({ error: "Erro ao atualizar usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário atualizado com sucesso." });
  });
});

/**
 * REMOVER usuário (DELETE definitivo)
 */
router.delete("/usuarios/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM usuarios WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Erro ao excluir usuário:", err);
      return res.status(500).json({ error: "Erro ao excluir usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário excluído com sucesso." });
  });
});

// ======================================================
// ROTAS MÓDULO FLUVIAL (REQUISIÇÕES)
// ======================================================

// EMISSOR – Criar Requisição
app.post("/api/requisicoes", (req, res) => {
  const {
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
  } = req.body;

  if (!emissor_id || !passageiro_nome || !origem || !destino || !data_ida) {
    return res.status(400).json({ error: "Campos obrigatórios faltando." });
  }

  const codigoPublico = Math.random().toString(36).substring(2, 12).toUpperCase();

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
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', NOW())
 `;

  const params = [
    codigoPublico,
    emissor_id,
    passageiro_nome,
    passageiro_cpf || null,
    passageiro_matricula || null,
    setor_id || null,
    origem,
    destino,
    data_ida,
    data_volta || null,
    horario_embarque || null,
    justificativa || null,
  ];

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error("Erro ao criar requisição:", err);
      return res.status(500).json({ error: "Erro ao criar requisição." });
    }

    const insertedId = result.insertId;

    const logSql = `
      INSERT INTO requisicao_status_log (requisicao_id, status_anterior, status_novo, usuario_id, created_at)
      VALUES (?, NULL, 'PENDENTE', ?, NOW())
    `;
    db.query(logSql, [insertedId, emissor_id], () => {});

    res.status(201).json({
      id: insertedId,
      codigo_publico: codigoPublico,
      status: "PENDENTE",
    });
  });
});

// EMISSOR – Listar Requisições
app.get("/api/requisicoes/emissor/:emissorId", (req, res) => {
  const { emissorId } = req.params;

  const sql = `
    SELECT *
    FROM requisicoes
    WHERE emissor_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [emissorId], (err, rows) => {
    if (err) {
      console.error("Erro ao listar requisições:", err);
      return res.status(500).json({ error: "Erro ao listar requisições." });
    }
    res.json(rows);
  });
});

// REPRESENTANTE – Ver Pendentes
app.get("/api/requisicoes/pendentes", (req, res) => {
  const sql = `
    SELECT *
    FROM requisicoes
    WHERE status = 'PENDENTE'
    ORDER BY created_at ASC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Erro ao listar pendentes:", err);
      return res.status(500).json({ error: "Erro ao listar pendentes." });
    }
    res.json(rows);
  });
});

// REPRESENTANTE – Aprovar/Reprovar
app.post("/api/requisicoes/:id/assinar", (req, res) => {
  const { id } = req.params;
  const { representante_id, acao, motivo_recusa } = req.body;

  if (!representante_id || !acao) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const novoStatus = acao === "APROVAR" ? "APROVADA" : "REPROVADA";

  const updateSql = `
    UPDATE requisicoes
    SET status = ?, updated_at = NOW()
    WHERE id = ?
  `;

  db.query(updateSql, [novoStatus, id], (err) => {
    if (err) {
      console.error("Erro ao atualizar status:", err);
      return res.status(500).json({ error: "Erro ao atualizar status." });
    }

    const insertAss = `
      INSERT INTO assinaturas_representante (
        requisicao_id, representante_id, acao, motivo_recusa, created_at
      ) VALUES (?, ?, ?, ?, NOW())
    `;
    db.query(
      insertAss,
      [id, representante_id, novoStatus, motivo_recusa || null],
      () => {}
    );

    const logSql = `
      INSERT INTO requisicao_status_log (requisicao_id, status_anterior, status_novo, usuario_id, created_at)
      VALUES (?, 'PENDENTE', ?, ?, NOW())
    `;
    db.query(logSql, [id, novoStatus, representante_id], () => {});

    res.json({ ok: true, status: novoStatus });
  });
});

// TRANSPORTADOR – Validar Viagem
app.post("/api/requisicoes/:id/validar", (req, res) => {
  const { id } = req.params;
  const {
    transportador_id,
    tipo_validacao,
    codigo_lido,
    local_validacao,
    observacao,
  } = req.body;

  if (!transportador_id || !codigo_lido) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const sqlInsertVal = `
    INSERT INTO validacoes_transportador (
      requisicao_id,
      transportador_id,
      tipo_validacao,
      codigo_lido,
      local_validacao,
      observacao,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NOW())
  `;

  db.query(
    sqlInsertVal,
    [
      id,
      transportador_id,
      tipo_validacao || "EMBARQUE",
      codigo_lido,
      local_validacao || null,
      observacao || null,
    ],
    (err) => {
      if (err) {
        console.error("Erro ao validar:", err);
        return res.status(500).json({ error: "Erro ao validar requisição." });
      }

      const updateStatus = `
        UPDATE requisicoes
        SET status = 'UTILIZADA', updated_at = NOW()
        WHERE id = ?
      `;
      db.query(updateStatus, [id], () => {});

      const logSql = `
        INSERT INTO requisicao_status_log (requisicao_id, status_anterior, status_novo, usuario_id, created_at)
        VALUES (?, 'APROVADA', 'UTILIZADA', ?, NOW())
      `;
      db.query(logSql, [id, transportador_id], () => {});

      res.json({ ok: true, status: "UTILIZADA" });
    }
  );
});

// RELATÓRIO / LISTA GERAL
app.get("/api/requisicoes", (req, res) => {
  const { data_ini, data_fim, status } = req.query;

  let sql = "SELECT * FROM requisicoes WHERE 1=1";
  const params = [];

  if (data_ini) {
    sql += " AND data_ida >= ?";
    params.push(data_ini);
  }
  if (data_fim) {
    sql += " AND data_ida <= ?";
    params.push(data_fim);
  }
  if (status && status !== "TODOS") {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Erro ao listar requisições:", err);
      return res.status(500).json({ error: "Erro ao listar requisições." });
    }
    res.json(rows);
  });
});

// ======================================================
// PLUGA AS ROTAS /api/usuarios
// ======================================================
app.use("/api", router);

// ======================================================
// SUBIR SERVIDOR
// ======================================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API Prefeitura de Borba rodando na porta ${PORT}`);
});
