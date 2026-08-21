import type { FastifyInstance } from "fastify";
import type { z } from "zod";

export class HttpProblem extends Error {
  readonly status: number;
  readonly title: string;
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, title: string, code: string, detail?: string) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.code = code;
    this.detail = detail;
  }
}

export function problem(
  status: number,
  title: string,
  code: string,
  detail?: string,
): HttpProblem {
  return new HttpProblem(status, title, code, detail);
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first
      ? `${first.path.join(".") || "body"}: ${first.message}`
      : "Invalid request body";
    throw problem(400, "Bad Request", "VALIDATION_ERROR", detail);
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parseBody(schema, query);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpProblem) {
      void reply.code(err.status).type("application/problem+json").send({
        type: "about:blank",
        title: err.title,
        status: err.status,
        detail: err.detail ?? err.title,
        code: err.code,
      });
      return;
    }
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    const status = typeof statusCode === "number" ? statusCode : 500;
    const message = err instanceof Error ? err.message : "Request failed";
    req.log.error({ err }, "request failed");
    void reply.code(status).type("application/problem+json").send({
      type: "about:blank",
      title: status >= 500 ? "Internal Server Error" : "Request Failed",
      status,
      detail: status >= 500 ? undefined : message,
      code: status >= 500 ? "INTERNAL" : "REQUEST_FAILED",
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).type("application/problem+json").send({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
    });
  });
}
