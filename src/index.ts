import fastify from "fastify";
import { authRouter } from "./routers/auth";
import prisma from "./prisma";
import { PrismaClient } from "@prisma/client";
import { machineRouter } from "./routers/machine";
import fastifyJwt from "@fastify/jwt";
import { containerRouter } from "./routers/container";

declare module "fastify" {
  interface FastifyRequest {
    prisma: PrismaClient
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string },
    user: {
      id: string
    }
  }
}

const server = fastify({
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        ignore: 'pid,hostname',
      }
    },
  },
  disableRequestLogging: true,
  connectionTimeout: 0,
  pluginTimeout: 0,
  requestTimeout: 0,
  keepAliveTimeout: 0
});


server.register(fastifyJwt, { secret: "secret" });
server.register(authRouter, { prefix: "/auth" });
server.register(async (fastify, opts) => {
  fastify
    .addHook("onRequest", async (req, res) => {
      try {
        await req.jwtVerify();
      } catch (err) {
        res.send(err);
      }
    })
    .register(machineRouter, { prefix: "/machine", requestTimeout: 0, connectionTimeout: 0, keepAliveTimeout: 0, pluginTimeout: 0 })
    .register(containerRouter, { prefix: "/container", requestTimeout: 0, connectionTimeout: 0, keepAliveTimeout: 0, pluginTimeout: 0 })
});
server.decorateRequest("prisma", null);
server.addHook("onRequest", async (req) => {
  req.prisma = prisma;
});

server.listen({ port: 3000 });

function isDefinedAndIsString<T>(val: T): asserts val is NonNullable<T> & string {
  if (!val || typeof val !== "string") {
    throw new Error();
  }
}