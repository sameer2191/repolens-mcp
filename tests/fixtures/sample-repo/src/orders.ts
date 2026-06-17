export interface Order {
  id: string;
  total: number;
}

const orders: Order[] = [];

export function listOrders() {
  return orders;
}

export function createOrder(input: Partial<Order>) {
  const order = {
    id: input.id ?? `order-${orders.length + 1}`,
    total: input.total ?? 0
  };
  orders.push(order);
  return order;
}
