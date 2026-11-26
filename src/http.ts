import type { RequestHandler } from "express";

export interface User {
  id: number;
  email: string;
  role: "patient" | "receptionist" | "clinician" | "manager" | "admin";
  clinicId: number | null;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new ApiError(400, `Expected these fields: ${keys.join(", ")}.`);
  }
  return value as Record<string, unknown>;
}

export function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return value.trim();
}

export function identifier(value: unknown): number {
  const result = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : value;
  if (typeof result !== "number" || !Number.isInteger(result) || result < 1 || result > 2147483647) {
    throw new ApiError(400, "Expected a positive integer ID.");
  }
  return result;
}

export function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, "Use a date in YYYY-MM-DD format.");
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, "Invalid calendar date.");
  }
  return value;
}

export function allow(...roles: User["role"][]): RequestHandler {
  return (_req, res, next) => {
    const user: User = res.locals.user;
    if (!roles.includes(user.role)) throw new ApiError(403, "Access denied.");
    next();
  };
}

export function sqlState(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
