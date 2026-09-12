import { Inngest } from "inngest";

// Create a client to send and receive events
export const inngest = new Inngest({
  id: "my-app",
  // Use the local Inngest Dev Server during `next dev`; production uses Cloud.
  isDev: process.env.NODE_ENV !== "production",
});
