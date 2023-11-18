import { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from "fastify";
import { FromSchema } from "json-schema-to-ts";
import Dockerode from "dockerode";

const registerSchema  = {
  type: "object",
  properties: {
    ip: { type: "string" },
    hostname: { type: "string" },
    cpuCores: { type: "number" },
    ram: { type: "number" },
  },
  required: ["ip", "hostname", "cpuCores", "ram"],
} as const;

const deregisterSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
  },
  required: ["id"],
} as const;

export async function machineRouter(fastify: FastifyInstance, _opts: FastifyServerOptions) {
  fastify.post<{ Body: FromSchema<typeof registerSchema>}>("/register", { schema: { body: registerSchema } }, async (req, res) => {
    if (await req.prisma.machine.findUnique({ where: { ip: req.body.ip }})) {
      return res.status(409).send("machine is already registered");
    }
    const docker = new Dockerode({ host: req.body.ip, port: 2375 });
    const netdataPullProgress = await docker.pull("netdata/netdata:v1.43.2");
    await new Promise(res => {
      docker.modem.followProgress(netdataPullProgress, res, function onProgress ()  {
      });
    });

    const traefikPullProgress = await docker.pull("traefik:v2.10");
    await new Promise(res => {
      docker.modem.followProgress(traefikPullProgress, res, function onProgress() {});
    });

    const netdataContainer = await docker.createContainer({
      Image: "netdata/netdata:v1.43.2",
      HostConfig: {
        NetworkMode: "host",
        PidMode: "host",
        Mounts: [
          { Type: "volume", Source: "netdataconfig", Target: "/etc/netdata" },
          { Type: "volume", Source: "netdatalib", Target: "/var/lib/netdata"  },
          { Type: "volume", Source: "netdatacache", Target: "/var/cache/netdata" },
        ],
        Binds: [
          "/etc/passwd:/host/etc/passwd:ro",
          "/etc/group:/host/etc/group:ro",
          "/proc:/host/proc:ro",
          "/sys:/host/sys:ro",
          "/etc/os-release:/host/etc/os-release:ro",
          "/var/run/docker.sock:/var/run/docker.sock:ro",
        ],
        CapAdd: ['SYS_PTRACE', 'SYS_ADMIN'],
        SecurityOpt: ['apparmor=unconfined'],
        RestartPolicy: { Name: "always" },
      },
      ExposedPorts: {
        "19999/19999": {}
      },
    });
    const traefikContainer = await docker.createContainer({
      Image: "traefik:v2.10",
      Cmd: ["--api.insecure=true", "--providers.docker=true"],
      HostConfig: {
        Binds: [
          "/var/run/docker.sock:/var/run/docker.sock"
        ],
        PortBindings: {
          "80/tcp": [
            { HostIp: "0.0.0.0", HostPort: "80" },
            { HostIp: "::", HostPort: "80" }
          ],
          "8080/tcp": [
            { HostIp: "0.0.0.0", HostPort: "8080" },
            { HostIp: "::", HostPort: "8080" }
          ]
        }
      },
      ExposedPorts: {
        "8080/tcp": {},
        "80/tcp": {},
      }
    });
    // for custom config maybe?
    // netdataContainer.putArchive()
    await netdataContainer.start();
    await traefikContainer.start();
    await req.prisma.machine.create({
      data: {
        userId: req.user.id,
        ip: req.body.ip,
        hostname: req.body.hostname,
        cpuCores: req.body.cpuCores,
        ram: req.body.ram,
        netdataContainerId: netdataContainer.id
      }
    });
    return res.status(200).send("server registered");
  });

  fastify.delete<{ Body: FromSchema<typeof deregisterSchema>}>("/deregister", { schema: { body: deregisterSchema } }, async (req, res) => {
    const machine = await req.prisma.machine.findUnique({
      where: { id: req.body.id }
    });
    if (!machine) {
      return res.status(409).send("machine doesn't exist");
    }
    await req.prisma.machine.delete({
      where: {
        id: req.body.id
      }
    });
    return res.send("machine deregistered");
  });
}