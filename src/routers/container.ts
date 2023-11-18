import { FastifyInstance, FastifyServerOptions } from "fastify";
import Dockerode from "dockerode";
import { FromSchema, JSONSchema } from "json-schema-to-ts";
import { faker } from "@faker-js/faker";

const createSchema = {
  type: "object",
  properties: {
    machineId: { type: "string" },
    image: { type: "string" },
    onReverseProxy: { type: "boolean"},
    port: { type: "number" }
  },
  required: ["machineId", "image", "onReverseProxy", "port"],
} as const;

const startRestartStopSchema = {
  type: "object",
  properties: {
    machineId: { type: "string" },
    containerId: { type: "string" },
  },
  required: ["machineId", "containerId"],
} as const;

const statsSchema = {
  type: "object",
  properties: {
    machineId: { type: "string" },
    containerId: { type: "string" },
    resource: { type: "string", enum: ["cpu", "mem", "net"] }
  },
  required: ["machineId", "containerId", "resource"],
} as const;

export async function containerRouter(fastify: FastifyInstance, _opts: FastifyServerOptions) {
  fastify.post<{ Body: FromSchema<typeof createSchema>}>("/create", { schema: { body: createSchema } }, async (req, res) => {
    const machine = await req.prisma.machine.findUnique({
      where: {
        id: req.body.machineId
      },
      select: {
        ip: true
      }
    });
    if (!machine)
      return res.status(404).send("machine not found");
    const docker = new Dockerode({ host: machine.ip, port: 2375 });
    const pullProgress = await docker.pull(req.body.image);
    await new Promise(res => {
      docker.modem.followProgress(pullProgress, res, function onProgress() {});
    })
    const containerName = (faker.person.firstName() + "-" + faker.person.lastName()).toLowerCase();
    const labelHostKey = `traefik.http.routers.${containerName}.rule`;
    const labelHostValue = `Host(\`${containerName}\`)`;
    const labelPortKey = `traefik.http.services.${containerName}.loadbalancer.server.port`;
    const labelPortValue = `${req.body.port}`;
    const labels: { [label: string]: string } = {}
    labels[labelHostKey] = labelHostValue;
    labels[labelPortKey] = labelPortValue;
    const container = await docker.createContainer({
      Image: req.body.image,
      name: containerName,
      Labels: req.body.onReverseProxy ? labels : undefined
    });
    await req.prisma.container.create({
      data: {
        id: container.id,
        name: containerName,
        machineId: req.body.machineId,
        onReverseProxy: req.body.onReverseProxy,
        port: req.body.port
      }
    });
    // container.inspect(async (error, inspectInfo) => {
    //   await req.prisma.container.create({
    //     data: {
    //       id: container.id,
    //       name: inspectInfo!.Name.substring(1),
    //       machineId: req.body.machineId,
    //       onReverseProxy: req.body.onReverseProxy,
    //       port: req.body.port
    //     }
    //   });
    // });
    return res.send("container created");
  });

  fastify.post<{ Body: FromSchema<typeof startRestartStopSchema>}>("/start", { schema: { body: startRestartStopSchema } }, async (req, res) => {
    const machine = await req.prisma.machine.findUnique({
      where: {
        id: req.body.machineId
      },
      select: {
        ip: true,
        netdataContainerId: true
      }
    });
    if (!machine)
      return res.status(404).send("machine not found");
    const docker = new Dockerode({ host: machine.ip, port: 2375 });
    await docker.getContainer(req.body.containerId).start();
    await docker.getContainer(machine.netdataContainerId).restart();
    await req.prisma.container.update({
      where: {
        id: req.body.containerId,
      },
      data: {
        status: "RUNNING"
      }
    });
    return res.send("container started");
  });

  fastify.post<{ Body: FromSchema<typeof startRestartStopSchema>}>("/restart", { schema: { body: startRestartStopSchema } }, async (req, res) => {
    const machine = await req.prisma.machine.findUnique({
      where: {
        id: req.body.machineId
      },
      select: {
        ip: true,
        netdataContainerId: true
      }
    });
    if (!machine)
      return res.status(404).send("machine not found");
    const docker = new Dockerode({ host: machine.ip, port: 2375 });
    await docker.getContainer(req.body.containerId).restart();
    await docker.getContainer(machine.netdataContainerId).restart();
    await req.prisma.container.update({
      where: {
        id: req.body.containerId,
      },
      data: {
        status: "RUNNING"
      }
    });
    return res.send("container restarted");
  });

  fastify.post<{ Body: FromSchema<typeof startRestartStopSchema>}>("/stop", { schema: { body: startRestartStopSchema } }, async (req, res) => {
    const machine = await req.prisma.machine.findUnique({
      where: {
        id: req.body.machineId
      },
      select: {
        ip: true,
        netdataContainerId: true
      }
    });
    if (!machine)
      return res.status(404).send("machine not found");
    const docker = new Dockerode({ host: machine.ip, port: 2375 });
    await docker.getContainer(req.body.containerId).stop();
    await docker.getContainer(machine.netdataContainerId).restart();
    await req.prisma.container.update({
      where: {
        id: req.body.containerId,
      },
      data: {
        status: "STOPPED"
      }
    });
    return res.send("container stopped");
  });

  fastify.post<{ Body: FromSchema<typeof statsSchema>}>("/stats", { schema: { body: statsSchema } },  async (req, res) => {
    const container = await req.prisma.container.findUnique({
      where: {
        id: req.body.containerId,
        machineId: req.body.machineId,
      },
      include: {
        machine: true
      }
    });
    if (!container) {
      return res.status(404).send("container not found");
    }
    switch (req.body.resource) {
      case "cpu": {
        const cpuStats = await fetch(`http://${container.machine.ip}:19999/api/v1/data?chart=cgroup_${container.name}.cpu`);
        return res.send(cpuStats.ok ? await cpuStats.json() : "something went wrong");
      }
      case "mem": {
        const memStats = await fetch(`http://${container.machine.ip}:19999/api/v1/data?chart=cgroup_${container.name}.mem_usage`);
        return res.send(memStats.ok ? await memStats.json() : "something went wrong");
      }
      case "net": {
        const netStats = await fetch(`http://${container.machine.ip}:19999/api/v1/data?chart=cgroup_${container.name}.net_eth0`);
        return res.send(netStats.ok ? await netStats.json() : "something went wrong");
      }
    }
  });
}