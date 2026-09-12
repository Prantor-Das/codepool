import { writeFile } from "node:fs/promises";
import localtunnel from "localtunnel";

const port = 3000;
let tunnel;

try {
  tunnel = await localtunnel({ port });
  await writeFile("tunnel.txt", `${tunnel.url}\n`, "utf8");

  console.log(`LocalTunnel is forwarding to http://localhost:${port}`);
  console.log(`Public URL: ${tunnel.url}`);
  console.log("Saved public URL to tunnel.txt");

  tunnel.on("error", (error) => {
    console.error("LocalTunnel error:", error);
  });

  const shutdown = () => {
    tunnel?.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => {});
} catch (error) {
  console.error("Could not start LocalTunnel:", error);
  process.exitCode = 1;
}
