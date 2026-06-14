import { describe, expect, it } from "vitest";
import {
  AppError,
  GateBlockedError,
  UnauthorizedError,
  ValidationError,
  toErrorEnvelope,
} from "./errors.js";

describe("errors", () => {
  it("maps UnauthorizedError to a 401 envelope", () => {
    const { status, body } = toErrorEnvelope(new UnauthorizedError());
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  it("carries details on validation errors", () => {
    const err = new ValidationError("bad input", { field: "name" });
    expect(err.toEnvelope().error.details).toEqual({ field: "name" });
  });

  it("marks security errors as non-retryable by default", () => {
    expect(new UnauthorizedError().retryable).toBe(false);
    expect(new GateBlockedError().retryable).toBe(false);
  });

  it("maps unknown throwables to an opaque 500 (no internal leak)", () => {
    const { status, body } = toErrorEnvelope(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("Internal server error");
  });

  it("gate_blocked uses 409", () => {
    expect(new GateBlockedError().httpStatus).toBe(409);
  });

  it("AppError subclasses retain their class name", () => {
    expect(new AppError("x", 400, "y").name).toBe("AppError");
  });
});
