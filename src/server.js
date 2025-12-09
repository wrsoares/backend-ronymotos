// src/server.js
import "dotenv/config"; // carrega .env logo no início

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { pool } from "./config/db.js";
import vehiclesRouter from "./routes/vehicles.js";
import authRouter from "./routes/auth.js";

const app = express();
const PORT = process.env.PORT || 5002;

// Middlewares globais
app.use(helmet());
app.use(express.json()); // se quiser, pode aumentar o limite: express.json({ limit: "2mb" })
app.use(morgan("dev"));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ronymotos.app.br",
      "https://www.ronymotos.app.br",
      "https://api.ronymotos.app.br"
    ],
    credentials: true
  })
);

// Healthcheck simples
app.get("/", (req, res) => {
  res.send("API Rony Motos (ESM) OK");
});

// Status da API
app.get("/status", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    at: new Date().toISOString()
  });
});

// Teste de conexão com o banco
app.get("/db-test", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== Rotas de autenticação (login, register, me) =====
app.use("/auth", authRouter);

// ===== Rotas de veículos (CRUD completo) =====
app.use("/vehicles", vehiclesRouter);

// 404 para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Rota não encontrada"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Rony Motos online → porta ${PORT}`);
});
