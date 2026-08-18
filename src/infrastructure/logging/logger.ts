import pino from "pino";

/**
 * The one shared structured logger, replacing the console.error calls that
 * used to be scattered across the codebase with no consistent shape. Fields
 * like requestId (interface/http/requestId.ts) go in as structured
 * properties rather than string interpolation, so a log aggregator can
 * actually filter and correlate on them instead of grepping messages.
 *
 * Plain newline-delimited JSON in production — what Vercel's log drain and
 * most aggregators expect to parse. Pretty-printed in development, since
 * nobody wants to read raw JSON in a terminal.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
});
