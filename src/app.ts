import express, {type ErrorRequestHandler} from "express";
import type { Pool } from "pg";
import { appointmentRoutes } from "./modules/appointments/routes.js";
import { authenticated, authRoutes } from "./modules/auth/routes.js";
import { followUpRoutes } from "./modules/follow-ups/routes.js";
import { ApiError } from "./http.js";
import type { SessionStore } from "./modules/auth/sessions.js";

export function createApp(pool: Pool, sessions: SessionStore, secureCookies = false) {
  const app = express();
  app.disable("x-powered-by");
  const api = express.Router();
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  api.use((req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "Cross-site requests are disabled.");
    }
    next();
  });
  api.use(express.json({limit: "16kb"}));
  api.use(authRoutes(pool, sessions, secureCookies));
  api.use(authenticated(pool, sessions), appointmentRoutes(pool), followUpRoutes(pool));
  api.use((_req, res) => res.status(404).json({error: "Endpoint not found."}));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({error: error.message});
    } else if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
      res.status(error.status).json({error: "Invalid JSON request body."});
    } else {
      console.error("MediClinicTrack API error", error instanceof Error ? error.name : "UnknownError");
      res.status(500).json({error: "Unexpected server error."});
    }
  };
  api.use(errors);
  app.use("/api/v1", api);
  return app;
}
