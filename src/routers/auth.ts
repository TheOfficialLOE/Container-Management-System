import { FastifyInstance, FastifyServerOptions } from "fastify";
import { FromSchema } from "json-schema-to-ts";
import bcrypt from "bcrypt";

const schema = {
  type: "object",
  properties: {
    username: { type: "string" },
    password: { type: "string" }
  },
  required: ["username", "password"],
} as const;

export async function authRouter(fastify: FastifyInstance, _opts: FastifyServerOptions) {
  fastify.post<{ Body: FromSchema<typeof schema> }>("/signup",{ schema: { body: schema } }, async (req, res) => {
    const existingUser = await req.prisma.user.findUnique({
      where: {
        username: req.body.username
      }
    });
    if (existingUser)
      return res.status(409).send("user already exists");

    const newUser = await req.prisma.user.create({
      data: {
        username: req.body.username,
        password: await bcrypt.hash(req.body.password, 10)
      }
    });
    return res.send(await res.jwtSign({ id: newUser.id }));
  });

  fastify.post<{ Body: FromSchema<typeof schema>}>("/login", { schema: { body: schema } }, async (req, res) => {
    const user = await req.prisma.user.findUnique({
      where: {
        username: req.body.username
      }
    });
    if (!user) {
      return res.status(404).send("user not found");
    }
    const isPasswordCorrect = await bcrypt.compare(req.body.password, user.password);
    if (!isPasswordCorrect)
      return res.status(401).send("password is wrong");
    return res.send(await res.jwtSign({ id: user.id }));
  });
}