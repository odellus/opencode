import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionManager } from "../api/session-manager"
import { DualSessionAPI } from "../api/types"
import { z } from "zod"

const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              error: z.string(),
            })
            .meta({
              ref: "DualSessionError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              error: z.string(),
            })
            .meta({
              ref: "DualSessionNotFound",
            }),
        ),
      },
    },
  },
} as const

function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

export const DualSessionRoute = new Hono()
  .post(
    "/",
    describeRoute({
      description: "Create a new dual-agent pair programming session",
      operationId: "dualSession.create",
      responses: {
        200: {
          description: "Successfully created dual-agent session",
          content: {
            "application/json": {
              schema: resolver(DualSessionAPI.CreateResponse),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", DualSessionAPI.CreateRequest),
    async (c) => {
      const body = c.req.valid("json")
      const response = await SessionManager.create(body)
      return c.json(response)
    },
  )
  .get(
    "/:conversationId",
    describeRoute({
      description: "Get the current state of a dual-agent session",
      operationId: "dualSession.get",
      responses: {
        200: {
          description: "Dual-agent session state",
          content: {
            "application/json": {
              schema: resolver(DualSessionAPI.GetResponse),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator(
      "param",
      z.object({
        conversationId: z.string(),
      }),
    ),
    async (c) => {
      const { conversationId } = c.req.valid("param")
      try {
        const response = SessionManager.get(conversationId)
        return c.json(response)
      } catch (error) {
        return c.json({ error: "Conversation not found" }, 404)
      }
    },
  )
  .post(
    "/:conversationId/abort",
    describeRoute({
      description: "Abort a running dual-agent session",
      operationId: "dualSession.abort",
      responses: {
        200: {
          description: "Successfully aborted session",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator(
      "param",
      z.object({
        conversationId: z.string(),
      }),
    ),
    async (c) => {
      const { conversationId } = c.req.valid("param")
      const aborted = SessionManager.abort(conversationId)
      if (!aborted) {
        return c.json({ error: "Conversation not found" }, 404)
      }
      return c.json(true)
    },
  )
  .get(
    "/",
    describeRoute({
      description: "List all dual-agent sessions",
      operationId: "dualSession.list",
      responses: {
        200: {
          description: "List of session IDs",
          content: {
            "application/json": {
              schema: resolver(z.array(z.string())),
            },
          },
        },
      },
    }),
    async (c) => {
      const sessions = SessionManager.list()
      return c.json(sessions)
    },
  )
