import express, { type Express } from "express";
import cors from "cors";
import router from "./routes/index.js";
import { handleStripeWebhook } from "./routes/credits.js";

const app: Express = express();

app.use(cors());

// Stripe webhook MUST be before express.json() to get raw body
app.post(
  "/api/credits/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
