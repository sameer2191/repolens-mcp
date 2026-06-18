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
