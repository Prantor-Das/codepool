import { spawn } from "node:child_process";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "--yes",
  "--ignore-scripts=false",
  "inngest-cli@latest",
  "dev",
  "-u",
  "http://localhost:3000/api/inngest",
];

const child = spawn(npxCommand, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`Could not start ${npxCommand}:`, error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
