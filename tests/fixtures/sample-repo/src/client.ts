import { EventEmitter } from "events";

const orderEvents = new EventEmitter();

export async function loadOrders() {
  const response = await fetch("/orders");
  return response.json();
}

export async function submitOrder(input: unknown) {
  const response = await fetch("/orders", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return response.json();
}

export const appRouter = router({
  orders: publicProcedure.query(() => [])
});

export function readOrdersGraphql() {
  return gql`query GetOrders { orders { id total } }`;
}

export function createOrderGrpc(client: unknown) {
  return makeUnaryRequest("/OrderService/CreateOrder", client);
}

export function useOrdersProcedure() {
  return trpc.orders.useQuery();
}

export function notifyOrderCreated(id: string) {
  orderEvents.emit("order.created", { id });
}

export function onOrderCreated(handler: (payload: unknown) => void) {
  orderEvents.on("order.created", handler);
}
