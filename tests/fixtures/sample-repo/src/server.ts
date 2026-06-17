import express from "express";
import { createOrder, listOrders } from "./orders.js";

const app = express();

export function healthCheck() {
  return { ok: true };
}

app.get("/health", (_request, response) => {
  response.json(healthCheck());
});

app.get("/orders", (_request, response) => {
  response.json(listOrders());
});

app.post("/orders", (request, response) => {
  response.json(createOrder(request.body));
});
