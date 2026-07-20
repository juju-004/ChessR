import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { isProd } from "../config/env.js";

export function notFoundHandler(req: Request, res: Response) {
  res
    .status(404)
    .json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.flatten().fieldErrors,
    });
  }

  if (err instanceof ApiError) {
    return res
      .status(err.statusCode)
      .json({ error: err.message, details: err.details });
  }

  // Mongo duplicate key
  if (typeof err === "object" && err !== null && (err as any).code === 11000) {
    return res.status(409).json({ error: "Resource already exists" });
  }

  console.error("Unhandled error:", err);

  return res.status(500).json({
    error: "Internal server error",
    ...(isProd ? {} : { stack: (err as Error)?.stack }),
  });
}
